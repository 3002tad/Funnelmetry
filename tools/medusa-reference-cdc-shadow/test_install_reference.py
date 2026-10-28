"""Installer contract checks that never start Docker or touch PostgreSQL."""

import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

SCRIPT = Path(__file__).with_name("install-reference.py")
SPEC = importlib.util.spec_from_file_location("reference_installer", SCRIPT)
installer = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(installer)


def valid_profile():
    return {
        **installer.EXPECTED,
        "source_owner": "medusa-operator",
        "pipeline_owner": "pipeline-operator",
        "table_columns": [
            "public.order:id,deleted_at", "public.order_cart:id,order_id,cart_id",
            "public.cart:id,completed_at",
        ],
    }


class ReferenceInstallerTest(unittest.TestCase):
    def test_profile_accepts_only_approved_shadow_scope(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "profile.json"
            path.write_text(json.dumps(valid_profile()), encoding="utf-8")
            self.assertEqual(installer.profile(path)["status"], "SHADOW_ONLY")
            for mutation in (
                {"status": "LIVE"},
                {"order_fact_authority": "cdc"},
                {"table_columns": ["public.order:id,email"]},
                {"runtime_activation": "LIVE"},
                {"activate_live": True},
            ):
                value = valid_profile()
                value.update(mutation)
                path.write_text(json.dumps(value), encoding="utf-8")
                with self.assertRaises(ValueError):
                    installer.profile(path)

    def test_compose_rejects_public_ports_and_external_networks(self):
        services = {name: {"networks": {"shadow": None}} for name in (
            "postgres", "kafka", "connect", "reference-projection-db",
            "reference-mapper", "reference-analytics-db", "reference-analytics-sink",
        )}
        valid = {"name": "funnelmetry_cdc_shadow", "networks": {"shadow": {"internal": True}},
                 "services": services}
        installer.check_compose(valid)
        for bad in (
            {**valid, "name": "medusa_reference"},
            {**valid, "networks": {"shadow": {"internal": False}}},
            {**valid, "services": {**services, "connect": {"ports": [{"published": 8083}]}}},
        ):
            with self.assertRaises(ValueError):
                installer.check_compose(bad)
        with patch.object(installer, "PROJECT", "medusa_reference"):
            with self.assertRaisesRegex(ValueError, "isolated CDC shadow"):
                installer.check_compose(valid)

    def test_bootstrap_uses_exact_column_grants_and_refuses_drift(self):
        commands = []
        def fake_sql(statement):
            commands.append(statement)
            if "FROM pg_roles" in statement:
                return ""
            return ""
        with patch.object(installer, "publication_state", side_effect=["absent", "exact"]), \
             patch.object(installer, "sql", side_effect=fake_sql):
            installer.bootstrap_source("a" * 32)
        script = "\n".join(commands)
        self.assertIn('GRANT SELECT (id,deleted_at) ON public."order"', script)
        self.assertIn("GRANT SELECT (id,order_id,cart_id) ON public.order_cart", script)
        self.assertIn("GRANT SELECT (id,completed_at) ON public.cart", script)
        self.assertIn("CREATE PUBLICATION funnelmetry_cdc_shadow", script)
        self.assertNotIn("order_summary", script)
        with patch.object(installer, "publication_state", side_effect=ValueError("drift")):
            with self.assertRaisesRegex(ValueError, "drift"):
                installer.bootstrap_source("a" * 32)

    def test_install_and_rollback_own_only_shadow_resources(self):
        document = valid_profile()
        with patch.object(installer, "state", return_value=None), \
             patch.object(installer, "secret_url", return_value="a" * 32), \
             patch.object(installer, "run"), \
             patch.object(installer, "check_runtime_compose"), \
             patch.object(installer, "compose") as compose, \
             patch.object(installer, "source_preflight", return_value=False), \
             patch.object(installer, "connector_state", return_value="absent"), \
             patch.object(installer, "bootstrap_source") as bootstrap, \
             patch.object(installer, "connect") as connect, \
             patch.object(installer, "save_state") as save:
            result = installer.install(document)
        self.assertEqual(result["runtime_conformance"], "VERIFY_REQUIRED")
        bootstrap.assert_called_once_with("a" * 32)
        self.assertEqual(connect.call_args.kwargs["method"], "POST")
        self.assertEqual([call.args[1] for call in save.call_args_list], ["INSTALLING", "INSTALLED"])
        self.assertFalse(any("down" in call.args or "-v" in call.args for call in compose.call_args_list))

        with patch.object(installer, "state", return_value={"status": "INSTALLED"}), \
             patch.object(installer, "secret_url", return_value="a" * 32), \
             patch.object(installer, "check_runtime_compose"), \
             patch.object(installer, "connector_state", return_value="exact"), \
             patch.object(installer, "compose") as compose, \
             patch.object(installer, "connect") as connect, \
             patch.object(installer, "save_state"):
            result = installer.rollback(document)
        self.assertEqual(result["status"], "stopped")
        self.assertIn("replication_slot", result["retained"])
        self.assertEqual(compose.call_args.args[:3], ("stop", "reference-mapper", "reference-analytics-sink"))
        self.assertEqual(connect.call_args.kwargs["method"], "DELETE")

        with patch.object(installer, "state", return_value={"status": "STOPPED"}), \
             patch.object(installer, "secret_url", return_value="a" * 32), \
             patch.object(installer, "run"), \
             patch.object(installer, "check_runtime_compose"), \
             patch.object(installer, "compose"), \
             patch.object(installer, "source_preflight", return_value=True), \
             patch.object(installer, "connector_state", return_value="absent"), \
             patch.object(installer, "bootstrap_source"), \
             patch.object(installer, "connect") as connect, \
             patch.object(installer, "save_state"):
            result = installer.install(document)
        self.assertEqual(result["status"], "installed")
        self.assertEqual(connect.call_args.kwargs["method"], "POST")

    def test_missing_owned_slot_fails_before_connect_restart(self):
        document = valid_profile()
        with patch.object(installer, "state", return_value={"status": "INSTALLED"}), \
             patch.object(installer, "secret_url", return_value="a" * 32), \
             patch.object(installer, "run"), \
             patch.object(installer, "check_runtime_compose"), \
             patch.object(installer, "compose") as compose, \
             patch.object(installer, "source_preflight", return_value=False), \
             patch.object(installer, "connector_state") as connector:
            with self.assertRaisesRegex(ValueError, "refusing automatic recreation"):
                installer.install(document)
        self.assertEqual(compose.call_args_list[-1].args, ("up", "-d", "postgres"))
        connector.assert_not_called()

        with patch.object(installer, "state", return_value={"status": "INSTALLED"}), \
             patch.object(installer, "secret_url", return_value="a" * 32), \
             patch.object(installer, "check_runtime_compose"), \
             patch.object(installer, "source_preflight", return_value=False):
            with self.assertRaisesRegex(ValueError, "verification failed"):
                installer.verify(document)

    def test_unusable_slot_wal_status_fails_preflight(self):
        for wal_status in ("unreserved", "lost"):
            slot = [{"slot": installer.CONNECTOR, "plugin": "pgoutput",
                     "db": "medusa", "wal_status": wal_status}]
            with self.subTest(wal_status=wal_status), patch.object(
                installer, "sql", side_effect=["medusa|logical", "t", json.dumps(slot)]
            ):
                with self.assertRaisesRegex(ValueError, "unsafe WAL status"):
                    installer.source_preflight()


if __name__ == "__main__":
    unittest.main()
