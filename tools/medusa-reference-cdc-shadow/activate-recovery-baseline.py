#!/usr/bin/env python3
"""Verify and atomically seed the durable CDC-10 epoch-2 shadow baseline.

Requires the mapper to be stopped after it has ingested the entire snapshot.
The prior in-memory semantic probe is the independently verified snapshot
checkpoint. No snapshot row is emitted as a business ON transition.
"""

import hashlib
import json
import os
import re
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parent
PROJECT = "funnelmetry_cdc_shadow_cdc10"
EPOCH = "cdc10-epoch2"
PREFIX = "cdc_shadow_medusa_epoch2"
BASE = ["docker", "compose", "-f", str(ROOT / "compose.yml")]
FULL = BASE + ["-f", str(ROOT / "compose.recovery-epoch.yml")]
CHECKPOINT = ROOT / "private" / "cdc10-rebaseline-epoch2.json"
TABLES = ("order", "order_cart", "cart")


def run(command, stdin=None):
    result = subprocess.run(command, input=stdin, text=True, capture_output=True, check=False)
    if result.returncode:
        raise RuntimeError(f"isolated recovery command failed: {command[0]} (exit {result.returncode})")
    return result.stdout.strip()


def sql(compose, service, user, db, statement):
    return run(compose + ["exec", "-T", service, "psql", "-X", "-U", user,
                          "-d", db, "-At", "-v", "ON_ERROR_STOP=1"], statement)


def mapper(statement):
    return sql(FULL, "recovery-projection-db", "recovery_mapper", "recovery_projection", statement)


def source(statement):
    return sql(BASE, "postgres", "medusa", "medusa", statement)


def quote(value):
    return "'" + str(value).replace("'", "''") + "'"


def topic_end(topic):
    output = run(BASE + ["exec", "-T", "kafka", "/opt/kafka/bin/kafka-get-offsets.sh",
                         "--bootstrap-server", "kafka:9092", "--topic", topic])
    lines = [line for line in output.splitlines() if line.startswith(topic + ":0:")]
    if len(lines) != 1:
        raise RuntimeError("missing or partitioned recovery topic")
    return int(lines[0].rsplit(":", 1)[1])


def checkpoint():
    if CHECKPOINT.is_symlink() or not CHECKPOINT.is_file() or CHECKPOINT.stat().st_mode & 0o077:
        raise RuntimeError("missing or non-private epoch-2 semantic checkpoint")
    value = json.loads(CHECKPOINT.read_text(encoding="utf-8"))
    if (value.get("coverage_epoch_id") != EPOCH or value.get("status") != "BASELINE_VERIFIED"
            or value.get("previous_epoch_status") != "INCOMPLETE"
            or value.get("snapshot_mode") != "initial"
            or not re.fullmatch(r"[0-9a-f]{64}", value.get("baseline_digest", ""))):
        raise RuntimeError("semantic checkpoint is not the verified incomplete-gap epoch")
    return value


def state():
    output = mapper('''SELECT json_build_object(
      'epoch', (SELECT row_to_json(e) FROM recovery_epochs e
        WHERE coverage_epoch_id='cdc10-epoch2'),
      'orders', (SELECT COALESCE(json_agg(json_build_object('id',id,'present',present)
        ORDER BY id),'[]'::json) FROM recovery_source_orders),
      'links', (SELECT COALESCE(json_agg(json_build_object('id',id,'order_id',order_id,
        'cart_id',cart_id) ORDER BY id),'[]'::json) FROM recovery_source_links),
      'carts', (SELECT COALESCE(json_agg(json_build_object('id',id,'completed',completed)
        ORDER BY id),'[]'::json) FROM recovery_source_carts),
      'snapshot_counts', (SELECT COALESCE(json_object_agg(table_name,n),'{}'::json)
        FROM (SELECT table_name,count(*) AS n FROM recovery_snapshot_rows
          GROUP BY table_name) s),
      'offsets', (SELECT COALESCE(json_object_agg(topic,next_offset),'{}'::json)
        FROM recovery_input_offsets WHERE partition=0),
      'state_count', (SELECT count(*) FROM recovery_state),
      'outbox_count', (SELECT count(*) FROM recovery_outbox))::text;''')
    rows = [line for line in output.splitlines() if line.startswith("{")]
    if len(rows) != 1:
        raise RuntimeError("unexpected mapper state query shape")
    return json.loads(rows[0])


def pairs_from(state_value):
    orders = {row["id"]: row for row in state_value["orders"]}
    carts = {row["id"]: row for row in state_value["carts"]}
    pairs = {}
    for link in state_value["links"]:
        order = orders.get(link["order_id"])
        cart = carts.get(link["cart_id"])
        if order and order["present"] and cart and cart["completed"]:
            if link["order_id"] in pairs and pairs[link["order_id"]] != link["cart_id"]:
                raise RuntimeError("multiple eligible carts in baseline")
            pairs[link["order_id"]] = link["cart_id"]
    digest = hashlib.sha256(json.dumps(pairs, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    return pairs, digest


def main():
    if os.environ.get("COMPOSE_PROJECT_NAME") != PROJECT:
        raise RuntimeError("baseline gate requires the isolated CDC-10 project")
    running = set(run(FULL + ["ps", "--status", "running", "--services"]).splitlines())
    if "recovery-mapper" in running or "backend" in running:
        raise RuntimeError("stop recovery mapper and source backend before baseline activation")
    if not {"postgres", "kafka", "connect", "recovery-projection-db"}.issubset(running):
        raise RuntimeError("recovery baseline infrastructure is not running")
    saved = checkpoint()
    slots = source("""SELECT (SELECT wal_status FROM pg_replication_slots
      WHERE slot_name='funnelmetry_cdc_shadow') || '|' ||
      (SELECT wal_status FROM pg_replication_slots
      WHERE slot_name='funnelmetry_cdc10_epoch2');""")
    if slots not in ("lost|reserved", "lost|extended"):
        raise RuntimeError("old gap/new slot lineage is not safe")
    current = state()
    epoch = current["epoch"]
    if not epoch or epoch["previous_epoch_gap"] != "INCOMPLETE" or \
            epoch["source_prefix"] != PREFIX or not epoch["snapshot_last_seen"]:
        raise RuntimeError("durable snapshot metadata is incomplete")
    pairs, digest = pairs_from(current)
    if digest != saved["baseline_digest"] or len(pairs) != saved["baseline_active_orders"]:
        raise RuntimeError("durable snapshot differs from independently verified source baseline")
    if any(int(current["snapshot_counts"].get(table, -1)) != saved["snapshot_rows"][table]
           for table in TABLES):
        raise RuntimeError("snapshot table coverage differs from verified checkpoint")
    for table in TABLES:
        topic = f"{PREFIX}.public.{table}"
        if int(current["offsets"].get(topic, -1)) != topic_end(topic):
            raise RuntimeError("mapper has not ingested the full recovery topic prefix")
    if int(current["offsets"].get(f"{PREFIX}.transaction", -1)) != topic_end(f"{PREFIX}.transaction"):
        raise RuntimeError("mapper has not ingested transaction END records")
    if epoch["status"] == "BASELINE_VERIFIED":
        if epoch["baseline_digest"] != digest or epoch["baseline_active_count"] != len(pairs):
            raise RuntimeError("durable baseline changed after verification")
        print(json.dumps({"status": "BASELINE_VERIFIED", "idempotent": True,
                          "coverage_epoch_id": EPOCH, "historical_gap": "INCOMPLETE"}))
        return
    if epoch["status"] != "BASELINING" or current["state_count"] or current["outbox_count"]:
        raise RuntimeError("baseline gate would overwrite existing state or outbox")
    values = []
    outbox = []
    for order in current["orders"]:
        order_id = order["id"]
        if not re.fullmatch(r"order_[A-Za-z0-9]+", order_id):
            raise RuntimeError("invalid source order ID in baseline")
        cart_id = pairs.get(order_id)
        active = cart_id is not None
        record_id = hashlib.sha256(f"{EPOCH}|medusa-reference-shadow|{order_id}|BASELINE".encode()).hexdigest()
        payload = {"contract_id": "reference.medusa.order_recorded_state.v2",
                   "coverage_epoch_id": EPOCH, "historical_gap_status": "INCOMPLETE",
                   "coverage": "CURRENT_STATE_FROM_REBASELINE", "quality": "REFERENCE_APPROXIMATE",
                   "source_instance_id": "medusa-reference-shadow", "record_id": record_id,
                   "record_type": "BASELINE", "order_id": order_id, "cart_id": cart_id,
                   "active": active, "revision_end_id": None, "observed_state_at": None}
        values.append(f"({quote(order_id)},{'true' if active else 'false'},"
                      f"{quote(cart_id) if cart_id else 'NULL'},'SNAPSHOT:cdc10-epoch2')")
        outbox.append(f"({quote(record_id)},{quote(order_id)},'BASELINE',"
                      f"{quote(json.dumps(payload, separators=(',', ':')))}::jsonb)")
    if not values or not outbox:
        raise RuntimeError("empty recovery baseline is not accepted in this rehearsal")
    marker_id = hashlib.sha256(f"{EPOCH}|BASELINE_COMPLETE|{digest}".encode()).hexdigest()
    marker = {"contract_id": "reference.medusa.order_recorded_state.v2",
              "coverage_epoch_id": EPOCH, "historical_gap_status": "INCOMPLETE",
              "coverage": "CURRENT_STATE_FROM_REBASELINE", "quality": "REFERENCE_APPROXIMATE",
              "source_instance_id": "medusa-reference-shadow", "record_id": marker_id,
              "record_type": "BASELINE_COMPLETE", "order_id": "__baseline__",
              "baseline_orders": len(values), "baseline_active_orders": len(pairs),
              "baseline_digest": digest}
    outbox.append(f"({quote(marker_id)},'__baseline__','BASELINE_COMPLETE',"
                  f"{quote(json.dumps(marker, separators=(',', ':')))}::jsonb)")
    statement = f"""BEGIN;
      SELECT coverage_epoch_id FROM recovery_epochs WHERE coverage_epoch_id='{EPOCH}'
        AND status='BASELINING' AND snapshot_last_seen FOR UPDATE;
      INSERT INTO recovery_state(order_id,active,cart_id,last_revision)
        VALUES {','.join(values)};
      INSERT INTO recovery_outbox(record_id,order_id,record_type,payload)
        VALUES {','.join(outbox)};
      UPDATE recovery_epochs SET status='BASELINE_VERIFIED',
        baseline_digest={quote(digest)},baseline_active_count={len(pairs)},
        baseline_verified_at=now(),updated_at=now() WHERE coverage_epoch_id='{EPOCH}'
        AND status='BASELINING' AND snapshot_last_seen;
      COMMIT;"""
    mapper(statement)
    print(json.dumps({"status": "BASELINE_VERIFIED", "coverage_epoch_id": EPOCH,
                      "historical_gap": "INCOMPLETE", "snapshot_on_facts": 0,
                      "baseline_orders": len(values), "baseline_active_orders": len(pairs),
                      "baseline_digest": digest}, sort_keys=True))


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, ValueError, OSError, subprocess.TimeoutExpired) as error:
        raise SystemExit(f"recovery-baseline: {error}") from None
