#!/usr/bin/env python3
"""Invalidate only epoch-2 slot on the disposable CDC-10 clone and prove blocking."""

import json
import os
import re
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parent
PROJECT = "funnelmetry_cdc_shadow_cdc10"
BASE = ["docker", "compose", "-f", str(ROOT / "compose.yml")]
FULL = BASE + ["-f", str(ROOT / "compose.recovery-epoch.yml")]
ORDER = re.compile(r"shadow_order=(order_[A-Za-z0-9]+)")


def run(argv, stdin=None, required=True):
    result = subprocess.run(argv, input=stdin, capture_output=True, text=True,
                            timeout=120, check=False)
    if required and result.returncode:
        raise RuntimeError(f"second-loss command failed: {argv[0]} (exit {result.returncode})")
    return result


def sql(statement):
    return run(BASE + ["exec", "-T", "postgres", "psql", "-X", "-U", "medusa",
                       "-d", "medusa", "-At", "-v", "ON_ERROR_STOP=1"],
               stdin=statement).stdout.strip()


def slot():
    output = sql("""SELECT json_build_object('wal_status',wal_status,'active',active,
      'retained',pg_wal_lsn_diff(pg_current_wal_lsn(),restart_lsn)::bigint,
      'safe_wal_size',safe_wal_size) FROM pg_replication_slots
      WHERE slot_name='funnelmetry_cdc10_epoch2';""")
    return json.loads(output)


def main():
    if os.environ.get("COMPOSE_PROJECT_NAME") != PROJECT:
        raise RuntimeError("only the isolated CDC-10 clone may lose a slot")
    if sql("SHOW max_slot_wal_keep_size;") != "256MB" or slot()["wal_status"] != "reserved":
        raise RuntimeError("epoch-2 slot is not in the expected bounded starting state")
    initial = json.loads(run(["python3", str(ROOT / "verify-recovery-epoch.py")]).stdout)
    if initial["status"] != "PASS":
        raise RuntimeError("epoch-2 reconciliation must pass before fault injection")
    run(BASE + ["stop", "connect"])
    lost = False
    try:
        checkout = run(["python3", str(ROOT / "run-store-js.py"),
                        "checkout-shadow.mjs"]).stdout
        found = ORDER.search(checkout)
        if not found or "completion_type=order" not in checkout:
            raise RuntimeError("synthetic checkout during outage did not complete")
        order_id = found.group(1)
        protected = ROOT / "private" / "cdc10-second-loss-order.json"
        fd = os.open(protected, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            json.dump({"order_id": order_id}, stream)
        samples = []
        for cycle in range(1, 9):
            for _ in range(4):
                sql("SELECT pg_logical_emit_message(false,'cdc10-second-loss-pressure','x');")
                sql("SELECT pg_switch_wal();")
            sql("CHECKPOINT;")
            observed = slot()
            samples.append({"switches": cycle * 4, **observed})
            if observed["wal_status"] == "lost":
                lost = True
                break
        if not lost:
            raise RuntimeError("epoch-2 slot did not become lost within 32 WAL switches")
        verify = run(["python3", str(ROOT / "verify-recovery-epoch.py"),
                      "--write-quality"], required=False)
        if verify.returncode == 0:
            raise RuntimeError("quality verifier accepted a lost epoch-2 slot")
        quality = run(FULL + ["exec", "-T", "recovery-analytics-db", "psql", "-X",
                              "-U", "recovery_analytics", "-d", "recovery_analytics",
                              "-At", "-c", "SELECT status FROM recovery_quality_state;"]).stdout.strip()
        readable = run(FULL + ["exec", "-T", "recovery-analytics-db", "psql", "-X",
                               "-U", "recovery_analytics", "-d", "recovery_analytics",
                               "-At", "-c", "SELECT count(*) FROM recovery_order_current_state_readable;"]).stdout.strip()
        if quality != "BLOCKED_BY_QUALITY" or readable != "0":
            raise RuntimeError("lost slot was not fenced from analytical reads")
        print(json.dumps({"status": "PASS_FAIL_CLOSED", "missed_order_id": order_id,
                          "before_fact_offset": initial["fact_topic_offset"],
                          "after_fact_offset": initial["fact_topic_offset"],
                          "slot_samples": samples, "quality": quality,
                          "readable_rows": 0, "connect_left_stopped": True}, sort_keys=True))
    finally:
        if not lost:
            run(BASE + ["start", "connect"])


if __name__ == "__main__":
    main()
