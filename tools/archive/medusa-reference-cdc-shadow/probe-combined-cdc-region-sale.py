#!/usr/bin/env python3
"""Clone-only CDC sale price with one dated region rule versus Medusa Store API."""

import importlib.util
import json
import os
import re
import subprocess
import time
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path


ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location(
    "combined_transition", ROOT / "probe-combined-cdc-transition.py")
transition = importlib.util.module_from_spec(spec)
spec.loader.exec_module(transition)
combined = transition.combined
api = transition.api
fixture = transition.fixture
governed = transition.inventory
catalog = transition.catalog

LIST = "fm_cdc_combined_sale_list"
RULE = "fm_cdc_combined_sale_rule"
PRICE = "fm_cdc_combined_sale_price"
SALE_AMOUNT = Decimal("8")


def sql(statement):
    return fixture.sql(statement)


def fixture_count():
    return tuple(int(part) for part in sql(f"""SELECT
      (SELECT count(*) FROM price_list WHERE id={fixture.quote(LIST)}),
      (SELECT count(*) FROM price_list_rule WHERE id={fixture.quote(RULE)}),
      (SELECT count(*) FROM price WHERE id={fixture.quote(PRICE)});""").split("|"))


def add(context):
    sql(f"""BEGIN;
INSERT INTO price_list(id,status,starts_at,ends_at,rules_count,title,description,type)
 VALUES({fixture.quote(LIST)},'active',now()-interval '1 day',
        now()+interval '1 day',1,'CDC clone region sale',
        'Isolated CDC conformance fixture','sale');
INSERT INTO price_list_rule(id,price_list_id,attribute,value)
 VALUES({fixture.quote(RULE)},{fixture.quote(LIST)},'region_id',
        jsonb_build_array({fixture.quote(context['region_id'])}));
INSERT INTO price(id,price_set_id,currency_code,raw_amount,amount,
                  rules_count,price_list_id)
 VALUES({fixture.quote(PRICE)},{fixture.quote(context['price_set_id'])},
        {fixture.quote(context['currency_code'])},
        jsonb_build_object('value','8','precision',20),8,0,{fixture.quote(LIST)});
COMMIT;""")


def remove():
    sql(f"""BEGIN;
DELETE FROM price WHERE id={fixture.quote(PRICE)};
DELETE FROM price_list_rule WHERE id={fixture.quote(RULE)};
DELETE FROM price_list WHERE id={fixture.quote(LIST)};
COMMIT;""")


def reconcile(timeout=180):
    deadline = time.monotonic() + timeout
    while True:
        first = catalog.old.evaluate(catalog.old.source(), catalog.projection(),
                                     catalog.old.topic_ends(), catalog.old.connector_running())
        second = governed.stage2.evaluate(
            governed.stage2.source_rows(), governed.candidate_rows(),
            governed.snapshot.topic_ends(), governed.candidate_offsets(),
            *governed.snapshot.connector_state(), governed.snapshot.source_slot())
        if first["status"] == "PASS" and second["status"] == "PASS_CONTEXT_ONLY":
            return second
        if time.monotonic() >= deadline:
            raise RuntimeError("combined catalog/stage-2 projections did not reconcile")
        time.sleep(5)


def main():
    if (os.environ.get("COMPOSE_PROJECT_NAME") != combined.PROJECT or
            not re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,63}",
                             os.environ.get("CATALOG_CDC_COVERAGE_EPOCH", "")) or
            not re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,63}",
                             os.environ.get("CDC_COVERAGE_EPOCH", ""))):
        raise RuntimeError("requires the exact isolated combined CDC clone and epochs")
    combined.verify_common_clone_source()
    if fixture_count() != (0, 0, 0):
        raise RuntimeError("sale fixture already exists; inspect clone before retrying")
    reconcile()
    context = api.sample_context()
    before = api.store_variant(context)
    if Decimal(str(before["calculated_amount"])) <= SALE_AMOUNT:
        raise RuntimeError("selected variant has no higher baseline price")
    added = False
    report = None
    try:
        add(context)
        added = True
        stage2 = reconcile()
        combined.stage2_probe.require_numeric_consistency()
        after = api.store_variant(context)
        publication = subprocess.run(
            ["python3", str(ROOT / "publish-catalog-governed-quality.py"),
             "--lease-seconds", "120", "--evidence-ref", "combined-c1-region-sale-20261030"],
            text=True, capture_output=True, check=False)
        if publication.returncode:
            raise RuntimeError("combined catalog quality publication failed")
        pair = combined.catalog_pair.resolve_pair(
            combined.catalog_observation(os.environ["CATALOG_CDC_COVERAGE_EPOCH"],
                                         context["product_id"], context["variant_id"]),
            source_id=combined.SOURCE_ID,
            coverage_epoch_id=os.environ["CATALOG_CDC_COVERAGE_EPOCH"])
        if pair["status"] != "PASS_CONTEXT_ONLY":
            raise RuntimeError("catalog CDC pair did not pass quality")
        resolved = combined.stage2_probe.resolver.resolve_region_sale_price(
            governed.candidate_rows(), variant_id=pair["variant"]["variant_id"],
            currency_code=context["currency_code"], region_id=context["region_id"],
            at=datetime.now(timezone.utc).isoformat(), context_reconciled=True,
            verified_tables=stage2["table_counts"].keys())
        matches = (resolved.get("status") == "PASS_SAMPLE_ONLY" and
                   Decimal(str(resolved.get("amount"))) ==
                   Decimal(str(after["calculated_amount"])) == SALE_AMOUNT and
                   Decimal(str(resolved.get("original_amount"))) ==
                   Decimal(str(before["calculated_amount"])) and
                   after.get("price_list_type") == resolved.get("price_list_type") == "sale")
        report = {"status": "PASS_SAMPLE_ONLY" if matches else "BLOCKED_BY_QUALITY",
                  "catalog_source": "governed_cdc", "price_source": "governed_cdc",
                  "stage2_reconciled": stage2["status"] == "PASS_CONTEXT_ONLY",
                  "resolver_reason": resolved.get("reason"),
                  "resolver_matches_store_api": matches,
                  "sale_amount": str(after["calculated_amount"]),
                  "price_list_type": after.get("price_list_type")}
        print(json.dumps(report, sort_keys=True), flush=True)
    finally:
        if added or fixture_count() != (0, 0, 0):
            remove()
            reconcile()
    if fixture_count() != (0, 0, 0) or api.store_variant(context) != before:
        raise RuntimeError("region sale fixture did not restore")
    print(json.dumps({"phase": "restored", "status": "RESTORED"}, sort_keys=True))
    return 0 if report and report["status"] == "PASS_SAMPLE_ONLY" else 1


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (RuntimeError, ValueError, OSError, subprocess.TimeoutExpired) as error:
        raise SystemExit(f"combined-cdc-region-sale: {error}") from None
