import importlib.util
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("stage2_installer", ROOT / "install-inventory-price-shadow.py")
stage2 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(stage2)
installer = stage2.table_installer
snapshot_spec = importlib.util.spec_from_file_location(
    "stage2_snapshot_verifier", ROOT / "verify-inventory-price-snapshot.py")
snapshot_verifier = importlib.util.module_from_spec(snapshot_spec)
snapshot_spec.loader.exec_module(snapshot_verifier)
projection_spec = importlib.util.spec_from_file_location(
    "stage2_projection_verifier", ROOT / "verify-inventory-price-projection.py")
projection_verifier = importlib.util.module_from_spec(projection_spec)
projection_spec.loader.exec_module(projection_verifier)


class InventoryPriceProfileTests(unittest.TestCase):
    def test_exact_initial_snapshot_and_independent_resources(self):
        profile = dict(stage2.EXPECTED, source_owner="medusa", pipeline_owner="pipeline")
        self.assertEqual(installer.profile_dict(profile), profile)
        config = installer.connector_config("synthetic-only")
        self.assertEqual(config["snapshot.mode"], "initial")
        self.assertEqual(config["slot.name"], stage2.SLOT)
        self.assertEqual(config["publication.name"], stage2.SLOT)
        self.assertEqual(config["topic.prefix"], stage2.PREFIX)
        self.assertEqual(len(stage2.TABLES), 16)
        self.assertTrue(all("deleted_at" in columns for columns in stage2.TABLES.values()))
        self.assertEqual(projection_verifier.SOFT_DELETE, set(stage2.TABLES))
        self.assertEqual(installer.PRIMARY_KEYS, stage2.PRIMARY_KEYS)
        self.assertEqual(stage2.PRIMARY_KEYS["product_sales_channel"],
                         ("product_id", "sales_channel_id"))
        self.assertEqual(set(config["column.include.list"].split(",")), {
            f"public.{table}.{column}" for table, columns in stage2.TABLES.items()
            for column in columns})
        self.assertFalse(set(stage2.TABLES).intersection({"order", "order_cart", "cart", "product"}))

    def test_rejects_missing_primary_key_and_unobserved_soft_delete(self):
        profile = dict(stage2.EXPECTED, source_owner="medusa", pipeline_owner="pipeline")
        changed = dict(profile)
        changed["table_columns"] = [*profile["table_columns"]]
        changed["table_columns"][0] = "public.product_sales_channel:id,product_id,sales_channel_id"
        with self.assertRaises(ValueError):
            installer.profile_dict(changed)
        changed = dict(profile, snapshot_mode="no_data")
        with self.assertRaises(ValueError):
            installer.profile_dict(changed)

    def test_capture_gate_requires_complete_snapshot_and_all_rows(self):
        counts = {table: 0 for table in stage2.TABLES}
        counts["inventory_level"] = 2
        ends = {table: None for table in stage2.TABLES}
        ends["inventory_level"] = 2
        services = ["postgres", "kafka", "connect"]
        result = snapshot_verifier.evaluate(counts, ends, True, True, "reserved", services)
        self.assertEqual(result["status"], "PASS_CAPTURE_ONLY")
        ends["inventory_level"] = 1
        self.assertEqual(snapshot_verifier.evaluate(
            counts, ends, True, True, "reserved", services)["status"], "BLOCKED_BY_QUALITY")
        ends["inventory_level"] = 2
        self.assertEqual(snapshot_verifier.evaluate(
            counts, ends, True, False, "reserved", services)["status"], "BLOCKED_BY_QUALITY")
        self.assertEqual(snapshot_verifier.evaluate(
            counts, ends, True, True, "lost", services)["status"], "BLOCKED_BY_QUALITY")
        self.assertEqual(snapshot_verifier.evaluate(
            counts, ends, True, True, "reserved", services + ["backend"])["status"],
            "BLOCKED_BY_QUALITY")

    def test_projection_gate_detects_relation_and_offset_changes(self):
        source = {table: [] for table in stage2.TABLES}
        source_row = {"key": ["product-1", "channel-1"], "soft_deleted": False,
                      "attributes": {"id": "link-1", "product_id": "product-1",
                                     "sales_channel_id": "channel-1"}}
        target_row = {"key": ["product-1", "channel-1"], "soft_deleted": False,
                      "payload": {"id": "link-1", "product_id": "product-1",
                                  "sales_channel_id": "channel-1"}}
        source["product_sales_channel"] = [source_row]
        target = {table: [] for table in stage2.TABLES}
        target["product_sales_channel"] = [target_row]
        ends = {table: 0 for table in stage2.TABLES}
        ends["product_sales_channel"] = 1
        topic = f"{stage2.PREFIX}.public.product_sales_channel"
        offsets = {topic: 1}
        self.assertEqual(projection_verifier.evaluate(
            source, target, ends, offsets, True, True, "reserved")["status"],
            "PASS_CONTEXT_ONLY")
        target["product_sales_channel"] = []
        self.assertEqual(projection_verifier.evaluate(
            source, target, ends, offsets, True, True, "reserved")["status"],
            "BLOCKED_BY_QUALITY")
        target["product_sales_channel"] = [target_row]
        offsets[topic] = 0
        self.assertEqual(projection_verifier.evaluate(
            source, target, ends, offsets, True, True, "reserved")["status"],
            "BLOCKED_BY_QUALITY")


if __name__ == "__main__":
    unittest.main()
