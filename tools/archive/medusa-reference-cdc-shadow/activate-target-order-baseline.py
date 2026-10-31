#!/usr/bin/env python3
"""Verify target CDC-11 order snapshot and activate a BASELINE-only shadow epoch.

The mapper must be stopped. A source/mapper row comparison and exact raw Kafka
topic-end checkpoint precede the single transaction that seeds BASELINE rows.
No snapshot row is emitted as an order placement ON or historical conversion.
"""

import argparse
import hashlib
import importlib.util
import json
import re
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("target_source_installer", ROOT / "install-target-source.py")
source_installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(source_installer)


def run(command, stdin=None):
    result = subprocess.run(command, input=stdin, text=True, capture_output=True, check=False)
    if result.returncode:
        raise RuntimeError(f"CDC baseline command failed (exit {result.returncode}); inspect protected logs")
    return result.stdout.strip()


def mapper(container, sql):
    return run(["docker", "exec", "-i", container, "psql", "-X", "-U",
                "reference_cdc_mapper", "-d", "reference_cdc_mapper", "-At",
                "-v", "ON_ERROR_STOP=1"], sql)


def kafka_end(container, topic):
    output = run(["docker", "exec", container, "/opt/kafka/bin/kafka-get-offsets.sh",
                  "--bootstrap-server", "kafka:9092", "--topic", topic])
    rows = [line for line in output.splitlines() if line.startswith(topic + ":0:")]
    if len(rows) != 1:
        raise ValueError("order Kafka topic has no exact partition-0 end")
    return int(rows[0].rsplit(":", 1)[1])


def read_state(source_container, mapper_container, epoch):
    source = json.loads(source_installer.run_psql(source_container, """SELECT json_build_object(
      'orders',(SELECT COALESCE(json_agg(json_build_object('id',id,'present',deleted_at IS NULL)
        ORDER BY id),'[]'::json) FROM public."order"),
      'links',(SELECT COALESCE(json_agg(json_build_object('id',id,'order_id',order_id,'cart_id',cart_id)
        ORDER BY id),'[]'::json) FROM public.order_cart),
      'carts',(SELECT COALESCE(json_agg(json_build_object('id',id,'completed',completed_at IS NOT NULL)
        ORDER BY id),'[]'::json) FROM public.cart))::text;"""))
    durable = json.loads(mapper(mapper_container, f"""SELECT json_build_object(
      'epoch',(SELECT row_to_json(e) FROM reference_cdc_v2_epochs e
        WHERE coverage_epoch_id='{epoch}'),
      'orders',(SELECT COALESCE(json_agg(json_build_object('id',id,'present',present)
        ORDER BY id),'[]'::json) FROM reference_cdc_v2_source_orders),
      'links',(SELECT COALESCE(json_agg(json_build_object('id',id,'order_id',order_id,
        'cart_id',cart_id) ORDER BY id),'[]'::json) FROM reference_cdc_v2_source_links),
      'carts',(SELECT COALESCE(json_agg(json_build_object('id',id,'completed',completed)
        ORDER BY id),'[]'::json) FROM reference_cdc_v2_source_carts),
      'snapshot_counts',(SELECT COALESCE(json_object_agg(table_name,n),'{{}}'::json)
        FROM (SELECT table_name,count(*) AS n FROM reference_cdc_v2_snapshot_rows
          GROUP BY table_name) s),
      'offsets',(SELECT COALESCE(json_object_agg(topic,next_offset),'{{}}'::json)
        FROM reference_cdc_v2_input_offsets WHERE partition=0),
      'state_count',(SELECT count(*) FROM reference_cdc_v2_state),
      'outbox_count',(SELECT count(*) FROM reference_cdc_v2_outbox))::text;"""))
    return source, durable


def baseline_pairs(rows):
    orders = {row["id"]: row["present"] for row in rows["orders"]}
    carts = {row["id"]: row["completed"] for row in rows["carts"]}
    pairs = {}
    for link in rows["links"]:
        if orders.get(link["order_id"]) and carts.get(link["cart_id"]):
            prior = pairs.get(link["order_id"])
            if prior and prior != link["cart_id"]:
                raise ValueError("multiple eligible baseline carts for one order")
            pairs[link["order_id"]] = link["cart_id"]
    digest = hashlib.sha256(json.dumps(pairs, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    return pairs, digest


def quote(value):
    return "'" + str(value).replace("'", "''") + "'"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("plan", "apply"))
    parser.add_argument("--profile-dir", type=Path, required=True)
    parser.add_argument("--source-container", required=True)
    parser.add_argument("--mapper-container", required=True)
    parser.add_argument("--kafka-container", required=True)
    args = parser.parse_args()
    if args.source_container != "medusa_reference-postgres-1" or any(
            not re.fullmatch(r"[a-f0-9]{12,64}", value) for value in
            (args.mapper_container, args.kafka_container)):
        raise ValueError("explicit CDC-11 source, mapper and Kafka containers required")
    document = source_installer.load_profiles(args.profile_dir)["order"]
    epoch = document["coverage_epoch_id"]
    replicas = run(["docker", "service", "inspect", "--format",
                    "{{.Spec.Mode.Replicated.Replicas}}",
                    "funnelmetry_cdc_target_shadow_order-mapper"])
    if replicas != "0":
        raise ValueError("stop target order mapper before baseline verification")
    source, durable = read_state(args.source_container, args.mapper_container, epoch)
    epoch_row = durable["epoch"]
    if not epoch_row or epoch_row["status"] != "BASELINING" or \
            not epoch_row["snapshot_last_seen"] or \
            epoch_row["source_prefix"] != document["topic_prefix"] or \
            epoch_row["fact_topic"] != document["fact_topic"] or \
            epoch_row["previous_epoch_gap"] != "INCOMPLETE" or \
            durable["state_count"] != 0 or durable["outbox_count"] != 0:
        raise ValueError("target mapper is not an untouched completed baseline")
    for key, table in (("orders", "order"), ("links", "order_cart"), ("carts", "cart")):
        if source[key] != durable[key] or len(source[key]) != int(durable["snapshot_counts"].get(table, -1)):
            raise ValueError(f"independent {table} source/snapshot comparison failed")
    for table in ("order", "order_cart", "cart", "transaction"):
        topic = f"{document['topic_prefix']}.transaction" if table == "transaction" else \
            f"{document['topic_prefix']}.public.{table}"
        if int(durable["offsets"].get(topic, 0)) != kafka_end(args.kafka_container, topic):
            raise ValueError(f"mapper has not consumed complete {table} topic prefix")
    pairs, digest = baseline_pairs(source)
    summary = {"coverage_epoch_id": epoch, "historical_gap": "INCOMPLETE",
               "baseline_orders": len(source["orders"]), "baseline_active_orders": len(pairs),
               "baseline_digest": digest, "snapshot_on_facts": 0}
    if args.command == "plan":
        print(json.dumps({"status": "BASELINE_PLAN_VERIFIED", **summary}, sort_keys=True))
        return
    values, outbox = [], []
    for order in source["orders"]:
        order_id = order["id"]
        if not re.fullmatch(r"order_[A-Za-z0-9]+", order_id):
            raise ValueError("invalid reference order ID in baseline")
        cart_id = pairs.get(order_id)
        active = cart_id is not None
        record_id = hashlib.sha256(f"{epoch}|medusa-reference|{order_id}|BASELINE".encode()).hexdigest()
        payload = {"contract_id": "reference.medusa.order_recorded_state.v2",
                   "coverage_epoch_id": epoch, "historical_gap_status": "INCOMPLETE",
                   "coverage": "CURRENT_STATE_FROM_REBASELINE", "quality": "REFERENCE_APPROXIMATE",
                   "source_instance_id": "medusa-reference", "record_id": record_id,
                   "record_type": "BASELINE", "order_id": order_id,
                   "cart_id": cart_id, "active": active, "revision_end_id": None,
                   "observed_state_at": None}
        values.append(f"({quote(order_id)},{'true' if active else 'false'},"
                      f"{quote(cart_id) if cart_id else 'NULL'},{quote('SNAPSHOT:' + epoch)})")
        outbox.append(f"({quote(record_id)},{quote(order_id)},'BASELINE',"
                      f"{quote(json.dumps(payload, separators=(',', ':')))}::jsonb)")
    marker_id = hashlib.sha256(f"{epoch}|BASELINE_COMPLETE|{digest}".encode()).hexdigest()
    marker = {"contract_id": "reference.medusa.order_recorded_state.v2",
              "coverage_epoch_id": epoch, "historical_gap_status": "INCOMPLETE",
              "coverage": "CURRENT_STATE_FROM_REBASELINE", "quality": "REFERENCE_APPROXIMATE",
              "source_instance_id": "medusa-reference", "record_id": marker_id,
              "record_type": "BASELINE_COMPLETE", "order_id": "__baseline__",
              "baseline_orders": len(values), "baseline_active_orders": len(pairs),
              "baseline_digest": digest}
    outbox.append(f"({quote(marker_id)},'__baseline__','BASELINE_COMPLETE',"
                  f"{quote(json.dumps(marker, separators=(',', ':')))}::jsonb)")
    statement = f"""BEGIN;
      DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM reference_cdc_v2_epochs
        WHERE coverage_epoch_id={quote(epoch)} AND status='BASELINING'
        AND snapshot_last_seen AND baseline_digest IS NULL) THEN
        RAISE EXCEPTION 'baseline gate changed'; END IF; END $$;
      {('INSERT INTO reference_cdc_v2_state(order_id,active,cart_id,last_revision) VALUES ' + ','.join(values) + ';') if values else ''}
      INSERT INTO reference_cdc_v2_outbox(record_id,order_id,record_type,payload)
        VALUES {','.join(outbox)};
      UPDATE reference_cdc_v2_epochs SET status='BASELINE_VERIFIED',
        baseline_digest={quote(digest)},baseline_active_count={len(pairs)},
        baseline_verified_at=now(),updated_at=now()
        WHERE coverage_epoch_id={quote(epoch)} AND status='BASELINING';
      COMMIT;"""
    mapper(args.mapper_container, statement)
    print(json.dumps({"status": "BASELINE_VERIFIED", **summary}, sort_keys=True))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, RuntimeError, OSError, json.JSONDecodeError) as error:
        raise SystemExit(f"cdc-target-order-baseline: {error}") from None
