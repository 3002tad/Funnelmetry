#!/usr/bin/env python3
"""Logical dump from the live reference DB into the empty shadow DB.

The source is read-only. Refuses to overwrite a previously populated shadow.
No dump file or row payload is written to the host filesystem.
"""

import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent
COMPOSE = ["docker", "compose", "-f", str(ROOT / "compose.yml")]
SOURCE = "medusa_reference-postgres-1"


def run(argv: list[str]) -> str:
    return subprocess.check_output(argv, text=True).strip()


source = json.loads(run(["docker", "inspect", SOURCE]))[0]
if source["Config"]["Labels"].get("com.docker.compose.project") != "medusa_reference":
    raise SystemExit("source is not the expected Medusa Compose PostgreSQL container")

wal_level = run(COMPOSE + ["exec", "-T", "postgres", "psql", "-X", "-U", "medusa", "-d", "medusa", "-At", "-c", "SHOW wal_level"])
if wal_level != "logical":
    raise SystemExit(f"shadow PostgreSQL wal_level is {wal_level}, expected logical")

table_count = run(COMPOSE + ["exec", "-T", "postgres", "psql", "-X", "-U", "medusa", "-d", "medusa", "-At", "-c", "SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename='order'"])
if table_count != "0":
    raise SystemExit("shadow database already has Medusa schema; refusing second restore")

source_dump = subprocess.Popen(
    ["docker", "exec", SOURCE, "pg_dump", "-U", "medusa", "-d", "medusa", "-Fc", "--no-owner", "--no-acl"],
    stdout=subprocess.PIPE,
    stderr=subprocess.PIPE,
)
assert source_dump.stdout is not None
target_restore = subprocess.Popen(
    COMPOSE + ["exec", "-T", "postgres", "pg_restore", "-U", "medusa", "-d", "medusa", "--no-owner", "--no-acl", "--exit-on-error"],
    stdin=source_dump.stdout,
    stdout=subprocess.DEVNULL,
    stderr=subprocess.PIPE,
)
source_dump.stdout.close()
_, restore_error = target_restore.communicate()
_, dump_error = source_dump.communicate()
if source_dump.returncode or target_restore.returncode:
    raise SystemExit(
        "database clone failed: "
        + (dump_error or b"").decode("utf-8", "replace")[-1000:]
        + (restore_error or b"").decode("utf-8", "replace")[-1000:]
    )

print("restored a consistent logical snapshot into the isolated shadow PostgreSQL")
