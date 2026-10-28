import importlib.util
import unittest
from unittest.mock import patch
from pathlib import Path


spec = importlib.util.spec_from_file_location(
    "cdc10_rebaseline", Path(__file__).with_name("probe-cdc10-rebaseline.py"))
probe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(probe)


def row(table, op, value, txid=None, snapshot="true"):
    return {"op": op, "source": {"name": probe.PREFIX, "db": "medusa",
            "schema": "public", "table": table, "snapshot": snapshot,
            "txId": txid}, "before": value if op == "d" else None,
            "after": None if op == "d" else value}


class RebaselineTest(unittest.TestCase):
    def setUp(self):
        self.snapshot = {
            "order": [row("order", "r", {"id": "order_A", "deleted_at": None}, snapshot="first")],
            "order_cart": [row("order_cart", "r", {"id": "link_A", "order_id": "order_A",
                                                   "cart_id": "cart_A"}, snapshot="true")],
            "cart": [row("cart", "r", {"id": "cart_A", "completed_at": 100}, snapshot="last")],
            "transaction": [],
        }

    def test_snapshot_is_baseline_not_new_on(self):
        state = probe.projections(self.snapshot)
        self.assertEqual(probe.active_pairs(state), {"order_A": "cart_A"})
        self.assertEqual(probe.digest_pairs(probe.active_pairs(state)),
                         probe.digest_pairs(probe.active_pairs(probe.projections(self.snapshot))))

    def test_post_snapshot_order_and_end(self):
        stream = {key: list(value) for key, value in self.snapshot.items()}
        stream["order"].append(row("order", "c", {"id": "order_B", "deleted_at": None}, 20, False))
        stream["order_cart"].append(row("order_cart", "c", {"id": "link_B",
            "order_id": "order_B", "cart_id": "cart_B"}, 20, False))
        stream["cart"].append(row("cart", "u", {"id": "cart_B", "completed_at": 200}, 20, False))
        stream["transaction"] = [{"status": "END", "id": "20:3", "data_collections": [
            {"data_collection": "public.order", "event_count": 1},
            {"data_collection": "public.order_cart", "event_count": 1},
            {"data_collection": "public.cart", "event_count": 1}]}]
        self.assertEqual(probe.validate_transaction_ends(stream), 1)
        current = probe.active_pairs(probe.projections(stream))
        self.assertEqual(current, {"order_A": "cart_A", "order_B": "cart_B"})
        self.assertEqual(set(current) - set(probe.active_pairs(probe.projections(self.snapshot))),
                         {"order_B"})
        stream["transaction"][0]["data_collections"][0]["event_count"] = 2
        with self.assertRaisesRegex(RuntimeError, "END counts"):
            probe.validate_transaction_ends(stream)

    def test_rejects_unapproved_snapshot_column(self):
        self.snapshot["order"][0]["after"]["email"] = "should-never-appear"
        with self.assertRaisesRegex(RuntimeError, "exact allowlist"):
            probe.projections(self.snapshot)

    def test_rejects_foreign_snapshot_source(self):
        self.snapshot["order"][0]["source"]["name"] = "other"
        with self.assertRaisesRegex(RuntimeError, "foreign source"):
            probe.projections(self.snapshot)

    def test_lost_recovery_slot_blocks_transition_before_topic_read(self):
        with patch.object(probe, "read_state", return_value={"status": "BASELINE_VERIFIED"}), \
             patch.object(probe, "slot_state", return_value={"old": "lost", "new": "lost"}), \
             patch.object(probe, "read_topics") as read_topics:
            with self.assertRaisesRegex(RuntimeError, "recovery slot is lost"):
                probe.transition(["order_B"])
            read_topics.assert_not_called()


if __name__ == "__main__":
    unittest.main()
