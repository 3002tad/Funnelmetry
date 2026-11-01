"""Isolated tests: no database, DB-GPT server or external embedding calls."""

import importlib.util
import json
import sys
import types
import unittest
from contextlib import redirect_stdout
from io import StringIO
from unittest.mock import patch


psycopg = types.ModuleType("psycopg2")
extras = types.ModuleType("psycopg2.extras")
extras.RealDictCursor = object
psycopg.extras = extras
psycopg.connect = lambda **kwargs: None
sys.modules.setdefault("psycopg2", psycopg)
sys.modules.setdefault("psycopg2.extras", extras)
spec = importlib.util.spec_from_file_location("metadata_sync", __file__.replace("test_sync.py", "sync.py"))
sync = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sync)


class FakeDB:
    def __init__(self, rows):
        self.rows = rows

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def cursor(self, **kwargs):
        return self

    def execute(self, query):
        assert "funnelmetry_ai.reference_offer_metadata" in query

    def fetchall(self):
        return self.rows


def release(state="ACTIVE"):
    asset, version, contract = sync.EXPECTED
    return {"asset_id": asset, "asset_version": version, "contract_id": contract,
            "binding_state": state, "definition": {"asset_id": asset,
            "asset_version": version, "contract_id": contract, "limitations": ["No revenue"]}}


class SyncTests(unittest.TestCase):
    def test_unverified_or_ambiguous_release_never_calls_db_gpt(self):
        for rows in ([], [release("SHADOW")], [release(), release()]):
            with self.subTest(rows=len(rows)), patch.object(sync.psycopg2, "connect", return_value=FakeDB(rows)), patch.object(sync, "api") as api:
                with self.assertRaises(RuntimeError):
                    sync.main()
                api.assert_not_called()

    def test_repeated_sync_reuses_same_finished_document(self):
        state = {"spaces": [], "docs": [], "posts": []}

        def find(path, predicate):
            return next((entry for entry in state["spaces"] if predicate(entry)), None)

        def find_document(space, predicate):
            return next((entry for entry in state["docs"] if predicate(entry)), None)

        def api(path, data=None, form=False):
            state["posts"].append(path)
            if path.endswith("/space/add"):
                state["spaces"].append({"id": 1, "name": data["name"]})
            elif path.endswith("/documents"):
                state["docs"].append({"id": 2, "space": state["spaces"][0]["name"],
                                      "doc_name": data["doc_name"], "status": "TODO"})
                return "2"
            elif path.endswith("/document/sync"):
                state["docs"][0]["status"] = "FINISHED"
            else:
                raise AssertionError(path)
            return []

        with patch.object(sync.psycopg2, "connect", return_value=FakeDB([release()])), patch.object(sync, "find_page", side_effect=find), patch.object(sync, "find_document", side_effect=find_document), patch.object(sync, "api", side_effect=api), redirect_stdout(StringIO()) as output:
            sync.main()
            sync.main()
        lines = [json.loads(line) for line in output.getvalue().splitlines()]
        self.assertEqual(lines[0]["sha256"], lines[1]["sha256"])
        self.assertEqual(len(state["spaces"]), 1)
        self.assertEqual(len(state["docs"]), 1)
        self.assertEqual(len(state["posts"]), 3)


if __name__ == "__main__":
    unittest.main()
