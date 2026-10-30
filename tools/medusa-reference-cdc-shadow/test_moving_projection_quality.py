import importlib.util
import unittest
from pathlib import Path


spec = importlib.util.spec_from_file_location(
    "moving_projection_quality", Path(__file__).with_name("moving_projection_quality.py"))
quality = importlib.util.module_from_spec(spec)
spec.loader.exec_module(quality)


def check(source=None, projection=None, **overrides):
    options = dict(source_rows=source if source is not None else
                   {"product": [{"key": "p1", "value": {"title": "A"}}]},
                   projection_rows=projection if projection is not None else
                   {"product": [{"key": "p1", "value": {"title": "A"}}]},
                   expected_topics={"catalog.public.product"},
                   topic_ends={"catalog.public.product": 12},
                   applied_offsets={"catalog.public.product": 10},
                   connector_running=True, snapshot_complete=True,
                   slot_status="reserved", safe_wal_bytes=1024,
                   minimum_safe_wal_bytes=512, max_pending_rows=2,
                   max_offset_lag=4, max_pending_seconds=10,
                   first_seen={}, now_seconds=100)
    options.update(overrides)
    return quality.evaluate(**options)


class MovingProjectionQualityTest(unittest.TestCase):
    def test_unchanged_rows_with_bounded_offsets(self):
        self.assertEqual(check()["status"], "PASS_BOUNDED_LAG")

    def test_insert_update_and_delete_are_pending_with_finite_age(self):
        for source, projection in (
                ({"product": [{"key": "p1", "value": "A"}]}, {"product": []}),
                ({"product": [{"key": "p1", "value": "B"}]},
                 {"product": [{"key": "p1", "value": "A"}]}),
                ({"product": []}, {"product": [{"key": "p1", "value": "A"}]})):
            with self.subTest(source=source):
                result = check(source, projection)
                self.assertEqual(result["status"], "PASS_BOUNDED_LAG")
                self.assertEqual(result["pending_row_count"], 1)
                self.assertEqual(check(source, projection,
                    first_seen=result["pending_first_seen"], now_seconds=111)["status"],
                    "BLOCKED_BY_QUALITY")

    def test_excess_lag_lost_slot_and_missing_offset_block(self):
        self.assertEqual(check(topic_ends={"catalog.public.product": 15})["status"],
                         "BLOCKED_BY_QUALITY")
        self.assertEqual(check(slot_status="lost")["status"], "BLOCKED_BY_QUALITY")
        self.assertEqual(check(applied_offsets={})["status"], "BLOCKED_BY_QUALITY")
        self.assertEqual(check(expected_topics={"foreign"})["status"],
                         "BLOCKED_BY_QUALITY")
        self.assertEqual(check(connector_running=False)["status"], "BLOCKED_BY_QUALITY")

    def test_duplicate_key_or_wrong_table_allowlist_rejected(self):
        with self.assertRaises(ValueError):
            check(source={"product": [{"key": "p1", "value": 1},
                                      {"key": "p1", "value": 2}]})
        with self.assertRaises(ValueError):
            check(projection={"variant": []})


if __name__ == "__main__":
    unittest.main()
