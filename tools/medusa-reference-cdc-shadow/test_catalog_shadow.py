import importlib.util
import re
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
    def test_governed_writer_build_context_exists(self):
        context = (ROOT / "../..").resolve()
        compose = (ROOT / "compose.catalog-governed-candidate.yml").read_text(
            encoding="utf-8")
        self.assertIn("context: ../..", compose)
        self.assertIn("dockerfile: workers/catalog-cdc-writer/Dockerfile.shadow", compose)
        self.assertTrue((context / "workers/catalog-cdc-writer/Dockerfile.shadow").is_file())
        self.assertTrue((context / "workers/shared/postgres-config.mjs").is_file())

    def test_combined_clone_name_is_explicitly_allowed(self):
        self.assertIsNotNone(re.fullmatch(installer.PROJECT_PATTERN,
                                          "funnelmetry_cdc_combined_shadow_c1"))
        self.assertTrue(verifier.PROJECT.fullmatch("funnelmetry_cdc_combined_shadow_c1"))
        self.assertIsNone(re.fullmatch(installer.PROJECT_PATTERN, "medusa_reference"))
        self.assertIsNone(re.fullmatch(installer.PROJECT_PATTERN,
                                       "funnelmetry_cdc_inventory_price_shadow_stage2b"))

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
        profile = dict(installer.EXPECTED, source_owner="medusa", pipeline_owner="pipeline",
                       coverage_epoch_id="cdc11_catalog_epoch1")
        self.assertEqual(installer.profile_dict(profile), profile)
        legacy = dict(profile, schema_version=installer.LEGACY_SCHEMA_VERSION)
        del legacy["coverage_epoch_id"]
        self.assertEqual(installer.profile_dict(legacy), legacy)
        with self.assertRaises(ValueError):
            installer.profile_dict(dict(profile, coverage_epoch_id="INVALID EPOCH"))
        with self.assertRaises(ValueError):
            installer.profile_dict(dict(profile, schema_version="unknown-profile.v9"))
        with self.assertRaises(ValueError):
            installer.profile_dict(dict(legacy, coverage_epoch_id="cdc11_catalog_epoch1"))
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
