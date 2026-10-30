import importlib.util
import unittest
from pathlib import Path


SPEC = importlib.util.spec_from_file_location(
    "target_inventory_price_resolver",
    Path(__file__).with_name("verify-target-inventory-price-resolver.py"))
probe = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(probe)


class TargetInventoryPriceResolverTest(unittest.TestCase):
    def test_source_change_between_api_samples_blocks_claim(self):
        stream = {"source_digest": "a", "projection_digest": "a",
                  "topic_end_offsets": {"topic": 1}, "applied_offsets": {"topic": 1}}
        before = {"catalog": dict(stream), "inventory_price": dict(stream)}
        after = {"catalog": dict(stream), "inventory_price": dict(stream)}
        self.assertTrue(probe.stable(before, after))
        after["inventory_price"]["topic_end_offsets"] = {"topic": 2}
        self.assertFalse(probe.stable(before, after))


if __name__ == "__main__":
    unittest.main()
