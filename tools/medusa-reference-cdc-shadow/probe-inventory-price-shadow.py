#!/usr/bin/env python3
"""Exercise update, soft-delete and relation delete/restore on an isolated clone."""

import importlib.util
import json
import os
import re
import subprocess
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("stage2_verify", ROOT / "verify-inventory-price-projection.py")
verifier = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verifier)
BASE = verifier.BASE


def sql(statement):
    result = subprocess.run(BASE + ["exec", "-T", "postgres", "psql", "-X", "-U", "medusa",
                                    "-d", "medusa", "-At", "-v", "ON_ERROR_STOP=1",
                                    "-c", statement], text=True, capture_output=True, check=False)
    if result.returncode:
        raise RuntimeError("isolated Medusa clone probe SQL failed; inspect protected logs")
    return result.stdout.strip()


def selected_ids():
    statement = """SELECT json_build_object(
      'level_id',(SELECT id FROM inventory_level ORDER BY id LIMIT 1),
      'stocked_quantity',(SELECT stocked_quantity::text FROM inventory_level ORDER BY id LIMIT 1),
      'item_id',(SELECT id FROM inventory_item WHERE deleted_at IS NULL ORDER BY id LIMIT 1),
      'link',(SELECT row_to_json(link) FROM
        (SELECT id,product_id,sales_channel_id FROM product_sales_channel
         WHERE deleted_at IS NULL ORDER BY product_id,sales_channel_id LIMIT 1) AS link))::text;"""
    value = json.loads(sql(statement))
    if not all(value.get(name) for name in ("level_id", "stocked_quantity", "item_id", "link")):
        raise RuntimeError("clone lacks the rows required for stage-2 transition probe")
    for item in (value["level_id"], value["item_id"], *value["link"].values()):
        if not re.fullmatch(r"[A-Za-z0-9_-]+", item):
            raise RuntimeError("unexpected probe source identifier")
    if not re.fullmatch(r"-?[0-9]+(?:\.[0-9]+)?", value["stocked_quantity"]):
        raise RuntimeError("unexpected probe quantity")
    return value


def reconcile(timeout=120):
    deadline = time.monotonic() + timeout
    while True:
        running, complete = verifier.snapshot.connector_state()
        result = verifier.evaluate(verifier.source_rows(), verifier.projection_rows(),
                                   verifier.snapshot.topic_ends(), verifier.projection_offsets(),
                                   running, complete, verifier.snapshot.source_slot())
        if result["status"] == "PASS_CONTEXT_ONLY":
            return result
        if time.monotonic() >= deadline:
            raise RuntimeError("stage-2 projection did not reconcile before timeout")
        time.sleep(5)


def main():
    if not verifier.snapshot.PROJECT.fullmatch(os.environ.get("COMPOSE_PROJECT_NAME", "")):
        raise RuntimeError("requires an isolated inventory/price shadow project")
    if os.environ.get("CDC_COVERAGE_EPOCH") != "inventory-price-shadow-20261029-b":
        raise RuntimeError("unexpected stage-2 probe epoch")
    services = set(verifier.snapshot.run(BASE + ["ps", "--services", "--status", "running"]).splitlines())
    if services != {"postgres", "kafka", "connect", "inventory-price-projection-db",
                    "inventory-price-projector"}:
        raise RuntimeError("stage-2 probe requires only its isolated CDC services")
    reconcile()
    values = selected_ids()
    link = values["link"]
    sql(f"""BEGIN;
      UPDATE inventory_level SET stocked_quantity=stocked_quantity+1
        WHERE id='{values['level_id']}';
      UPDATE inventory_item SET deleted_at=now() WHERE id='{values['item_id']}';
      UPDATE product_sales_channel SET deleted_at=now() WHERE product_id='{link['product_id']}'
        AND sales_channel_id='{link['sales_channel_id']}';
      COMMIT;""")
    try:
        changed = reconcile()
        print(json.dumps({"phase": "changed", "status": changed["status"],
                          "checks": changed["checks"]}, sort_keys=True))
    finally:
        sql(f"""BEGIN;
          UPDATE inventory_level SET stocked_quantity={values['stocked_quantity']}
            WHERE id='{values['level_id']}';
          UPDATE inventory_item SET deleted_at=NULL WHERE id='{values['item_id']}';
          UPDATE product_sales_channel SET deleted_at=NULL
            WHERE product_id='{link['product_id']}'
              AND sales_channel_id='{link['sales_channel_id']}';
          COMMIT;""")
    restored = reconcile()
    print(json.dumps({"phase": "restored", "status": restored["status"],
                      "checks": restored["checks"]}, sort_keys=True))


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, ValueError, OSError, subprocess.TimeoutExpired) as error:
        raise SystemExit(f"cdc-inventory-price-shadow-probe: {error}") from None
