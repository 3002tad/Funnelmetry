"""Contract checks for the isolated lost-slot recovery quality gate."""

import importlib.util
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parent


def module(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT / filename)
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


verify = module("verify_recovery_epoch", "verify-recovery-epoch.py")
baseline = module("activate_recovery_baseline", "activate-recovery-baseline.py")


class RecoveryEpochTest(unittest.TestCase):
    def fixture(self):
        rows = [{"order_id": "order_1", "active": True, "cart_id": "cart_1"}]
        topics = {f"{verify.PREFIX}.public.{table}": 1 for table in verify.TABLES}
        topics[f"{verify.PREFIX}.transaction"] = 1
        ends = dict(topics, **{verify.FACT: 2})
        source = {"states": [dict(row) for row in rows], "ambiguous_orders": 0, "old_slot": "lost",
                  "new_slot": "reserved", "slot_safe_wal_size": 200 * 1024 * 1024,
                  "max_slot_wal_keep_size": "256MB"}
        projected = {"states": [dict(row) for row in rows], "epoch": {"previous_epoch_gap": "INCOMPLETE",
                     "snapshot_last_seen": True, "status": "BASELINE_VERIFIED",
                     "baseline_digest": "a" * 64}, "baseline_count": 1,
                     "input_offsets": topics, "pending_ends": 0,
                     "outbox_unpublished": 0, "outbox_total": 2,
                     "transition_count": 0}
        analytical = {"states": rows, "quality": {"historical_gap_status": "INCOMPLETE",
                      "baseline_complete": True, "baseline_orders": 1,
                      "baseline_digest": "a" * 64, "status": "BLOCKED_BY_QUALITY"},
                      "baseline_count": 1, "next_offset": 2, "inbox_count": 2,
                      "transition_count": 0,
                      "metadata": {"status": "SHADOW_ONLY_CANDIDATE",
                                   "version": "2.0.1-shadow", "published": "false"}}
        return source, projected, analytical, ends

    def test_verified_snapshot_is_current_state_only(self):
        self.assertEqual(verify.evaluate(*self.fixture(), True)["status"], "PASS")

    def test_lost_new_slot_blocks(self):
        source, projected, analytical, ends = self.fixture()
        source["new_slot"] = "lost"
        self.assertFalse(verify.evaluate(source, projected, analytical, ends, True)
                         ["checks"]["new_slot_usable"])

    def test_gap_cannot_be_erased(self):
        source, projected, analytical, ends = self.fixture()
        analytical["quality"]["historical_gap_status"] = "COMPLETE"
        self.assertEqual(verify.evaluate(source, projected, analytical, ends, True)
                         ["status"], "BLOCKED_BY_QUALITY")

    def test_offset_hole_blocks(self):
        source, projected, analytical, ends = self.fixture()
        projected["input_offsets"][f"{verify.PREFIX}.public.order"] = 0
        self.assertFalse(verify.evaluate(source, projected, analytical, ends, True)
                         ["checks"]["mapper_offsets_caught_up"])

    def test_low_wal_headroom_blocks(self):
        source, projected, analytical, ends = self.fixture()
        source["slot_safe_wal_size"] = 32 * 1024 * 1024
        result = verify.evaluate(source, projected, analytical, ends, True)
        self.assertFalse(result["checks"]["wal_budget_headroom"])
        self.assertTrue(result["wal_budget_warning"])

    def test_source_change_blocks(self):
        source, projected, analytical, ends = self.fixture()
        source["states"].append({"order_id": "order_2", "active": True,
                                 "cart_id": "cart_2"})
        self.assertFalse(verify.evaluate(source, projected, analytical, ends, True)
                         ["checks"]["source_mapper_equal"])

    def test_baseline_pairs_reject_ambiguous_order(self):
        state = {"orders": [{"id": "order_1", "present": True}],
                 "carts": [{"id": "cart_1", "completed": True},
                           {"id": "cart_2", "completed": True}],
                 "links": [{"id": "link_1", "order_id": "order_1", "cart_id": "cart_1"},
                           {"id": "link_2", "order_id": "order_1", "cart_id": "cart_2"}]}
        with self.assertRaisesRegex(RuntimeError, "multiple eligible carts"):
            baseline.pairs_from(state)


if __name__ == "__main__":
    unittest.main()
