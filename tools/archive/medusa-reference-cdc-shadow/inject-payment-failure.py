#!/usr/bin/env python3
"""Make one shadow-only payment session unresolvable after setup.

This deliberately mutates only the cloned PostgreSQL database, to cause a
post-order-creation authorization failure. It is a fault injection, not a
source contract or payment provider feature.
"""

import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
COMPOSE = ["docker", "compose", "-f", str(ROOT / "compose.yml")]
if len(sys.argv) != 2 or not re.fullmatch(r"pay_col_[A-Za-z0-9]+", sys.argv[1]):
    raise SystemExit("usage: inject-payment-failure.py <shadow_payment_collection_id>")
collection_id = sys.argv[1]

statement = f"""
DO $$
BEGIN
  IF (SELECT count(*) FROM payment_session WHERE payment_collection_id='{collection_id}' AND deleted_at IS NULL) <> 1 THEN
    RAISE EXCEPTION 'expected one shadow payment session';
  END IF;
  UPDATE payment_session SET provider_id='pp_shadow_missing'
  WHERE payment_collection_id='{collection_id}' AND deleted_at IS NULL;
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
    raise SystemExit(f"fault injection failed: {result.stderr[-600:]}")
print(f"injected missing provider into one payment session in shadow collection {collection_id}")
