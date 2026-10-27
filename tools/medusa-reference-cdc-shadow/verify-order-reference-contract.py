#!/usr/bin/env python3
"""Shadow-only CDC contract conformance for a retractable order-state fact.

Reads three allowlisted CDC topics plus Debezium transaction metadata. Raw
records remain in memory; only synthetic IDs, counts, and hashes are printed.
"""

import copy
import hashlib
import json
import re
import subprocess
import sys
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parent
COMPOSE = ["docker", "compose", "-f", str(ROOT / "compose.yml")]
TABLES = ("order", "order_cart", "cart")

if len(sys.argv) < 2:
    raise SystemExit("usage: verify-order-reference-contract.py order_ID:cart_ID [...]")
pairs = []
for value in sys.argv[1:]:
    if not re.fullmatch(r"order_[A-Za-z0-9]+:cart_[A-Za-z0-9]+", value):
        raise SystemExit("all arguments must be synthetic order_ID:cart_ID pairs")
    pairs.append(tuple(value.split(":", 1)))
if len(set(pairs)) != len(pairs):
    raise SystemExit("duplicate order/cart input pair")


def read_topic(topic):
    result = subprocess.run(
        COMPOSE + [
            "exec", "-T", "kafka", "/opt/kafka/bin/kafka-console-consumer.sh",
            "--bootstrap-server", "kafka:9092", "--topic", topic,
            "--from-beginning", "--timeout-ms", "10000",
            "--consumer-property", "isolation.level=read_committed",
        ],
        capture_output=True, text=True, check=False,
    )
    # ConsoleConsumer reports its ordinary end-of-stream timeout on stderr.
    if result.returncode not in (0, 1):
        raise RuntimeError(f"shadow Kafka read failed for {topic} (exit {result.returncode})")
    return [json.loads(line) for line in result.stdout.splitlines() if line.startswith("{")]


topics = [f"cdc_shadow_medusa.public.{table}" for table in TABLES] + ["cdc_shadow_medusa.transaction"]
with ThreadPoolExecutor(max_workers=len(topics)) as pool:
    data = dict(zip(topics, pool.map(read_topic, topics)))


def event_key(table, event):
    source = event.get("source") or {}
    tx = event.get("transaction") or {}
    if source.get("snapshot") not in (False, "false", None):
        raise RuntimeError("snapshot records require a separate bootstrap contract")
    if not isinstance(source.get("txId"), int) or not isinstance(source.get("lsn"), int):
        raise RuntimeError(f"missing source txId/LSN in {table}")
    if not isinstance(tx.get("total_order"), int):
        raise RuntimeError(f"missing within-transaction order in {table}")
    return (source["name"], source["db"], source["schema"], table,
            source["txId"], source["lsn"], tx["total_order"])


by_tx = defaultdict(list)
keys = {}
for table in TABLES:
    for event in data[f"cdc_shadow_medusa.public.{table}"]:
        if event.get("op") not in ("c", "u", "d"):
            continue
        key = event_key(table, event)
        content = json.dumps((event.get("op"), event.get("before"), event.get("after")), sort_keys=True)
        if key in keys:
            if keys[key] != content:
                raise RuntimeError("same CDC identity has conflicting row content")
            continue
        keys[key] = content
        by_tx[key[4]].append((table, event))

ends = []
for event in data["cdc_shadow_medusa.transaction"]:
    if event.get("status") != "END":
        continue
    txid = int(str(event["id"]).split(":", 1)[0])
    expected = {
        table: sum(item.get("event_count", 0)
                   for item in (event.get("data_collections") or [])
                   if item.get("data_collection") == f"public.{table}")
        for table in TABLES
    }
    ends.append((txid, expected, event["id"]))
if not ends:
    raise RuntimeError("no Debezium transaction END records found")
if len({txid for txid, _, _ in ends}) != len(ends):
    raise RuntimeError("transaction ID reused in shadow history; this finite-run verifier cannot disambiguate it")

for txid, expected, _ in ends:
    actual = Counter(table for table, _ in by_tx.get(txid, []))
    if any(actual[table] != count for table, count in expected.items()):
        raise RuntimeError(f"CDC transaction {txid} is incomplete or has an unexpected table count")
if set(by_tx) - {txid for txid, _, _ in ends}:
    raise RuntimeError("CDC row without a matching Debezium transaction END")


class Projection:
    def __init__(self, serialized=None):
        if serialized is None:
            self.orders = {}
            self.carts = {}
            self.links = {}
            self.gates = {order_id: False for order_id, _ in pairs}
            self.seen = set()
            self.transitions = []
            self.duplicates = 0
        else:
            state = json.loads(serialized)
            self.orders = state["orders"]
            self.carts = state["carts"]
            self.links = state["links"]
            self.gates = state["gates"]
            self.seen = {tuple(item) for item in state["seen"]}
            self.transitions = state["transitions"]
            self.duplicates = state["duplicates"]

    def checkpoint(self):
        return json.dumps({
            "orders": self.orders, "carts": self.carts, "links": self.links,
            "gates": self.gates, "seen": sorted(self.seen),
            "transitions": self.transitions, "duplicates": self.duplicates,
        }, sort_keys=True)

    def apply_transaction(self, txid, records):
        records = sorted(records, key=lambda item: (item[1]["transaction"]["total_order"],
                                                        item[1]["source"]["lsn"]))
        changed = False
        for table, event in records:
            key = event_key(table, event)
            if key in self.seen:
                self.duplicates += 1
                continue
            self.seen.add(key)
            changed = True
            op = event["op"]
            row = event.get("after") if op != "d" else event.get("before")
            row = row or {}
            if table == "order":
                if not row.get("id"):
                    raise RuntimeError("order CDC row lacks ID")
                if op == "d":
                    self.orders.pop(row["id"], None)
                else:
                    self.orders[row["id"]] = row.get("deleted_at") is None
            elif table == "cart":
                if not row.get("id"):
                    raise RuntimeError("cart CDC row lacks ID")
                if op == "d":
                    self.carts.pop(row["id"], None)
                else:
                    self.carts[row["id"]] = row.get("completed_at") is not None
            else:
                if not row.get("id"):
                    raise RuntimeError("order_cart CDC row lacks link ID")
                if op == "d":
                    self.links.pop(row["id"], None)
                else:
                    if not row.get("order_id") or not row.get("cart_id"):
                        raise RuntimeError("order_cart CDC row lacks order/cart binding")
                    self.links[row["id"]] = [row["order_id"], row["cart_id"]]
        if not changed:
            return
        for order_id, cart_id in pairs:
            active = bool(self.orders.get(order_id) and self.carts.get(cart_id)
                          and [order_id, cart_id] in self.links.values())
            if active != self.gates[order_id]:
                self.gates[order_id] = active
                self.transitions.append([order_id, "ON" if active else "OFF", txid])

    def result(self):
        return {"gates": self.gates, "transitions": self.transitions}


# Baseline: transaction-topic END order; within each transaction use total_order.
baseline = Projection()
for txid, _, _ in ends:
    baseline.apply_transaction(txid, by_tx.get(txid, []))
expected_result = baseline.result()

# Replay the same Kafka data into a fresh projection process/state.
fresh = Projection()
for txid, _, _ in ends:
    fresh.apply_transaction(txid, by_tx.get(txid, []))
if fresh.result() != expected_result:
    raise RuntimeError("fresh full replay diverged")

# Duplicate every data record; use source identity to keep one effect.
duplicated = Projection()
for txid, _, _ in ends:
    records = by_tx.get(txid, [])
    duplicated.apply_transaction(txid, records + records)
if duplicated.result() != expected_result or duplicated.duplicates != sum(len(v) for v in by_tx.values()):
    raise RuntimeError("duplicate delivery changed projection or was not detected")

# Serialize a mid-stream checkpoint, restore it, then continue; also replay the
# complete stream onto the completed state to prove an idempotent restart.
midpoint = len(ends) // 2
partial = Projection()
for txid, _, _ in ends[:midpoint]:
    partial.apply_transaction(txid, by_tx.get(txid, []))
resumed = Projection(partial.checkpoint())
for txid, _, _ in ends[midpoint:]:
    resumed.apply_transaction(txid, by_tx.get(txid, []))
if resumed.result() != expected_result:
    raise RuntimeError("serialized checkpoint resume diverged")
before_repeat = copy.deepcopy(resumed.result())
for txid, _, _ in ends:
    resumed.apply_transaction(txid, by_tx.get(txid, []))
if resumed.result() != before_repeat:
    raise RuntimeError("full CDC replay after checkpoint emitted another transition")

# END topic order is the global ordering anchor. Never apply a transaction
# until its expected data-collection counts have arrived across the three
# subscribed row topics, even if END arrives before all of those rows.
def flush_complete(pending, next_end, projection):
    while next_end < len(ends):
        txid, expected, _ = ends[next_end]
        actual = Counter(row_table for row_table, _ in pending.get(txid, {}).values())
        if any(actual[table_name] != count for table_name, count in expected.items()):
            break
        projection.apply_transaction(txid, list(pending.pop(txid, {}).values()))
        next_end += 1
    return next_end


# Worst-case cross-topic arrival: all END markers arrive before data, then all
# table records arrive in reverse order.
buffered = Projection()
pending = defaultdict(dict)
next_end = 0
all_records = [item for records in by_tx.values() for item in records]
for table, event in reversed(all_records):
    key = event_key(table, event)
    pending[key[4]][key] = (table, event)
    next_end = flush_complete(pending, next_end, buffered)
if next_end != len(ends) or buffered.result() != expected_result:
    raise RuntimeError("out-of-order cross-topic delivery did not converge")

# One missing row must block the ordered prefix; delivering it later repairs
# the prefix without changing the final projection or transition history.
held_txid = next(txid for txid, _, _ in ends if by_tx.get(txid))
held = by_tx[held_txid][0]
held_index = next(i for i, (txid, _, _) in enumerate(ends) if txid == held_txid)
withheld = Projection()
pending = defaultdict(dict)
next_end = 0
held_key = event_key(*held)
for table, event in reversed(all_records):
    key = event_key(table, event)
    if key == held_key:
        continue
    pending[key[4]][key] = (table, event)
    next_end = flush_complete(pending, next_end, withheld)
if next_end > held_index:
    raise RuntimeError("missing CDC row did not block the transaction prefix")
pending[held_txid][held_key] = held
next_end = flush_complete(pending, next_end, withheld)
if next_end != len(ends) or withheld.result() != expected_result:
    raise RuntimeError("late CDC row did not repair the transaction prefix")

values = ",".join(f"('{order_id}','{cart_id}')" for order_id, cart_id in pairs)
statement = f"""
WITH probes(order_id, cart_id) AS (VALUES {values})
SELECT p.order_id,
       (o.id IS NOT NULL AND o.deleted_at IS NULL
        AND EXISTS (SELECT 1 FROM order_cart oc
                    WHERE oc.order_id=p.order_id AND oc.cart_id=p.cart_id)
        AND c.completed_at IS NOT NULL)::text
FROM probes p LEFT JOIN public."order" o ON o.id=p.order_id
LEFT JOIN public.cart c ON c.id=p.cart_id ORDER BY p.order_id;
"""
db = subprocess.run(
    COMPOSE + ["exec", "-T", "postgres", "psql", "-X", "-U", "medusa", "-d", "medusa",
               "-At", "-v", "ON_ERROR_STOP=1"],
    input=statement, capture_output=True, text=True, check=True,
)
db_final = dict(line.split("|", 1) for line in db.stdout.splitlines() if "|" in line)
for order_id, _ in pairs:
    if db_final.get(order_id) not in ("true", "false"):
        raise RuntimeError(f"missing DB final state for {order_id}")
    if expected_result["gates"][order_id] != (db_final[order_id] == "true"):
        raise RuntimeError(f"replayed CDC state differs from shadow DB for {order_id}")

digest = hashlib.sha256(json.dumps(expected_result, sort_keys=True).encode()).hexdigest()[:16]
print(json.dumps({
    "status": "PASS", "tested_orders": len(pairs), "transactions": len(ends),
    "unique_row_events": len(keys), "transitions": len(expected_result["transitions"]),
    "duplicate_events_ignored": duplicated.duplicates,
    "fresh_replay": "same", "checkpoint_resume": "same",
    "repeat_replay": "no_new_transitions", "reversed_cross_topic_arrival": "same",
    "missing_record_stalls_then_recovers": "same",
    "db_final_match": len(pairs), "result_sha256_16": digest,
    "orders": expected_result["gates"],
}, sort_keys=True))
