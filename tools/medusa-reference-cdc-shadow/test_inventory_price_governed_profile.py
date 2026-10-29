"""Keep the Pipeline context writer's source allowlist equal to installer v2."""

import importlib.util
import json
import subprocess
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("stage2_profile", ROOT / "install-inventory-price-shadow.py")
profile = importlib.util.module_from_spec(spec)
spec.loader.exec_module(profile)
WRITER = ROOT.parents[1] / "workers" / "inventory-price-cdc-writer" / "src" / "projection.js"


class GovernedProfileTest(unittest.TestCase):
    def test_writer_exactly_matches_source_column_allowlist(self):
        script = ("import {fieldsByTable} from " + json.dumps(WRITER.as_uri()) + ";"
                  "console.log(JSON.stringify(fieldsByTable))")
        output = subprocess.check_output(["node", "--input-type=module", "-e", script],
                                         text=True)
        self.assertEqual(json.loads(output), {table: list(fields)
                                              for table, fields in profile.TABLES.items()})


if __name__ == "__main__":
    unittest.main()
