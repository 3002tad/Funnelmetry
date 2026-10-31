"""The target migration must not apply after a changed journal or prior object."""

import importlib.util
import json
import unittest
from pathlib import Path
from unittest.mock import patch


spec = importlib.util.spec_from_file_location(
    "install_target_projection_pending_quality",
    Path(__file__).with_name("install-target-projection-pending-quality.py"))
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)


class ProjectionPendingMigrationTest(unittest.TestCase):
    def test_requires_exact_five_file_journal(self):
        digests = installer.expected()
        response = {"ready": "READY", "journal": [list(pair) for pair in digests[:5]],
                    "table_present": False}
        with patch.object(installer, "sql", return_value=json.dumps(response)):
            self.assertEqual(installer.inspect("container", digests), "READY_TO_APPLY")
        response["journal"][0][1] = "wrong"
        with patch.object(installer, "sql", return_value=json.dumps(response)):
            with self.assertRaisesRegex(RuntimeError, "journal/schema differs"):
                installer.inspect("container", digests)

    def test_apply_guards_journal_inside_transaction(self):
        statements = []
        with patch.object(installer, "sql", side_effect=lambda _container, statement:
                          statements.append(statement) or "BEGIN\nCOMMIT"):
            installer.apply("container", installer.expected())
        statement = statements[0]
        self.assertLess(statement.index("pg_advisory_xact_lock"),
                        statement.index("CREATE TABLE cdc_projection_pending_quality_candidate"))
        self.assertIn("candidate migration prefix changed", statement)
        self.assertLess(statement.index("CREATE TABLE cdc_projection_pending_quality_candidate"),
                        statement.index("INSERT INTO cdc_candidate_migration_journal"))


if __name__ == "__main__":
    unittest.main()
