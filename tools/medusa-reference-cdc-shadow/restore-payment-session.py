#!/usr/bin/env python3
"""Restore one fault-injected payment session in the isolated shadow DB."""

import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
COMPOSE = ["docker", "compose", "-f", str(ROOT / "compose.yml")]
if len(sys.argv) != 2 or not re.fullmatch(r"pay_col_[A-Za-z0-9]+", sys.argv[1]):
    raise SystemExit("usage: restore-payment-session.py <shadow_payment_collection_id>")
collection_id = sys.argv[1]

statement = f"""
DO $$
BEGIN
  IF (SELECT count(*) FROM payment_session
      WHERE payment_collection_id='{collection_id}' AND deleted_at IS NULL
        AND provider_id='pp_shadow_missing') <> 1 THEN
    RAISE EXCEPTION 'expected one fault-injected shadow payment session';
  END IF;
  UPDATE payment_session SET provider_id='pp_system_default'
  WHERE payment_collection_id='{collection_id}' AND deleted_at IS NULL
    AND provider_id='pp_shadow_missing';
END $$;
"""
result = subprocess.run(
    COMPOSE + ["exec", "-T", "postgres", "psql", "-X", "-U", "medusa", "-d", "medusa", "-At", "-v", "ON_ERROR_STOP=1"],
    input=statement,
    text=True,
    capture_output=True,
    check=False,
)
if result.returncode:
    raise SystemExit(f"payment session restore failed: {result.stderr[-600:]}")
print(f"restored shadow payment session in collection {collection_id}")
