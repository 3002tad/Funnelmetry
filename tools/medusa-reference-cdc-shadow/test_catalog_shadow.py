import importlib.util
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parent


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


installer = load("catalog_installer", "install-catalog-shadow.py")
verifier = load("catalog_verifier", "verify-catalog-shadow.py")


class CatalogProfileTests(unittest.TestCase):
    def test_initial_snapshot_is_narrow_and_independent(self):
        fields = installer.connector_config("synthetic-only")
        self.assertEqual(fields["snapshot.mode"], "initial")
        self.assertEqual(fields["topic.prefix"], "cdc_shadow_medusa_catalog")
        self.assertEqual(fields["publication.name"], "funnelmetry_cdc_catalog_shadow")
        self.assertEqual(fields["slot.name"], "funnelmetry_cdc_catalog_shadow")
        self.assertEqual(fields["table.include.list"], ",".join(
            f"public.{table}" for table in installer.TABLES))
        self.assertEqual(set(fields["column.include.list"].split(",")), {
            f"public.{table}.{column}" for table, columns in installer.TABLES.items()
            for column in columns})
        self.assertEqual(len(installer.TABLES), 4)
        self.assertEqual(installer.EXPECTED["dashboard_cutover"],
                         "BLOCKED_PENDING_COVERAGE_AND_FRESHNESS")

    def test_rejects_extra_table_and_implicit_contract_expansion(self):
        profile = dict(installer.EXPECTED, source_owner="medusa", pipeline_owner="pipeline")
        profile["table_columns"] = list(profile["table_columns"]) + ["public.price:id,amount"]
        with self.assertRaises(ValueError):
            installer.profile_dict(profile)


class CatalogQualityTests(unittest.TestCase):
    def setUp(self):
        self.source = {table: [] for table in verifier.TABLES}
        self.target = {table: [] for table in verifier.TABLES}
        self.source["slot_status"] = "reserved"
        self.target.update(snapshot_complete=True, orphan_variants=0,
                           orphan_category_links=0, audit_count=0)
        self.ends = {f"{verifier.PREFIX}.public.{table}": 0 for table in verifier.TABLES}
        self.target["input_offsets"] = dict(self.ends)

    def test_reconciliation_requires_snapshot_and_offsets(self):
        self.assertEqual(verifier.evaluate(self.source, self.target, self.ends, True)["status"],
                         "PASS")
        self.target["snapshot_complete"] = False
        self.assertEqual(verifier.evaluate(self.source, self.target, self.ends, True)["status"],
                         "BLOCKED_BY_QUALITY")
        self.target["snapshot_complete"] = True
        self.ends[f"{verifier.PREFIX}.public.product"] = 1
        self.assertEqual(verifier.evaluate(self.source, self.target, self.ends, True)["status"],
                         "BLOCKED_BY_QUALITY")

    def test_reconciliation_detects_source_change_or_slot_loss(self):
        self.source["product"] = [{"id": "fixture", "title": "new"}]
        self.assertEqual(verifier.evaluate(self.source, self.target, self.ends, True)["status"],
                         "BLOCKED_BY_QUALITY")
        self.source["product"] = []
        self.source["slot_status"] = "lost"
        self.assertEqual(verifier.evaluate(self.source, self.target, self.ends, True)["status"],
                         "BLOCKED_BY_QUALITY")


if __name__ == "__main__":
    unittest.main()
