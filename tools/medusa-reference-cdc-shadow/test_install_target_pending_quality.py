"""Guard tests for the target candidate migration operator command."""

import importlib.util
import json
import unittest
from pathlib import Path
from unittest.mock import patch


spec = importlib.util.spec_from_file_location(
    "install_target_pending_quality",
    Path(__file__).with_name("install-target-pending-quality.py"))
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)


class TargetPendingMigrationTest(unittest.TestCase):
    def test_existing_four_file_journal_is_required(self):
        digests = installer.expected()
        response = {"ready": "READY", "journal": [list(pair) for pair in digests[:4]],
                    "table_present": False}
        with patch.object(installer, "sql", return_value=json.dumps(response)):
            self.assertEqual(installer.inspect("container", digests), "READY_TO_APPLY")
        response["journal"][0][1] = "wrong"
        with patch.object(installer, "sql", return_value=json.dumps(response)):
            with self.assertRaisesRegex(RuntimeError, "journal/schema differs"):
                installer.inspect("container", digests)

    def test_apply_checks_journal_inside_transaction_before_create(self):
        statements = []
        with patch.object(installer, "sql", side_effect=lambda _container, statement:
                          statements.append(statement) or "BEGIN\nCOMMIT"):
            installer.apply("container", installer.expected())
        statement = statements[0]
        self.assertLess(statement.index("pg_advisory_xact_lock"),
                        statement.index("CREATE TABLE reference_cdc_v2_pending_quality_candidate"))
        self.assertIn("candidate migration prefix changed", statement)
        self.assertLess(statement.index("CREATE TABLE reference_cdc_v2_pending_quality_candidate"),
                        statement.index("INSERT INTO cdc_candidate_migration_journal"))


if __name__ == "__main__":
    unittest.main()
