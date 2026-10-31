"""Fault cases for the order-v2 readiness decision, without a running clone."""

import copy
import importlib.util
import unittest
from pathlib import Path


spec = importlib.util.spec_from_file_location(
    "reference_order_v2_quality", Path(__file__).with_name("reference_order_v2_quality.py"))
quality = importlib.util.module_from_spec(spec)
spec.loader.exec_module(quality)

PREFIX = "cdc_test_epoch"
FACT = "reference.order.v2.test"


def sample():
    row = {"order_id": "order_1", "active": True, "cart_id": "cart_1"}
    topics = {f"{PREFIX}.public.{table}": 1 for table in quality.TABLES}
    topics[f"{PREFIX}.transaction"] = 1
    return {
        "source": {"states": [row], "ambiguous_orders": 0,
                   "slot_status": "reserved", "slot_safe_wal_size": 100_000_000},
        "mapper": {"states": [row], "epoch": {"status": "BASELINE_VERIFIED",
                   "snapshot_last_seen": True, "baseline_digest": "digest",
                   "baseline_active_count": 1, "previous_epoch_gap": "INCOMPLETE"},
                   "outbox_counts": {"BASELINE": 1, "BASELINE_COMPLETE": 1},
                   "pending_ends": 0, "unpublished": 0, "offsets": topics},
        "sink": {"states": [row], "quality": {"baseline_complete": True,
                 "baseline_orders": 1, "baseline_active_orders": 1,
                 "baseline_digest": "digest", "historical_gap_status": "INCOMPLETE"},
                 "inbox_counts": {"BASELINE": 1, "BASELINE_COMPLETE": 1}, "offset": 2},
        "topic_ends": {**topics, FACT: 2}, "connector_running": True,
    }


def decision(value):
    return quality.evaluate(value, prefix=PREFIX, fact_topic=FACT,
                            minimum_safe_wal_bytes=64 * 1024 * 1024)


class QualityDecisionTests(unittest.TestCase):
    def test_reconciled_prefix_can_receive_a_lease(self):
        result = decision(sample())
        self.assertEqual(result["status"], "PASS")
        self.assertTrue(all(result["checks"].values()))

    def test_lost_slot_blocks_even_if_counts_and_offsets_match(self):
        value = sample()
        value["source"]["slot_status"] = "lost"
        self.assertFalse(decision(value)["checks"]["usable_slot"])
        self.assertEqual(decision(value)["status"], "BLOCKED_BY_QUALITY")

    def test_kafka_end_ahead_of_sink_blocks_stale_claim(self):
        value = sample()
        value["topic_ends"][FACT] = 3
        self.assertFalse(decision(value)["checks"]["offsets_caught_up"])

    def test_empty_initial_transaction_topic_needs_no_mapper_offset_row(self):
        value = sample()
        transaction = f"{PREFIX}.transaction"
        value["topic_ends"][transaction] = 0
        value["mapper"]["offsets"].pop(transaction)
        self.assertEqual(decision(value)["status"], "PASS")
        value["topic_ends"][transaction] = 1
        self.assertFalse(decision(value)["checks"]["offsets_caught_up"])

    def test_source_correction_without_cdc_application_blocks(self):
        value = sample()
        value["source"]["states"][0] = {"order_id": "order_1", "active": False,
                                          "cart_id": None}
        result = decision(value)
        self.assertFalse(result["checks"]["source_mapper_equal"])
        self.assertEqual(result["status"], "BLOCKED_BY_QUALITY")

    def test_hard_delete_retains_inactive_tombstone_for_audit(self):
        value = sample()
        value["source"]["states"] = []
        for side in ("mapper", "sink"):
            value[side]["states"] = [{"order_id": "order_1", "active": False,
                                        "cart_id": None}]
        value["mapper"]["outbox_counts"]["TRANSITION"] = 1
        value["sink"]["inbox_counts"]["TRANSITION"] = 1
        value["sink"]["offset"] = value["topic_ends"][FACT] = 3
        self.assertTrue(decision(value)["checks"]["source_mapper_equal"])
        self.assertEqual(decision(value)["status"], "PASS")

    def test_malformed_duplicate_state_and_missing_marker_block(self):
        value = sample()
        value["sink"]["states"].append(copy.deepcopy(value["sink"]["states"][0]))
        value["mapper"]["outbox_counts"].pop("BASELINE_COMPLETE")
        result = decision(value)
        self.assertFalse(result["checks"]["mapper_sink_equal"])
        self.assertFalse(result["checks"]["baseline_verified"])

    def test_moving_source_allows_only_short_new_order_backlog(self):
        value = sample()
        value["source"]["states"].append({"order_id": "order_2", "active": True,
                                          "cart_id": "cart_2"})
        value["mapper"]["pending_ends"] = 1
        value["topic_ends"][f"{PREFIX}.public.order"] = 2
        result = quality.evaluate_moving(value, prefix=PREFIX, fact_topic=FACT,
            minimum_safe_wal_bytes=64 * 1024 * 1024, max_pending_orders=2,
            max_raw_offset_lag=4, max_pending_seconds=5,
            pending_first_seen={}, now_seconds=100)
        self.assertEqual(result["status"], "PASS_BOUNDED_LAG")
        self.assertEqual(result["pending_first_seen"], {"order_2": 100})
        stale = quality.evaluate_moving(value, prefix=PREFIX, fact_topic=FACT,
            minimum_safe_wal_bytes=64 * 1024 * 1024, max_pending_orders=2,
            max_raw_offset_lag=4, max_pending_seconds=5,
            pending_first_seen={"order_2": 90}, now_seconds=100)
        self.assertEqual(stale["status"], "BLOCKED_BY_QUALITY")
        self.assertFalse(stale["checks"]["pending_fresh"])
        self.assertEqual(stale["pending_first_seen"], {"order_2": 90})

    def test_moving_source_blocks_existing_order_correction_and_lost_slot(self):
        value = sample()
        value["source"]["states"][0] = {"order_id": "order_1", "active": False,
                                          "cart_id": None}
        args = dict(prefix=PREFIX, fact_topic=FACT,
            minimum_safe_wal_bytes=64 * 1024 * 1024, max_pending_orders=2,
            max_raw_offset_lag=4, max_pending_seconds=5,
            pending_first_seen={}, now_seconds=100)
        result = quality.evaluate_moving(value, **args)
        self.assertEqual(result["status"], "BLOCKED_BY_QUALITY")
        self.assertFalse(result["checks"]["state_prefix_consistent"])
        value = sample()
        value["source"]["slot_status"] = "lost"
        self.assertEqual(quality.evaluate_moving(value, **args)["status"],
                         "BLOCKED_BY_QUALITY")

    def test_moving_source_blocks_unbounded_offset_and_extra_active_order(self):
        value = sample()
        args = dict(prefix=PREFIX, fact_topic=FACT,
            minimum_safe_wal_bytes=64 * 1024 * 1024, max_pending_orders=2,
            max_raw_offset_lag=4, max_pending_seconds=5,
            pending_first_seen={}, now_seconds=100)
        value["topic_ends"][f"{PREFIX}.public.order"] = 6
        self.assertFalse(quality.evaluate_moving(value, **args)["checks"]["offset_backlog_bounded"])
        value = sample()
        value["mapper"]["states"].append({"order_id": "order_old", "active": True,
                                          "cart_id": "cart_old"})
        self.assertFalse(quality.evaluate_moving(value, **args)["checks"]["state_prefix_consistent"])


if __name__ == "__main__":
    unittest.main()
