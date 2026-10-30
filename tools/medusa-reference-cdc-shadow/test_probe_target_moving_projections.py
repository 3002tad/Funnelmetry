import importlib.util
import unittest
from pathlib import Path
from unittest.mock import patch


spec = importlib.util.spec_from_file_location(
    "moving_projection_probe", Path(__file__).with_name("probe-target-moving-projections.py"))
probe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(probe)


class MovingProjectionProbeTest(unittest.TestCase):
    def test_catalog_and_stage_samples_read_projection_before_source(self):
        calls = []

        def source(*_args):
            calls.append("source")
            return []

        def projection(*_args):
            calls.append("projection")
            return []

        with patch.object(probe.target, "source", side_effect=source), \
             patch.object(probe.target, "pipeline", side_effect=projection):
            probe.target.catalog_rows("source", "pipeline", "epoch", projection_first=True)
            self.assertEqual(calls, ["projection", "source"] * len(probe.target.CATALOG))
            calls.clear()
            probe.target.stage2_rows("source", "pipeline", "epoch", projection_first=True)
            self.assertEqual(calls, ["projection", "source"])

    def test_catalog_relation_and_stage_values_use_exact_keys(self):
        catalog = {table: [] for table in probe.target.CATALOG}
        catalog["product_category_product"] = [{"product_id": "p1",
            "product_category_id": "c1"}]
        canonical = probe.catalog_canonical(catalog)
        self.assertEqual(canonical["product_category_product"][0]["key"], ["p1", "c1"])

        source = {table: [] for table in probe.target.stage2.TABLES}
        projected = {table: [] for table in probe.target.stage2.TABLES}
        source["price"] = [{"key": ["price_1"], "soft_deleted": False,
                            "attributes": {"amount": "15"}}]
        projected["price"] = [{"key": ["price_1"], "soft_deleted": False,
                               "payload": {"amount": 15}}]
        self.assertEqual(probe.stage_canonical(source, source_side=True),
                         probe.stage_canonical(projected, source_side=False))


if __name__ == "__main__":
    unittest.main()
