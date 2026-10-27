#!/usr/bin/env python3
"""Compare a retractable CDC order-state gate with native shadow events.

Only synthetic IDs and transition metadata are printed. Raw CDC payloads and
Source Event Feed records stay in process memory and are never persisted.
"""

import json
import re
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parent
COMPOSE = ["docker", "compose", "-f", str(ROOT / "compose.yml")]
TABLES = ("order", "order_cart", "cart")

if len(sys.argv) < 2:
    raise SystemExit("usage: evaluate-order-state-gate.py order_ID:cart_ID [order_ID:cart_ID ...]")

pairs = []
for value in sys.argv[1:]:
    if not re.fullmatch(r"order_[A-Za-z0-9]+:cart_[A-Za-z0-9]+", value):
        raise SystemExit("all arguments must be synthetic order_ID:cart_ID pairs")
    pairs.append(tuple(value.split(":", 1)))


def read_topic(table):
    result = subprocess.run(
        COMPOSE + [
            "exec", "-T", "kafka", "/opt/kafka/bin/kafka-console-consumer.sh",
            "--bootstrap-server", "kafka:9092", "--topic", f"cdc_shadow_medusa.public.{table}",
            "--from-beginning", "--timeout-ms", "10000",
            "--consumer-property", "isolation.level=read_committed",
        ],
        capture_output=True, text=True, check=False,
    )
    # ConsoleConsumer writes an ERROR/TimeoutException line when its normal
    # end-of-stream timeout fires, even after successfully reading messages.
    if result.returncode not in (0, 1):
        raise RuntimeError(f"shadow Kafka read failed for {table} (exit {result.returncode})")
    records = []
    for line in result.stdout.splitlines():
        if line.startswith("{"):
            record = json.loads(line)
            if record.get("op") in ("c", "u", "d"):
                source = record.get("source") or {}
                if source.get("snapshot") not in (False, "false", None):
                    raise RuntimeError("snapshot row cannot be treated as a new conversion")
                records.append((table, record))
    return records


with ThreadPoolExecutor(max_workers=len(TABLES)) as pool:
    rows = [record for topic in pool.map(read_topic, TABLES) for record in topic]

feed_js = r"""
const token = Object.values(JSON.parse(process.env.SOURCE_INGRESS_EVENT_FEED_TOKENS_JSON))[0];
let after = 0;
const counts = {};
for (let page = 0; page < 1000; page++) {
  const response = await fetch(`http://127.0.0.1:32000/v1/events?after_seq=${after}&limit=100`,
    {headers: {authorization: 'Bearer ' + token}});
  if (!response.ok) throw new Error('shadow feed request failed');
  const data = await response.json();
  if (!data.events?.length) break;
  for (const event of data.events) {
    if (event.source_event_type === 'medusa.order_placed') {
      const id = event.event_id;
      counts[id] = (counts[id] ?? 0) + 1;
    }
  }
  const last = Number(data.events.at(-1).ingress_seq);
  if (!Number.isSafeInteger(last) || last <= after) throw new Error('shadow feed cursor stalled');
  after = last;
  if (data.events.length < 100) break;
}
console.log(JSON.stringify(counts));
"""
feed = subprocess.run(
    COMPOSE + ["exec", "-T", "source-ingress", "node", "-"],
    input=feed_js, capture_output=True, text=True, check=True,
)
native_counts = json.loads(feed.stdout)

values = ",".join(f"('{order_id}','{cart_id}')" for order_id, cart_id in pairs)
final_sql = f"""
WITH probes(order_id, cart_id) AS (VALUES {values})
SELECT p.order_id,
       (o.id IS NOT NULL AND o.deleted_at IS NULL
        AND EXISTS (SELECT 1 FROM order_cart oc
                    WHERE oc.order_id=p.order_id AND oc.cart_id=p.cart_id)
        AND c.completed_at IS NOT NULL)::text
FROM probes p
LEFT JOIN public."order" o ON o.id=p.order_id
LEFT JOIN public.cart c ON c.id=p.cart_id
ORDER BY p.order_id;
SELECT '__publication__', array_to_string(attnames, ',')
FROM pg_publication_tables
WHERE pubname='funnelmetry_cdc_shadow' AND tablename='order';
"""
db = subprocess.run(
    COMPOSE + ["exec", "-T", "postgres", "psql", "-X", "-U", "medusa", "-d", "medusa",
               "-At", "-v", "ON_ERROR_STOP=1"],
    input=final_sql, capture_output=True, text=True, check=True,
)
db_final = dict(line.split("|", 1) for line in db.stdout.splitlines() if "|" in line)
if "deleted_at" not in db_final.get("__publication__", "").split(","):
    raise RuntimeError("order.deleted_at is not published; run configure-order-state-gate-publication.py")


def transition_events(order_id, cart_id):
    matched = []
    for table, record in rows:
        row = record.get("after") or record.get("before") or {}
        if table == "order" and row.get("id") != order_id:
            continue
        if table == "order_cart" and (row.get("order_id"), row.get("cart_id")) != (order_id, cart_id):
            continue
        if table == "cart" and row.get("id") != cart_id:
            continue
        source = record.get("source") or {}
        lsn = source.get("lsn")
        if not isinstance(lsn, int):
            raise RuntimeError(f"missing numeric source LSN for {table}")
        total_order = (record.get("transaction") or {}).get("total_order") or 0
        matched.append((lsn, total_order, table, record))
    return sorted(matched, key=lambda item: (item[0], item[1], item[2]))


for order_id, cart_id in pairs:
    order_exists = False
    link_exists = False
    cart_completed = False
    active = False
    transitions = []
    for lsn, _, table, record in transition_events(order_id, cart_id):
        op = record["op"]
        row = record.get("after") or {}
        if table == "order":
            order_exists = op != "d" and row.get("deleted_at") is None
        elif table == "order_cart":
            link_exists = op != "d"
        elif table == "cart":
            cart_completed = op != "d" and row.get("completed_at") is not None
        next_active = order_exists and link_exists and cart_completed
        if next_active != active:
            transitions.append({
                "lsn": lsn,
                "gate": "ON" if next_active else "OFF",
                "trigger": f"{table}:{op}",
                "source_ts_ms": (record.get("source") or {}).get("ts_ms"),
            })
            active = next_active
    if not transition_events(order_id, cart_id):
        raise RuntimeError(f"no CDC rows for {order_id}; check IDs and connector coverage")
    observed_db = db_final.get(order_id)
    if observed_db not in ("true", "false"):
        raise RuntimeError(f"missing final DB state for {order_id}")
    print(json.dumps({
        "order_id": order_id,
        "cart_id": cart_id,
        "transitions": transitions,
        "final_gate": active,
        "db_final_gate": observed_db == "true",
        "cdc_db_match": active == (observed_db == "true"),
        "native_placed_count": native_counts.get(f"medusa:order.placed:{order_id}", 0),
        "source_rows_seen": len(transition_events(order_id, cart_id)),
    }, separators=(",", ":")))

print("LIMIT: offline LSN sorting is not a proof of a live cross-topic ordering/watermark policy")
