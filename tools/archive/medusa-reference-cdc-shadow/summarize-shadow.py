#!/usr/bin/env python3
"""Print a redacted CDC/native/DB comparison for one synthetic order."""

import json
import re
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parent
COMPOSE = ["docker", "compose", "-f", str(ROOT / "compose.yml")]
TABLES = ("order", "cart", "order_cart", "order_item", "order_line_item", "order_summary")

if len(sys.argv) != 3 or not re.fullmatch(r"order_[A-Za-z0-9]+", sys.argv[1]) or not re.fullmatch(r"cart_[A-Za-z0-9]+", sys.argv[2]):
    raise SystemExit("usage: summarize-shadow.py <order_id> <cart_id>")
order_id, cart_id = sys.argv[1:]

feed_js = """
const token = Object.values(JSON.parse(process.env.SOURCE_INGRESS_EVENT_FEED_TOKENS_JSON))[0];
const r = await fetch('http://127.0.0.1:32000/v1/events?after_seq=0&limit=100', {headers:{authorization:'Bearer '+token}});
if (!r.ok) throw new Error('shadow feed HTTP '+r.status);
const f = await r.json();
console.log(JSON.stringify({feed_id:f.event_feed_id,records:f.events.map(e=>({seq:e.ingress_seq,event_id:e.event_id,type:e.source_event_type,aggregate:e.aggregate,correlation_id:e.correlation_id,occurred_at:e.occurred_at,amount:e.source_payload?.total_amount,currency:e.source_payload?.currency_code}))}));
"""
feed = subprocess.run(COMPOSE + ["exec", "-T", "source-ingress", "node", "-"], input=feed_js, text=True, capture_output=True, check=True)
native = json.loads(feed.stdout)
matching_native = [e for e in native["records"] if e["event_id"] == f"medusa:order.placed:{order_id}"]
print("shadow_feed_id=", native["feed_id"], "native_order_events=", len(matching_native))
for event in matching_native:
    print("native=", json.dumps(event, separators=(",", ":")))

def read_table(table: str) -> tuple[str, list[dict]]:
    result = subprocess.run(
        COMPOSE + ["exec", "-T", "kafka", "/opt/kafka/bin/kafka-console-consumer.sh", "--bootstrap-server", "kafka:9092", "--topic", f"cdc_shadow_medusa.public.{table}", "--from-beginning", "--timeout-ms", "10000", "--consumer-property", "isolation.level=read_committed"],
        text=True,
        capture_output=True,
        check=False,
    )
    return table, [json.loads(line) for line in result.stdout.splitlines() if line.startswith("{")]


with ThreadPoolExecutor(max_workers=len(TABLES)) as pool:
    records = dict(pool.map(read_table, TABLES))

item_ids = {r.get("after", {}).get("item_id") for r in records["order_item"] if r.get("after") and r["after"].get("order_id") == order_id}
for table in TABLES:
    relevant = []
    for record in records[table]:
        row = record.get("after") or record.get("before") or {}
        linked = (
            (table == "order" and row.get("id") == order_id)
            or (table == "cart" and row.get("id") == cart_id)
            or (table in ("order_cart", "order_item", "order_summary") and row.get("order_id") == order_id)
            or (table == "order_line_item" and row.get("id") in item_ids)
        )
        if not linked:
            continue
        source = record.get("source") or {}
        relevant.append({
            "op": record.get("op"),
            "lsn": source.get("lsn"),
            "txId": source.get("txId"),
            "snapshot": source.get("snapshot"),
            "order_id": row.get("order_id", row.get("id") if table == "order" else None),
            "cart_id": row.get("cart_id", row.get("id") if table == "cart" else None),
            "status": row.get("status"),
            "completed_at": row.get("completed_at"),
        })
    print("cdc_" + table + "=", json.dumps(relevant, separators=(",", ":")))

sql = f"""
SELECT 'order_status=' || o.status || ',currency=' || o.currency_code || ',cart=' || oc.cart_id || ',total=' || coalesce(s.totals->>'current_order_total','null')
FROM public."order" o JOIN public.order_cart oc ON oc.order_id=o.id
JOIN public.order_summary s ON s.order_id=o.id WHERE o.id='{order_id}';
SELECT 'workflow=' || id || ',state=' || state FROM public.workflow_execution
WHERE workflow_id='complete-cart' AND context #>> '{{data,payload,id}}' = '{cart_id}'
  AND context::text LIKE '%{order_id}%'
ORDER BY created_at, id;
SELECT 'slot=' || slot_name || ',active=' || active || ',retained_bytes=' || coalesce(pg_wal_lsn_diff(pg_current_wal_lsn(),restart_lsn)::text,'null')
FROM pg_replication_slots WHERE slot_name='funnelmetry_cdc_shadow';
"""
db = subprocess.run(COMPOSE + ["exec", "-T", "postgres", "psql", "-X", "-U", "medusa", "-d", "medusa", "-At", "-v", "ON_ERROR_STOP=1"], input=sql, text=True, capture_output=True, check=True)
for line in db.stdout.splitlines():
    print("db_" + line)
