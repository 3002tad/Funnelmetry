#!/usr/bin/env python3
"""Prove selected synthetic source orders reached the isolated CDC analytical sink.

This is a read-only CDC-10 probe, not a general proof of source completeness.
It never connects to the live Medusa database or prints source payloads.
"""

import argparse
import json
import re
import subprocess
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parent
BASE = ["docker", "compose", "-f", str(ROOT / "compose.yml")]
MAPPER = BASE + ["-f", str(ROOT / "compose.reference-mapper.yml")]
ANALYTICS = MAPPER + ["-f", str(ROOT / "compose.reference-analytics.yml")]
ORDER_ID = re.compile(r"order_[A-Za-z0-9]+\Z")
LSN = re.compile(r"[0-9A-Fa-f]+/[0-9A-Fa-f]+\Z")


def sql(compose, service, user, database, statement):
    command = compose + ["exec", "-T", service, "psql", "-X", "-U", user,
                         "-d", database, "-At", "-v", "ON_ERROR_STOP=1"]
    result = subprocess.run(command, input=statement, text=True,
                            capture_output=True, check=False)
    if result.returncode:
        raise RuntimeError(f"read-only shadow query failed for {service}")
    rows = [line for line in result.stdout.splitlines() if line.startswith("{")]
    if len(rows) != 1:
        raise RuntimeError(f"unexpected read-only shadow result from {service}")
    return json.loads(rows[0])


def observe(order_ids, baseline_lsn=None):
    values = ",".join(f"'{value}'" for value in order_ids)
    baseline_sql = (f"confirmed_flush_lsn >= '{baseline_lsn}'::pg_lsn"
                    if baseline_lsn else "true")
    source = sql(BASE, "postgres", "medusa", "medusa", f"""
      BEGIN READ ONLY;
      SELECT json_build_object(
        'source_orders', (SELECT count(*) FROM public."order" WHERE id IN ({values})),
        'eligible_orders', (SELECT count(*) FROM public."order" o WHERE o.id IN ({values})
          AND o.deleted_at IS NULL AND EXISTS (
            SELECT 1 FROM public.order_cart oc JOIN public.cart c ON c.id=oc.cart_id
            WHERE oc.order_id=o.id AND c.completed_at IS NOT NULL)),
        'source_txids', (SELECT COALESCE(json_agg(txid ORDER BY txid),'[]'::json)
          FROM (SELECT DISTINCT txid FROM (
            SELECT o.xmin::text::bigint AS txid FROM public."order" o WHERE o.id IN ({values})
            UNION ALL SELECT oc.xmin::text::bigint FROM public.order_cart oc
              WHERE oc.order_id IN ({values})
            UNION ALL SELECT c.xmin::text::bigint FROM public.order_cart oc
              JOIN public.cart c ON c.id=oc.cart_id WHERE oc.order_id IN ({values})
          ) versions) distinct_versions),
        'slot_count', (SELECT count(*) FROM pg_replication_slots
          WHERE slot_name='funnelmetry_cdc_shadow'),
        'slot_status', (SELECT wal_status FROM pg_replication_slots
          WHERE slot_name='funnelmetry_cdc_shadow'),
        'confirmed_lsn', (SELECT confirmed_flush_lsn::text FROM pg_replication_slots
          WHERE slot_name='funnelmetry_cdc_shadow'),
        'confirmed_past_baseline', (SELECT {baseline_sql}
          FROM pg_replication_slots WHERE slot_name='funnelmetry_cdc_shadow'),
        'retained_wal_bytes', (SELECT pg_wal_lsn_diff(pg_current_wal_lsn(),restart_lsn)
          FROM pg_replication_slots WHERE slot_name='funnelmetry_cdc_shadow'),
        'safe_wal_size_bytes', (SELECT safe_wal_size FROM pg_replication_slots
          WHERE slot_name='funnelmetry_cdc_shadow'))::text;
      COMMIT;
    """)
    txids = source["source_txids"]
    if any(not isinstance(value, int) or value < 0 for value in txids):
        raise RuntimeError("invalid source transaction IDs")
    tx_values = ",".join(str(value) for value in txids) or "NULL"
    mapper = sql(MAPPER, "reference-projection-db", "reference_mapper",
                 "reference_projection", f"""
      BEGIN READ ONLY;
      SELECT json_build_object(
        'projected_orders', (SELECT count(*) FROM fact_state
          WHERE order_id IN ({values}) AND active),
        'source_transactions_processed', (SELECT count(DISTINCT txid) FROM cdc_ends
          WHERE txid IN ({tx_values}) AND processed_at IS NOT NULL),
        'pending_ends', (SELECT count(*) FROM cdc_ends WHERE processed_at IS NULL),
        'pending_outbox', (SELECT count(*) FROM fact_outbox WHERE published_at IS NULL))::text;
      COMMIT;
    """)
    sink = sql(ANALYTICS, "reference-analytics-db", "reference_analytics",
               "reference_analytics", f"""
      BEGIN READ ONLY;
      SELECT json_build_object(
        'sink_orders', (SELECT count(*) FROM reference_order_current_state
          WHERE source_instance_id='medusa-reference-shadow'
            AND order_id IN ({values}) AND active))::text;
      COMMIT;
    """)
    return {"source": source, "mapper": mapper, "sink": sink}


def evaluate(observation, expected_count):
    source, mapper, sink = (observation[key] for key in ("source", "mapper", "sink"))
    checks = {
        "source_orders_exist": source["source_orders"] == expected_count,
        "source_orders_eligible": source["eligible_orders"] == expected_count,
        "slot_usable": source["slot_count"] == 1
        and source["slot_status"] in ("reserved", "extended"),
        "connector_confirmed_baseline": source["confirmed_past_baseline"] is True,
        "source_transactions_processed": bool(source["source_txids"])
        and mapper["source_transactions_processed"] == len(source["source_txids"]),
        "mapper_has_orders": mapper["projected_orders"] == expected_count,
        "mapper_drained": mapper["pending_ends"] == 0 and mapper["pending_outbox"] == 0,
        "sink_has_orders": sink["sink_orders"] == expected_count,
    }
    return {"status": "PASS" if all(checks.values()) else "WAIT",
            "checks": checks, "confirmed_lsn": source["confirmed_lsn"],
            "source_transaction_count": len(source["source_txids"]),
            "retained_wal_bytes": source["retained_wal_bytes"],
            "safe_wal_size_bytes": source["safe_wal_size_bytes"]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--baseline-lsn", help="LSN captured before the synthetic workload")
    parser.add_argument("--expect-order", action="append", required=True)
    parser.add_argument("--timeout-seconds", type=int, default=0)
    args = parser.parse_args()
    if args.baseline_lsn and not LSN.fullmatch(args.baseline_lsn):
        parser.error("baseline LSN must be hexadecimal X/Y")
    if any(not ORDER_ID.fullmatch(value) for value in args.expect_order):
        parser.error("expected order IDs must be synthetic Medusa order IDs")
    if len(set(args.expect_order)) != len(args.expect_order):
        parser.error("expected order IDs must be unique")
    if args.timeout_seconds < 0 or args.timeout_seconds > 600:
        parser.error("timeout must be between 0 and 600 seconds")
    deadline = time.monotonic() + args.timeout_seconds
    while True:
        result = evaluate(observe(args.expect_order, args.baseline_lsn),
                          len(args.expect_order))
        if result["status"] == "PASS" or time.monotonic() >= deadline:
            print(json.dumps(result, sort_keys=True))
            return 0 if result["status"] == "PASS" else 1
        time.sleep(2)


if __name__ == "__main__":
    raise SystemExit(main())
