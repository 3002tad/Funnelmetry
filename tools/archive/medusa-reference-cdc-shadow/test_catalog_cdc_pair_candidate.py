"""Quality and relationship gates for CDC-only catalog input."""

import importlib.util
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path


spec = importlib.util.spec_from_file_location(
    "catalog_pair", Path(__file__).with_name("catalog_cdc_pair_candidate.py"))
pair = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pair)
spec = importlib.util.spec_from_file_location(
    "inventory_resolution", Path(__file__).with_name("inventory_price_resolution_candidate.py"))
inventory = importlib.util.module_from_spec(spec)
spec.loader.exec_module(inventory)
spec = importlib.util.spec_from_file_location(
    "inventory_fixtures", Path(__file__).with_name("test_inventory_price_resolution_candidate.py"))
fixtures = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixtures)
NOW = datetime(2026, 10, 29, 12, tzinfo=timezone.utc)


def observation():
    counts = {name: 1 for name in pair.TABLES}
    offsets = {name: 10 for name in pair.TOPICS}
    return {
        "quality": {"source_id": "medusa-reference", "coverage_epoch_id": "catalog-epoch",
                    "status": "PASS", "snapshot_complete": True,
                    "connector_running": True, "slot_status": "reserved",
                    "source_digest": "digest", "projection_digest": "digest",
                    "source_row_counts": counts, "projection_row_counts": counts.copy(),
                    "topic_end_offsets": offsets, "applied_offsets": offsets.copy(),
                    "valid_until": (NOW + timedelta(seconds=30)).isoformat()},
        "current_offsets": offsets.copy(),
        "product": {"source_id": "medusa-reference", "coverage_epoch_id": "catalog-epoch",
                    "product_id": "prod_1", "status": "published", "soft_deleted": False},
        "variant": {"source_id": "medusa-reference", "coverage_epoch_id": "catalog-epoch",
                    "variant_id": "var_1", "product_id": "prod_1",
                    "manage_inventory": True, "allow_backorder": False,
                    "soft_deleted": False},
    }


def resolve(data):
    return pair.resolve_pair(data, source_id="medusa-reference",
                             coverage_epoch_id="catalog-epoch", now=NOW)


class CatalogPairTest(unittest.TestCase):
    def test_verified_pair_can_feed_inventory_resolver(self):
        result = resolve(observation())
        self.assertEqual(result["status"], "PASS_CONTEXT_ONLY")
        self.assertEqual(result["variant"]["product_id"], result["product"]["product_id"])
        resolved = inventory.resolve_inventory(
            fixtures.context(), product=result["product"], variant=result["variant"],
            sales_channel_id="sc_1", context_reconciled=True,
            verified_tables=inventory.TABLES)
        self.assertEqual((resolved["status"], resolved["inventory_quantity"]),
                         ("PASS_SAMPLE_ONLY", 8))

    def test_expired_or_partial_lease_cannot_feed_resolver(self):
        data = observation()
        data["quality"]["valid_until"] = (NOW - timedelta(seconds=1)).isoformat()
        self.assertEqual(resolve(data)["status"], "BLOCKED_BY_QUALITY")
        data = observation()
        data["quality"]["topic_end_offsets"].pop(next(iter(pair.TOPICS)))
        self.assertEqual(resolve(data)["status"], "BLOCKED_BY_QUALITY")
        data = observation()
        data["current_offsets"][next(iter(pair.TOPICS))] += 1
        self.assertEqual(resolve(data)["status"], "BLOCKED_BY_QUALITY")

    def test_cross_epoch_or_wrong_parent_fails_closed(self):
        data = observation()
        data["variant"]["coverage_epoch_id"] = "other-epoch"
        self.assertEqual(resolve(data)["status"], "BLOCKED_BY_QUALITY")
        data = observation()
        data["variant"]["product_id"] = "other-product"
        self.assertEqual(resolve(data)["status"], "BLOCKED_BY_QUALITY")


if __name__ == "__main__":
    unittest.main()
