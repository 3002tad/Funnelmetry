#!/usr/bin/env python3
"""Fail-closed source/mapper/sink reconciliation for CDC-10 epoch 2.

`--write-quality` persists the current-state readiness gate only in the
isolated analytical DB. It never publishes metadata to the live Pipeline.
"""

import argparse
import hashlib
import json
import os
import subprocess
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parent
BASE = ["docker", "compose", "-f", str(ROOT / "compose.yml")]
FULL = BASE + ["-f", str(ROOT / "compose.recovery-epoch.yml")]
EPOCH = "cdc10-epoch2"
PREFIX = "cdc_shadow_medusa_epoch2"
FACT = "cdc_shadow_reference.order_recorded_state.v2"
TABLES = ("order", "order_cart", "cart")


def run(command, stdin=None):
    result = subprocess.run(command, input=stdin, text=True, capture_output=True, check=False)
    if result.returncode:
        raise RuntimeError(f"recovery verification command failed: {command[0]} (exit {result.returncode})")
    return result.stdout.strip()


def sql(compose, service, user, db, statement):
    output = run(compose + ["exec", "-T", service, "psql", "-X", "-U", user,
                            "-d", db, "-At", "-v", "ON_ERROR_STOP=1"], statement)
    rows = [line for line in output.splitlines() if line.startswith("{")]
    if len(rows) != 1:
        raise RuntimeError("unexpected recovery verification SQL result")
    return json.loads(rows[0])


def source():
    return sql(BASE, "postgres", "medusa", "medusa", '''
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT json_build_object(
 'states', (SELECT COALESCE(json_agg(json_build_object(
   'order_id',o.id,'active',o.deleted_at IS NULL AND q.cart_count=1,
   'cart_id',CASE WHEN o.deleted_at IS NULL AND q.cart_count=1 THEN q.cart_id
     ELSE NULL END) ORDER BY o.id),'[]'::json)
   FROM public."order" o CROSS JOIN LATERAL
     (SELECT count(DISTINCT oc.cart_id) AS cart_count,min(oc.cart_id) AS cart_id
      FROM public.order_cart oc JOIN public.cart c ON c.id=oc.cart_id
        AND c.completed_at IS NOT NULL WHERE oc.order_id=o.id) q),
 'ambiguous_orders', (SELECT count(*) FROM public."order" o WHERE
   (SELECT count(DISTINCT oc.cart_id) FROM public.order_cart oc
     JOIN public.cart c ON c.id=oc.cart_id AND c.completed_at IS NOT NULL
     WHERE oc.order_id=o.id)>1),
 'old_slot', (SELECT wal_status FROM pg_replication_slots
   WHERE slot_name='funnelmetry_cdc_shadow'),
 'new_slot', (SELECT wal_status FROM pg_replication_slots
   WHERE slot_name='funnelmetry_cdc10_epoch2'),
 'slot_safe_wal_size', (SELECT safe_wal_size FROM pg_replication_slots
   WHERE slot_name='funnelmetry_cdc10_epoch2'),
 'max_slot_wal_keep_size', current_setting('max_slot_wal_keep_size'))::text;
COMMIT;''')


def mapper():
    return sql(FULL, "recovery-projection-db", "recovery_mapper", "recovery_projection", '''
SELECT json_build_object(
 'epoch', (SELECT row_to_json(e) FROM recovery_epochs e
   WHERE coverage_epoch_id='cdc10-epoch2'),
 'states', (SELECT COALESCE(json_agg(json_build_object('order_id',order_id,
   'active',active,'cart_id',CASE WHEN active THEN cart_id ELSE NULL END)
   ORDER BY order_id),'[]'::json) FROM recovery_state),
 'snapshot_counts', (SELECT COALESCE(json_object_agg(table_name,n),'{}'::json)
   FROM (SELECT table_name,count(*) AS n FROM recovery_snapshot_rows GROUP BY table_name) x),
 'input_offsets', (SELECT COALESCE(json_object_agg(topic,next_offset),'{}'::json)
   FROM recovery_input_offsets WHERE partition=0),
 'pending_ends', (SELECT count(*) FROM recovery_ends WHERE processed_at IS NULL),
 'last_end', (SELECT end_id FROM recovery_ends WHERE processed_at IS NOT NULL
   ORDER BY topic_offset DESC LIMIT 1),
 'outbox_total', (SELECT count(*) FROM recovery_outbox),
 'outbox_unpublished', (SELECT count(*) FROM recovery_outbox WHERE published_at IS NULL),
 'transition_count', (SELECT count(*) FROM recovery_outbox
   WHERE record_type='TRANSITION'),
 'baseline_count', (SELECT count(*) FROM recovery_outbox WHERE record_type='BASELINE'))::text;
''')


def sink():
    return sql(FULL, "recovery-analytics-db", "recovery_analytics", "recovery_analytics", '''
SELECT json_build_object(
 'quality', (SELECT row_to_json(q) FROM recovery_quality_state q
   WHERE coverage_epoch_id='cdc10-epoch2'),
 'states', (SELECT COALESCE(json_agg(json_build_object('order_id',order_id,
   'active',active,'cart_id',CASE WHEN active THEN cart_id ELSE NULL END)
   ORDER BY order_id),'[]'::json) FROM recovery_order_current_state
   WHERE coverage_epoch_id='cdc10-epoch2'),
 'next_offset', (SELECT next_offset FROM recovery_sink_offsets
   WHERE topic='cdc_shadow_reference.order_recorded_state.v2' AND partition=0),
 'inbox_count', (SELECT count(*) FROM recovery_record_inbox),
 'transition_count', (SELECT count(*) FROM recovery_record_inbox
   WHERE record_type='TRANSITION'),
 'baseline_count', (SELECT count(*) FROM recovery_record_inbox
   WHERE record_type='BASELINE'),
 'readable_count', (SELECT count(*) FROM recovery_order_current_state_readable),
 'metadata', (SELECT json_build_object('status',definition->>'status',
   'version',version,'published',definition->>'pipeline_catalog_published')
   FROM recovery_semantic_catalog
   WHERE catalog_id='cdc-shadow-reference-recovery-analytics'
   AND version='2.0.1-shadow'))::text;
''')


def end_offset(topic):
    output = run(BASE + ["exec", "-T", "kafka", "/opt/kafka/bin/kafka-get-offsets.sh",
                         "--bootstrap-server", "kafka:9092", "--topic", topic])
    rows = [line for line in output.splitlines() if line.startswith(topic + ":0:")]
    if len(rows) != 1:
        raise RuntimeError("missing or partitioned recovery topic")
    return int(rows[0].rsplit(":", 1)[1])


def connector_running():
    output = run(BASE + ["exec", "-T", "connect", "curl", "-fsS", "--max-time", "10",
                         "http://127.0.0.1:8083/connectors/cdc-shadow-medusa-rebaseline-cdc10-epoch2/status"])
    status = json.loads(output)
    return status.get("connector", {}).get("state") == "RUNNING" and bool(status.get("tasks")) and all(
        task.get("state") == "RUNNING" for task in status["tasks"])


def digest(rows):
    return hashlib.sha256(json.dumps(rows, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def evaluate(source_state, projected, analytical, ends, running):
    source_map = {row["order_id"]: (row["active"], row["cart_id"]) for row in source_state["states"]}
    mapper_map = {row["order_id"]: (row["active"], row["cart_id"]) for row in projected["states"]}
    sink_map = {row["order_id"]: (row["active"], row["cart_id"]) for row in analytical["states"]}
    expected_topics = {f"{PREFIX}.public.{table}" for table in TABLES} | {f"{PREFIX}.transaction"}
    epoch = projected["epoch"] or {}
    quality = analytical["quality"] or {}
    metadata = analytical["metadata"] or {}
    checks = {
        "source_unambiguous": source_state["ambiguous_orders"] == 0,
        "old_gap_explicit": source_state["old_slot"] == "lost" and
            epoch.get("previous_epoch_gap") == "INCOMPLETE" and
            quality.get("historical_gap_status") == "INCOMPLETE",
        "new_slot_usable": source_state["new_slot"] in ("reserved", "extended"),
        "wal_budget_headroom": source_state.get("max_slot_wal_keep_size") == "256MB" and
            source_state.get("slot_safe_wal_size") is not None and
            int(source_state["slot_safe_wal_size"]) >= 64 * 1024 * 1024,
        "connector_running": running,
        "snapshot_complete": epoch.get("snapshot_last_seen") is True and
            epoch.get("status") == "BASELINE_VERIFIED" and
            quality.get("baseline_complete") is True,
        "baseline_no_false_on": projected["baseline_count"] == quality.get("baseline_orders") and
            projected["baseline_count"] == analytical["baseline_count"],
        "baseline_digest_equal": epoch.get("baseline_digest") == quality.get("baseline_digest") and
            epoch.get("baseline_digest") is not None,
        "ordered_prefix_complete": projected["pending_ends"] == 0,
        "mapper_offsets_caught_up": set(projected["input_offsets"]) == expected_topics and
            all(int(projected["input_offsets"].get(topic, -1)) == ends[topic]
                for topic in expected_topics),
        "sink_offset_caught_up": analytical["next_offset"] is not None and
            int(analytical["next_offset"]) == ends[FACT],
        "outbox_published": projected["outbox_unpublished"] == 0 and
            projected["outbox_total"] == analytical["inbox_count"],
        "transition_count_equal": projected["transition_count"] == analytical["transition_count"],
        "source_mapper_equal": source_map == mapper_map,
        "mapper_sink_equal": mapper_map == sink_map,
        "metadata_shadow_only": metadata == {"status": "SHADOW_ONLY_CANDIDATE",
            "version": "2.0.1-shadow", "published": "false"},
    }
    return {"status": "PASS" if all(checks.values()) else "BLOCKED_BY_QUALITY",
            "checks": checks, "source_orders": len(source_map),
            "mapper_orders": len(mapper_map), "sink_orders": len(sink_map),
            "active_orders": sum(active for active, _ in sink_map.values()),
            "baseline_records": analytical["baseline_count"],
            "transition_records": analytical["transition_count"],
            "source_digest": digest(source_map), "mapper_digest": digest(mapper_map),
            "sink_digest": digest(sink_map),
            "historical_gap_status": quality.get("historical_gap_status"),
            "wal_safe_bytes": source_state.get("slot_safe_wal_size"),
            "wal_budget_warning": source_state.get("slot_safe_wal_size") is None or
                int(source_state["slot_safe_wal_size"]) < 128 * 1024 * 1024,
            "quality_state": quality.get("status"), "fact_topic_offset": ends[FACT],
            "sink_next_offset": analytical["next_offset"]}


def write_quality(result):
    status = "CURRENT_STATE_READY" if result["status"] == "PASS" else "BLOCKED_BY_QUALITY"
    reason = "SOURCE_MAPPER_SINK_RECONCILED" if status == "CURRENT_STATE_READY" else "RECOVERY_RECONCILIATION_FAILED"
    statement = f"""UPDATE recovery_quality_state SET status='{status}',reason='{reason}',
      verified_at=now() WHERE coverage_epoch_id='{EPOCH}' AND historical_gap_status='INCOMPLETE';"""
    output = run(FULL + ["exec", "-T", "recovery-analytics-db", "psql", "-X", "-U",
                "recovery_analytics", "-d", "recovery_analytics", "-v", "ON_ERROR_STOP=1"], statement)
    if "UPDATE 1" not in output.splitlines():
        raise RuntimeError("recovery quality row was not updated")
    result["quality_state"] = status
    result["expected_readable_orders_after_write"] = result["sink_orders"] if status == "CURRENT_STATE_READY" else 0


def block_quality(reason):
    """Best-effort persistence when a dependency fails before reconciliation.

    The analytical database can itself be unavailable. In that case no writer can
    claim readiness; consumers must also apply a freshness limit to verified_at.
    """
    safe_reason = "VERIFIER_DEPENDENCY_UNAVAILABLE" if reason else "RECOVERY_RECONCILIATION_FAILED"
    statement = f"""UPDATE recovery_quality_state SET status='BLOCKED_BY_QUALITY',
      reason='{safe_reason}',verified_at=NULL
      WHERE coverage_epoch_id='{EPOCH}';"""
    run(FULL + ["exec", "-T", "recovery-analytics-db", "psql", "-X", "-U",
                "recovery_analytics", "-d", "recovery_analytics", "-v", "ON_ERROR_STOP=1"], statement)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--timeout-seconds", type=int, default=0)
    parser.add_argument("--write-quality", action="store_true")
    args = parser.parse_args()
    if os.environ.get("COMPOSE_PROJECT_NAME") != "funnelmetry_cdc_shadow_cdc10":
        parser.error("only the isolated CDC-10 clone may be verified")
    if not 0 <= args.timeout_seconds <= 600:
        parser.error("timeout must be 0..600 seconds")
    deadline = time.monotonic() + args.timeout_seconds
    while True:
        try:
            result = evaluate(source(), mapper(), sink(),
                              {topic: end_offset(topic) for topic in
                               [*(f"{PREFIX}.public.{table}" for table in TABLES),
                                f"{PREFIX}.transaction", FACT]}, connector_running())
        except (RuntimeError, ValueError, OSError, subprocess.TimeoutExpired):
            if args.write_quality:
                block_quality(True)
            if time.monotonic() >= deadline:
                raise
            time.sleep(5)
            continue
        if result["status"] == "PASS" or time.monotonic() >= deadline:
            if args.write_quality:
                write_quality(result)
            print(json.dumps(result, sort_keys=True))
            return 0 if result["status"] == "PASS" else 1
        time.sleep(5)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (RuntimeError, ValueError, OSError, subprocess.TimeoutExpired) as error:
        raise SystemExit(f"recovery-verifier: {error}") from None
