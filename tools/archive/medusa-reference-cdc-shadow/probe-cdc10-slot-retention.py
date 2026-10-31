#!/usr/bin/env python3
"""Force the 256 MB slot retention limit only in the disposable cdc10 clone.

This deliberately invalidates that clone's replication slot. It never repairs
or recreates the slot; recovery must use a separate versioned procedure.
"""

import json
import os
import re
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parent
PROJECT = "funnelmetry_cdc_shadow_cdc10"
COMPOSE = ["docker", "compose", "-f", str(ROOT / "compose.yml")]
ORDER = re.compile(r"shadow_order=(order_[A-Za-z0-9]+)")


def run(command, *, input_text=None, timeout=120, required=True):
    result = subprocess.run(command, input=input_text, capture_output=True,
                            text=True, timeout=timeout, check=False)
    if required and result.returncode:
        raise RuntimeError(f"shadow command failed: {command[0]} {command[1]}")
    return result


def psql(statement):
    return run(COMPOSE + ["exec", "-T", "postgres", "psql", "-X", "-U",
                          "medusa", "-d", "medusa", "-At", "-v", "ON_ERROR_STOP=1"],
               input_text=statement).stdout.strip()


def sample():
    return json.loads(psql("""
      SELECT json_build_object('active',active,'wal_status',wal_status,
        'retained_wal_bytes',pg_wal_lsn_diff(pg_current_wal_lsn(),restart_lsn),
        'safe_wal_size_bytes',safe_wal_size,
        'physical_wal_bytes',(SELECT sum(size) FROM pg_ls_waldir()))::text
      FROM pg_replication_slots WHERE slot_name='funnelmetry_cdc_shadow';
    """))


def main():
    if os.environ.get("COMPOSE_PROJECT_NAME") != PROJECT:
        raise SystemExit(f"COMPOSE_PROJECT_NAME must be exactly {PROJECT}")
    inspect = json.loads(run(["docker", "inspect", PROJECT + "-postgres-1"]).stdout)[0]
    if inspect["Config"]["Labels"].get("com.docker.compose.project") != PROJECT:
        raise RuntimeError("target PostgreSQL does not belong to the cdc10 clone")
    if psql("SHOW max_slot_wal_keep_size;") != "256MB":
        raise RuntimeError("expected a 256 MB slot retention cap on the clone")
    run(COMPOSE + ["stop", "connect"])
    lost = False
    try:
        output = run(["python3", str(ROOT / "run-store-js.py"), "checkout-shadow.mjs"])
        match = ORDER.search(output.stdout)
        if not match or "completion_type=order" not in output.stdout:
            raise RuntimeError("missed synthetic checkout did not complete")
        order_id = match.group(1)
        protected = ROOT / "private" / "cdc10-missed-order.json"
        fd = os.open(protected, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            json.dump({"order_id": order_id}, stream)
        print(json.dumps({"phase": "connect_stopped_after_checkout",
                          "slot": sample()}, sort_keys=True), flush=True)
        for cycle in range(1, 9):
            for _ in range(4):
                psql("SELECT pg_logical_emit_message(false,'cdc10-pressure','x');")
                psql("SELECT pg_switch_wal();")
            psql("CHECKPOINT;")
            state = sample()
            print(json.dumps({"phase": "retention_cycle", "cycle": cycle,
                              "wal_segments_requested": cycle * 4,
                              "slot": state}, sort_keys=True), flush=True)
            if state["wal_status"] == "lost":
                lost = True
                break
        if not lost:
            raise RuntimeError("slot did not become lost within 32 requested WAL switches")
        profile = str(ROOT / "cdc-reference-shadow.json")
        verify = run(["python3", str(ROOT / "install-reference.py"), "verify",
                      "--profile", profile], required=False)
        apply = run(["python3", str(ROOT / "install-reference.py"), "apply",
                     "--profile", profile], required=False)
        if verify.returncode == 0 or apply.returncode == 0:
            raise RuntimeError("installer did not fail closed on lost shadow slot")
        print(json.dumps({"status": "PASS_FAIL_CLOSED", "slot_status": "lost",
                          "installer_verify_rejected": True,
                          "installer_apply_rejected": True,
                          "connect_left_stopped": True,
                          "missed_order_recovered": False}, sort_keys=True), flush=True)
    finally:
        if not lost:
            run(COMPOSE + ["start", "connect"])


if __name__ == "__main__":
    raise SystemExit(main())
