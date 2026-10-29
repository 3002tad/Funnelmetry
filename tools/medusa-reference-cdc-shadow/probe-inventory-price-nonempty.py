#!/usr/bin/env python3
"""Exercise nonempty reservation and price-list CDC on the isolated stage-2 clone."""

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
EPOCH = "inventory-price-shadow-20261029-b"
IDS = {
    "reservation": "fm_cdc_stage2b_reservation_probe",
    "list": "fm_cdc_stage2b_price_list_probe",
    "rule": "fm_cdc_stage2b_price_list_rule_probe",
    "price": "fm_cdc_stage2b_price_probe",
}


def sql(statement):
    result = subprocess.run(BASE + ["exec", "-T", "postgres", "psql", "-X", "-U", "medusa",
                                    "-d", "medusa", "-At", "-v", "ON_ERROR_STOP=1",
                                    "-c", statement], text=True, capture_output=True, check=False)
    if result.returncode:
        raise RuntimeError("stage-2 clone fixture SQL failed; inspect protected logs")
    return result.stdout.strip()


def quote(value):
    return "'" + value.replace("'", "''") + "'"


def choose_context():
    statement = """SELECT json_build_object(
      'item_id',il.inventory_item_id,'location_id',il.location_id,
      'reserved_quantity',il.reserved_quantity::text,'price_set_id',vp.price_set_id,
      'region_id',r.id,'currency_code',r.currency_code)::text
    FROM product_variant_inventory_item vi
    JOIN inventory_item item ON item.id=vi.inventory_item_id AND item.deleted_at IS NULL
    JOIN inventory_level il ON il.inventory_item_id=vi.inventory_item_id
      AND il.deleted_at IS NULL
    JOIN product_variant_price_set vp ON vp.variant_id=vi.variant_id
      AND vp.deleted_at IS NULL
    JOIN price_set ps ON ps.id=vp.price_set_id AND ps.deleted_at IS NULL
    JOIN region r ON r.deleted_at IS NULL
    WHERE vi.deleted_at IS NULL AND r.currency_code='eur'
    ORDER BY vi.variant_id,il.location_id LIMIT 1;"""
    value = json.loads(sql(statement))
    for name in ("item_id", "location_id", "price_set_id", "region_id", "currency_code"):
        if not re.fullmatch(r"[A-Za-z0-9_-]+", value[name]):
            raise RuntimeError("unexpected stage-2 source identifier")
    if not re.fullmatch(r"-?[0-9]+(?:\.[0-9]+)?", value["reserved_quantity"]):
        raise RuntimeError("unexpected reserved quantity")
    return value


def reconcile(timeout=180):
    deadline = time.monotonic() + timeout
    while True:
        try:
            running, complete = verifier.snapshot.connector_state()
            result = verifier.evaluate(verifier.source_rows(), verifier.projection_rows(),
                                       verifier.snapshot.topic_ends(), verifier.projection_offsets(),
                                       running, complete, verifier.snapshot.source_slot())
        except RuntimeError as error:
            if str(error) != "isolated snapshot inspection command failed" or \
                    time.monotonic() >= deadline:
                raise
            time.sleep(5)
            continue
        if result["status"] == "PASS_CONTEXT_ONLY":
            return result
        if time.monotonic() >= deadline:
            failed = {table: checks for table, checks in result["table_counts"].items()
                      if not (checks["key_and_delete_match"] and checks["selected_attributes_match"]
                              and checks["offset_applied"])}
            raise RuntimeError("stage-2 nonempty fixture did not reconcile: " +
                               json.dumps({"checks": result["checks"], "failed_tables": failed},
                                          sort_keys=True))
        time.sleep(5)


def fixture_count():
    statement = ("SELECT json_build_object(" + ",".join(
        f"'{table}',(SELECT count(*) FROM {table} WHERE id={quote(IDS[name])})"
        for name, table in (("reservation", "reservation_item"), ("list", "price_list"),
                            ("rule", "price_list_rule"), ("price", "price"))) + ")::text;")
    return json.loads(sql(statement))


def insert(context):
    sql(f"""BEGIN;
      INSERT INTO reservation_item(id,inventory_item_id,location_id,quantity,allow_backorder)
      VALUES({quote(IDS['reservation'])},{quote(context['item_id'])},
             {quote(context['location_id'])},2,false);
      UPDATE inventory_level SET reserved_quantity=reserved_quantity+2
      WHERE inventory_item_id={quote(context['item_id'])}
        AND location_id={quote(context['location_id'])} AND deleted_at IS NULL;
      INSERT INTO price_list(id,status,starts_at,ends_at,rules_count,title,description,type)
      VALUES({quote(IDS['list'])},'active',now()-interval '1 day',
             now()+interval '1 day',1,'CDC shadow probe','Isolated clone only','sale');
      INSERT INTO price_list_rule(id,price_list_id,attribute,value)
      VALUES({quote(IDS['rule'])},{quote(IDS['list'])},'region_id',
             jsonb_build_array({quote(context['region_id'])}));
      INSERT INTO price(id,price_set_id,currency_code,raw_amount,amount,
                        rules_count,price_list_id)
      VALUES({quote(IDS['price'])},{quote(context['price_set_id'])},
             {quote(context['currency_code'])},
             jsonb_build_object('value','8','precision',20),8,0,{quote(IDS['list'])});
      COMMIT;""")


def remove(context):
    sql(f"""BEGIN;
      DELETE FROM price WHERE id={quote(IDS['price'])};
      DELETE FROM price_list_rule WHERE id={quote(IDS['rule'])};
      DELETE FROM price_list WHERE id={quote(IDS['list'])};
      DELETE FROM reservation_item WHERE id={quote(IDS['reservation'])};
      UPDATE inventory_level SET reserved_quantity={context['reserved_quantity']}
      WHERE inventory_item_id={quote(context['item_id'])}
        AND location_id={quote(context['location_id'])} AND deleted_at IS NULL;
      COMMIT;""")


def main():
    if not verifier.snapshot.PROJECT.fullmatch(os.environ.get("COMPOSE_PROJECT_NAME", "")) or \
            os.environ.get("CDC_COVERAGE_EPOCH") != EPOCH:
        raise RuntimeError("requires the isolated stage2b project and coverage epoch")
    services = set(verifier.snapshot.run(BASE + ["ps", "--services", "--status", "running"]).splitlines())
    if services != {"postgres", "kafka", "connect", "inventory-price-projection-db",
                    "inventory-price-projector"}:
        raise RuntimeError("requires only the five isolated CDC services")
    if any(fixture_count().values()):
        raise RuntimeError("stage-2 fixture IDs already exist; inspect clone before retrying")
    reconcile()
    print(json.dumps({"phase": "baseline", "status": "PASS_CONTEXT_ONLY"}), flush=True)
    context = choose_context()
    insert(context)
    try:
        changed = reconcile()
        counts = fixture_count()
        if any(count != 1 for count in counts.values()):
            raise RuntimeError("stage-2 fixture rows are incomplete")
        print(json.dumps({"phase": "nonempty", "status": changed["status"],
                          "fixture_counts": counts}, sort_keys=True))
    finally:
        remove(context)
    restored = reconcile()
    if any(fixture_count().values()):
        raise RuntimeError("stage-2 fixture cleanup is incomplete")
    print(json.dumps({"phase": "restored", "status": restored["status"]}, sort_keys=True))


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, ValueError, OSError, subprocess.TimeoutExpired) as error:
        raise SystemExit(f"cdc-inventory-price-nonempty-probe: {error}") from None
