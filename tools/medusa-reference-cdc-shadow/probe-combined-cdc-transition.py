#!/usr/bin/env python3
"""Clone-only cross-profile UPDATE/restore and CDC read-path conformance probe."""

import importlib.util
import json
import os
import re
import subprocess
import time
from decimal import Decimal
from pathlib import Path


ROOT = Path(__file__).resolve().parent


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


combined = load("combined_probe", "probe-inventory-price-cdc-only-candidate.py")
catalog = load("catalog_governed", "verify-catalog-governed-candidate.py")
inventory = load("inventory_governed", "verify-inventory-price-governed-candidate.py")
fixture = combined.stage2_probe.api.fixture
api = combined.stage2_probe.api
PROJECT = combined.PROJECT
MARKER = " [CDC combined c1]"


def sql(statement):
    return fixture.sql(statement)


def source_state(context):
    result = sql(f"""SELECT json_build_object(
      'title',p.title,'stocked',il.stocked_quantity::text,
      'raw',il.raw_stocked_quantity,'level_id',il.id)::text
      FROM product p JOIN inventory_level il ON il.inventory_item_id=
        {fixture.quote(context['item_id'])} AND il.location_id=
        {fixture.quote(context['location_id'])}
      WHERE p.id={fixture.quote(context['product_id'])} AND il.deleted_at IS NULL;""")
    return json.loads(result)


def mutate(context):
    statement = f"""BEGIN;
WITH p AS (UPDATE product SET title=title || {fixture.quote(MARKER)}
  WHERE id={fixture.quote(context['product_id'])} RETURNING id),
l AS (UPDATE inventory_level
  SET stocked_quantity=stocked_quantity+7,
      raw_stocked_quantity=jsonb_set(raw_stocked_quantity,'{{value}}',
        to_jsonb((stocked_quantity+7)::text),false)
  WHERE id={fixture.quote(context['level_id'])} RETURNING id)
SELECT json_build_object('product',(SELECT count(*) FROM p),
                         'level',(SELECT count(*) FROM l))::text;
COMMIT;"""
    counts = json.loads(next(line for line in sql(statement).splitlines()
                             if line.startswith("{")))
    if counts != {"product": 1, "level": 1}:
        raise RuntimeError("combined clone mutation did not touch one row per profile")


def restore(context, original):
    statement = f"""BEGIN;
WITH p AS (UPDATE product SET title={fixture.quote(original['title'])}
  WHERE id={fixture.quote(context['product_id'])} RETURNING id),
l AS (UPDATE inventory_level
  SET stocked_quantity={fixture.quote(original['stocked'])}::numeric,
      raw_stocked_quantity={fixture.quote(json.dumps(original['raw']))}::jsonb
  WHERE id={fixture.quote(context['level_id'])} RETURNING id)
SELECT json_build_object('product',(SELECT count(*) FROM p),
                         'level',(SELECT count(*) FROM l))::text;
COMMIT;"""
    counts = json.loads(next(line for line in sql(statement).splitlines()
                             if line.startswith("{")))
    if counts != {"product": 1, "level": 1}:
        raise RuntimeError("combined clone restore did not touch one row per profile")


def reconcile(timeout=180):
    deadline = time.monotonic() + timeout
    while True:
        first = catalog.old.evaluate(catalog.old.source(), catalog.projection(),
                                     catalog.old.topic_ends(), catalog.old.connector_running())
        second = inventory.stage2.evaluate(
            inventory.stage2.source_rows(), inventory.candidate_rows(),
            inventory.snapshot.topic_ends(), inventory.candidate_offsets(),
            *inventory.snapshot.connector_state(), inventory.snapshot.source_slot())
        if first["status"] == "PASS" and second["status"] == "PASS_CONTEXT_ONLY":
            return first, second
        if time.monotonic() >= deadline:
            raise RuntimeError("combined CDC projections did not reconcile")
        time.sleep(5)


def run_combined(phase):
    env = dict(os.environ)
    publication = subprocess.run(
        ["python3", str(ROOT / "publish-catalog-governed-quality.py"),
         "--lease-seconds", "120", "--evidence-ref", f"combined-c1-{phase}-20261029"],
        env=env, text=True, capture_output=True, check=False)
    if publication.returncode:
        raise RuntimeError("combined catalog quality publication failed")
    result = subprocess.run(["python3", str(ROOT / "probe-inventory-price-cdc-only-candidate.py")],
                            env=env, text=True, capture_output=True, check=False)
    if result.returncode:
        raise RuntimeError("combined CDC read path failed")
    report = json.loads(result.stdout.strip().splitlines()[-1])
    if report.get("status") != "PASS_SAMPLE_ONLY":
        raise RuntimeError("combined CDC read path did not match Store API")
    return report


def main():
    if (os.environ.get("COMPOSE_PROJECT_NAME") != PROJECT or
            not re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,63}",
                             os.environ.get("CATALOG_CDC_COVERAGE_EPOCH", "")) or
            not re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,63}",
                             os.environ.get("CDC_COVERAGE_EPOCH", ""))):
        raise RuntimeError("requires exact combined isolated clone and epochs")
    combined.verify_common_clone_source()
    context = api.sample_context()
    original = source_state(context)
    context["level_id"] = original["level_id"]
    if MARKER in original["title"]:
        raise RuntimeError("clone fixture marker already exists")
    before = api.store_variant(context)
    changed = False
    try:
        changed = True
        mutate(context)
        reconcile()
        changed_source = source_state(context)
        if changed_source["title"] != original["title"] + MARKER:
            raise RuntimeError("catalog clone source title did not change")
        after = api.store_variant(context)
        if (Decimal(str(after["inventory_quantity"])) -
                Decimal(str(before["inventory_quantity"]))) != 7:
            raise RuntimeError("Store API did not observe clone stock change")
        run_combined("updated")
        print(json.dumps({"phase": "updated", "status": "PASS_SAMPLE_ONLY",
                          "stock_delta": "7", "catalog_and_inventory_reconciled": True}))
    finally:
        if changed:
            restore(context, original)
            reconcile()
    restored = source_state(context)
    if restored != original or api.store_variant(context) != before:
        raise RuntimeError("combined clone fixture did not restore")
    run_combined("restored")
    print(json.dumps({"phase": "restored", "status": "PASS_SAMPLE_ONLY",
                      "catalog_and_inventory_reconciled": True}))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (RuntimeError, ValueError, OSError, StopIteration) as error:
        raise SystemExit(f"combined-cdc-transition: {error}") from None
