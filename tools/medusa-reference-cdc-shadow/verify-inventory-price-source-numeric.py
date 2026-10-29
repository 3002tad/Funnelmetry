#!/usr/bin/env python3
"""Read-only clone check: Medusa numeric CDC columns agree with raw quantities."""

import importlib.util
import json
import os
from pathlib import Path


ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location(
    "stage2_projection", ROOT / "verify-inventory-price-projection.py")
stage2 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(stage2)


def inspect():
    statement = """SELECT json_build_object(
      'inventory_level_mismatch',(
        SELECT count(*) FROM inventory_level WHERE
          (raw_stocked_quantity->>'value')::numeric IS DISTINCT FROM stocked_quantity OR
          (raw_reserved_quantity->>'value')::numeric IS DISTINCT FROM reserved_quantity OR
          (raw_incoming_quantity->>'value')::numeric IS DISTINCT FROM incoming_quantity),
      'price_mismatch',(
        SELECT count(*) FROM price WHERE
          (raw_amount->>'value')::numeric IS DISTINCT FROM amount OR
          (raw_min_quantity->>'value')::numeric IS DISTINCT FROM min_quantity OR
          (raw_max_quantity->>'value')::numeric IS DISTINCT FROM max_quantity))::text;"""
    return stage2.query(stage2.BASE, "postgres", "medusa", "medusa", statement)


def passed(counts):
    return set(counts) == {"inventory_level_mismatch", "price_mismatch"} and \
        all(type(value) is int and value == 0 for value in counts.values())


def main():
    if os.environ.get("COMPOSE_PROJECT_NAME") != "funnelmetry_cdc_inventory_price_shadow_stage2b":
        raise RuntimeError("requires exact isolated stage2b clone")
    counts = inspect()
    print(json.dumps({"status": "PASS_CONTEXT_ONLY" if passed(counts) else
                      "BLOCKED_BY_QUALITY", "mismatch_counts": counts}, sort_keys=True))
    return 0 if passed(counts) else 1


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (RuntimeError, ValueError, OSError) as error:
        raise SystemExit(f"inventory-price-source-numeric: {error}") from None
