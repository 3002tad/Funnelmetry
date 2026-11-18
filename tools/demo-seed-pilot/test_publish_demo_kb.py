"""Offline contract checks for derived guide updates; no API/embedding calls."""
import hashlib
import importlib.util
import json
from pathlib import Path
import unittest
from unittest.mock import patch

BASE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("demo_kb", BASE / "publish-demo-kb.py")
kb = importlib.util.module_from_spec(spec)
spec.loader.exec_module(kb)


class GuideReviewTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.raw = (BASE / "demo-semantic-v1.2.1.json").read_bytes().replace(b"\r\n", b"\n")
        cls.definition = json.loads(cls.raw)
        cls.assets = {a["view"]: a for a in cls.definition["assets"]}
        cls.content = kb.guide(cls.definition)

    def test_semantic_definition_is_unchanged_and_explanatory_revision_is_separate(self):
        self.assertEqual(hashlib.sha256(self.raw).hexdigest(), kb.DEFINITION_SHA)
        self.assertEqual(self.definition["release_id"], kb.RELEASE)
        self.assertIn("Derived guide revision: " + kb.GUIDE_REVISION, self.content)
        self.assertNotEqual(hashlib.sha256(self.content.encode()).hexdigest()[:12], "d821d54d2d5d")
        self.assertEqual(self.content, kb.guide(self.definition))

    def test_alias_clarifications_match_pinned_schema_not_invented_columns(self):
        self.assertIn("started_at", self.assets["funnelmetry_demo.sessions"]["fields"])
        self.assertNotIn("session_start", self.assets["funnelmetry_demo.sessions"]["fields"])
        lines = self.assets["funnelmetry_demo.order_lines"]
        self.assertEqual(lines["grain"], ["dataset_id", "order_id", "line_id"])
        self.assertNotIn("order_line_id", lines["fields"])
        self.assertNotIn("session_id", self.assets["funnelmetry_demo.orders"]["fields"])
        self.assertIn("not session_start", self.content)
        self.assertIn("order_line_id is not a published column", self.content)

    def test_money_explanation_matches_measures_without_inventing_scale(self):
        money = [m for m in self.definition["measures"] if m["unit"] == "minor currency units"]
        self.assertEqual(len(money), 3)
        self.assertTrue(all("group by currency" in m["expression"] for m in money))
        self.assertIn("does not declare a universal divide-by-100 rule", self.content)
        self.assertIn("CAPTURED and REFUNDED are distinct measures", self.content)

    def test_guide_keeps_all_bindings_but_not_runtime_tool_instructions(self):
        for asset in self.definition["assets"]:
            self.assertIn(asset["view"], self.content)
            for field in asset["fields"]:
                self.assertIn(field, self.content)
        self.assertIn("does not establish a count of independent documents", self.content)
        self.assertNotIn("sql_result_frame(", self.content)
        self.assertNotIn("output_path(", self.content)

    def test_rendering_needs_neither_live_release_read_nor_network(self):
        with patch.object(kb, "read_release", side_effect=AssertionError("No DB")), patch.object(
            kb, "request", side_effect=AssertionError("No API")
        ):
            self.assertEqual(self.content, kb.guide(self.definition))


if __name__ == "__main__":
    unittest.main()
