"""The CDC-10 source checkpoint must prevent an early projected-state PASS."""

import importlib.util
import unittest
from pathlib import Path


SPEC = importlib.util.spec_from_file_location(
    "cdc_catchup", Path(__file__).with_name("verify-cdc-catchup.py"))
probe = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(probe)


def observation():
    return {
        "source": {"source_orders": 1, "eligible_orders": 1, "slot_count": 1,
                   "slot_status": "reserved", "confirmed_lsn": "0/100",
                   "confirmed_past_baseline": True, "source_txids": [7, 8, 9],
                   "retained_wal_bytes": 100,
                   "safe_wal_size_bytes": 100000},
        "mapper": {"projected_orders": 1, "source_transactions_processed": 3,
                   "pending_ends": 0, "pending_outbox": 0},
        "sink": {"sink_orders": 1},
    }


class CatchupTest(unittest.TestCase):
    def test_pass_when_source_checkpoint_and_both_projections_arrived(self):
        self.assertEqual(probe.evaluate(observation(), 1)["status"], "PASS")

    def test_old_projection_cannot_pass_before_source_transactions(self):
        result = observation()
        result["mapper"]["source_transactions_processed"] = 2
        self.assertEqual(probe.evaluate(result, 1)["status"], "WAIT")

    def test_missing_slot_or_source_or_sink_fails(self):
        for section, key, value in (("source", "slot_count", 0),
                                    ("source", "slot_status", "lost"),
                                    ("source", "source_orders", 0),
                                    ("source", "confirmed_past_baseline", False),
                                    ("mapper", "pending_ends", 1),
                                    ("sink", "sink_orders", 0)):
            with self.subTest(section=section, key=key):
                result = observation()
                result[section][key] = value
                self.assertEqual(probe.evaluate(result, 1)["status"], "WAIT")


if __name__ == "__main__":
    unittest.main()
