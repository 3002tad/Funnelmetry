import importlib.util
import unittest
from pathlib import Path
from unittest.mock import patch


SPEC = importlib.util.spec_from_file_location(
    "monitor_target_quality", Path(__file__).with_name("monitor-target-quality.py"))
monitor = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(monitor)


def sample():
    pair = {"catalog": {"source_digest": "a", "projection_digest": "a",
                        "topic_end_offsets": {"a": 1}, "applied_offsets": {"a": 1}},
            "inventory_price": {"source_digest": "b", "projection_digest": "b",
                                "topic_end_offsets": {"b": 0}, "applied_offsets": {"b": 0}}}
    order = {"source_digest": "c", "mapper_digest": "c", "sink_digest": "c",
             "fact_offset": 4, "baseline_digest": "d", "mapper_offsets": {"c": 1},
             "topic_end_offsets": {"c": 1}}
    return pair, order


class MonitorTargetQualityTest(unittest.TestCase):
    def test_stable_rejects_mapper_offset_drift(self):
        first, second = sample(), sample()
        self.assertTrue(monitor.stable(first, second))
        second[1]["mapper_offsets"]["c"] = 2
        self.assertFalse(monitor.stable(first, second))

    def test_failed_probe_blocks_existing_candidate_lease(self):
        with patch.object(monitor, "container_ids", return_value={"pipeline": "id"}), \
             patch.object(monitor, "sample", side_effect=RuntimeError("source mismatch")), \
             patch.object(monitor, "write_blocked") as blocked:
            self.assertFalse(monitor.cycle(Path("."), 240, True))
            blocked.assert_called_once_with({"pipeline": "id"})

    def test_worker_changed_between_samples_blocks_lease(self):
        first, second = sample(), sample()
        with patch.object(monitor, "container_ids", side_effect=[{"pipeline": "id"},
                                                               {"pipeline": "new-id"}]), \
             patch.object(monitor, "sample", side_effect=[first, second]), \
             patch.object(monitor.time, "sleep"), \
             patch.object(monitor, "write_blocked") as blocked, \
             patch.object(monitor, "write_catalog_pass") as catalog_passed, \
             patch.object(monitor, "write_order_pass") as order_passed:
            self.assertFalse(monitor.cycle(Path("."), 240, True))
            blocked.assert_called_once_with({"pipeline": "id"})
            catalog_passed.assert_not_called()
            order_passed.assert_not_called()

    def test_order_drift_does_not_block_catalog_lease(self):
        first, second = sample(), sample()
        second[1]["fact_offset"] = 5
        for value in (first[0], second[0]):
            value["catalog"].update(slot_safe_wal_size=1024**3,
                                    counts={"product": {"source": 104}})
            value["inventory_price"].update(slot_safe_wal_size=1024**3,
                                            table_counts={"inventory_level": {}})
        with patch.object(monitor, "container_ids", return_value={"pipeline": "id"}), \
             patch.object(monitor, "sample", side_effect=[first, second]), \
             patch.object(monitor.time, "sleep"), \
             patch.object(monitor, "write_catalog_pass") as catalog_passed, \
             patch.object(monitor, "write_order_pass") as order_passed, \
             patch.object(monitor, "write_blocked") as blocked:
            self.assertFalse(monitor.cycle(Path("."), 240, True))
            catalog_passed.assert_called_once_with({"pipeline": "id"}, second[0], 240)
            order_passed.assert_not_called()
            blocked.assert_called_once_with({"pipeline": "id"}, ("order",))

    def test_catalog_drift_does_not_block_order_lease(self):
        first, second = sample(), sample()
        second[0]["catalog"]["topic_end_offsets"]["a"] = 2
        for order in (first[1], second[1]):
            order.update(slot_safe_wal_size=1024**3, source_count=3)
        with patch.object(monitor, "container_ids", return_value={"pipeline": "id"}), \
             patch.object(monitor, "sample", side_effect=[first, second]), \
             patch.object(monitor.time, "sleep"), \
             patch.object(monitor, "write_catalog_pass") as catalog_passed, \
             patch.object(monitor, "write_order_pass") as order_passed, \
             patch.object(monitor, "write_blocked") as blocked:
            self.assertFalse(monitor.cycle(Path("."), 240, True))
            catalog_passed.assert_not_called()
            order_passed.assert_called_once_with({"pipeline": "id"}, second[1], 240)
            blocked.assert_called_once_with({"pipeline": "id"}, ("catalog",))

    def test_lease_writes_are_scoped_to_the_stream(self):
        pair, order = sample()
        for kind in pair:
            pair[kind].update(counts={"product": {"source": 1, "projection": 1}},
                              table_counts={"inventory_level": {"source": 1, "projection": 1}},
                              slot_status="reserved", source_digest="d", projection_digest="d")
        order["baseline_digest"] = "d"
        with patch.object(monitor, "run", return_value="COMMIT") as command:
            monitor.write_catalog_pass({"pipeline": "id"}, pair, 240)
            catalog_sql = command.call_args.args[1]
            self.assertNotIn("reference_cdc_v2_quality_state", catalog_sql)
            monitor.write_order_pass({"pipeline": "id"}, order, 240)
            order_sql = command.call_args.args[1]
            self.assertNotIn("catalog_cdc_quality_lease", order_sql)

    def test_missing_worker_blocks_prior_lease(self):
        with patch.object(monitor, "container_ids", side_effect=RuntimeError("catalog worker missing")), \
             patch.object(monitor, "one_container", return_value="pipeline-id"), \
             patch.object(monitor, "write_blocked") as blocked:
            self.assertFalse(monitor.cycle(Path("."), 240, True))
            blocked.assert_called_once_with({"pipeline": "pipeline-id"})


if __name__ == "__main__":
    unittest.main()
