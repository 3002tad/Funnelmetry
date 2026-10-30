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


if __name__ == "__main__":
    unittest.main()
