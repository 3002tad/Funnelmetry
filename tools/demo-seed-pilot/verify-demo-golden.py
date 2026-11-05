#!/usr/bin/env python3
"""Compare SQL answers with computations on the two pinned JSON fixtures."""
from collections import Counter, defaultdict
import json
import sys

if len(sys.argv) != 4:
    raise SystemExit("usage: verify-demo-golden.py <full-fixture> <gap-fixture> <answers>")

datasets = []
for path in sys.argv[1:3]:
    with open(path, encoding="utf-8-sig") as stream:
        payload = json.load(stream)
    datasets.append((payload["config"]["dataset_id"], payload["rows"]))
with open(sys.argv[3], encoding="utf-8-sig") as stream:
    answers = {a["id"]: a for a in json.load(stream)["answers"]}
assert set(answers) == {f"Q{n:02}" for n in range(1, 16)}

sessions = [(d, row) for d, r in datasets for row in r["sessions"]]
events = [(d, row) for d, r in datasets for row in r["browser_events"]]
orders = [(d, row) for d, r in datasets for row in r["orders"]]
lines = [(d, row) for d, r in datasets for row in r["order_lines"]]
payments = [(d, row) for d, r in datasets for row in r["payments"]]
month = lambda ts: ts[:7]

sc = Counter(month(row["started_at"]) for _, row in sessions)
ec = Counter(month(row["occurred_at"]) for _, row in events)
assert answers["Q01"]["rows"] == [
    {"month": m, "sessions": sc[m], "events": ec[m]} for m in sorted(sc)
]
device = Counter(row["device"] for _, row in sessions)
assert answers["Q02"]["rows"] == [
    {"device": name, "sessions": count} for name, count in sorted(device.items(), key=lambda x: (-x[1], x[0]))
]

links = {(d, row["session_id"]) for d, r in datasets for row in r["cart_links"]}
utm = defaultdict(lambda: [0, 0])
for d, row in sessions:
    group = utm[row["utm_source"] if row["utm_source"] is not None else "[absent]"]
    group[0] += 1
    group[1] += (d, row["session_id"]) in links
assert answers["Q03"]["rows"] == [
    {"raw_utm_source": name, "sessions": n[0], "sessions_with_cart_link": n[1]}
    for name, n in sorted(utm.items(), key=lambda x: (-x[1][0], x[0]))
]

products = {(d, row["product_id"]): row["title"] for d, r in datasets for row in r["catalog_products"]}
product_views = Counter((d, row["data"]["product_id"]) for d, row in events if row["event_type"] == "behavior.product_viewed")
view_by_product = Counter()
for (d, p), count in product_views.items():
    assert (d, p) in products
    view_by_product[p] += count
assert answers["Q04"]["rows"] == [
    {"product_id": p, "title": products[next(d for d, _ in datasets if (d, p) in products), p], "views": n}
    for p, n in sorted(view_by_product.items(), key=lambda x: (-x[1], x[0]))[:10]
]

categories = {(d, row["category_id"]): row["name"] for d, r in datasets for row in r["catalog_categories"]}
history = defaultdict(list)
for d, r in datasets:
    for row in r["category_history"]:
        history[(d, row["product_id"])].append(row)
category_views = Counter()
for d, row in events:
    if row["event_type"] != "behavior.product_viewed":
        continue
    for h in history[(d, row["data"]["product_id"])]:
        if h["valid_from"] <= row["occurred_at"] < h["valid_to"]:
            category_views[categories[(d, h["category_id"])]] += 1
assert answers["Q05"]["rows"] == [
    {"category": name, "product_view_events": n}
    for name, n in sorted(category_views.items(), key=lambda x: (-x[1], x[0]))
]

terms = Counter(row["data"]["query_normalized"] for _, row in events if row["event_type"] == "behavior.search_query_submitted")
assert answers["Q06"]["rows"] == [
    {"query_normalized": name, "searches": n}
    for name, n in sorted(terms.items(), key=lambda x: (-x[1], x[0]))[:10]
]

mutations, carts = Counter(), defaultdict(set)
for d, r in datasets:
    for row in r["cart_changes"]:
        mutations[row["change_type"]] += 1
        carts[row["change_type"]].add((d, row["cart_id"]))
assert answers["Q07"]["rows"] == [
    {"change_type": kind, "mutations": mutations[kind], "carts": len(carts[kind])}
    for kind in sorted(mutations)
]
assert {k: answers["Q08"][k] for k in (
    "sessions", "sessions_with_product_view", "sessions_with_cart_link",
    "sessions_with_checkout_started", "orders_recorded", "active_order_rows"
)} == {
    "sessions": len(sessions),
    "sessions_with_product_view": len({(d, row["session_id"]) for d, row in events if row["event_type"] == "behavior.product_viewed"}),
    "sessions_with_cart_link": len(links),
    "sessions_with_checkout_started": len({(d, row["session_id"]) for d, row in events if row["event_type"] == "checkout.started"}),
    "orders_recorded": len(orders),
    "active_order_rows": sum(row["reference_state"] == "ON" for _, row in orders),
}

order_states = Counter((month(row["created_at"]), row["reference_state"]) for _, row in orders)
assert answers["Q09"]["rows"] == [
    {"month_label": m, "reference_state": state, "order_rows": n}
    for (m, state), n in sorted(order_states.items())
]
line_groups = defaultdict(lambda: [0, 0, 0])
for _, row in lines:
    value = line_groups[(row["currency"], row["price_rule"])]
    value[0] += 1
    value[1] += row["quantity"]
    value[2] += row["line_total_minor"]
assert answers["Q10"]["rows"] == [
    {"currency": currency, "price_rule": rule, "order_lines": value[0],
     "units": value[1], "ordered_line_value_minor": value[2]}
    for (currency, rule), value in sorted(line_groups.items())
]
payment_groups = defaultdict(lambda: [0, 0])
for _, row in payments:
    value = payment_groups[(row["currency"], row["action"])]
    value[0] += 1
    value[1] += row["amount_minor"]
assert answers["Q11"]["rows"] == [
    {"currency": currency, "action": action, "actions": value[0], "amount_minor": value[1]}
    for (currency, action), value in sorted(payment_groups.items())
]

fulfillments, fulfilled_orders = Counter(), defaultdict(set)
customer_orders = defaultdict(set)
for d, r in datasets:
    for row in r["fulfillments"]:
        fulfillments[row["state"]] += 1
        fulfilled_orders[row["state"]].add((d, row["order_id"]))
    for row in r["customer_evidence"]:
        if row["evidence_type"] == "SYNTHETIC_CUSTOMER_ORDER_LINK":
            customer_orders[(d, row["customer_key"])].add(row["order_id"])
assert answers["Q12"]["rows"] == [
    {"state": state, "transitions": fulfillments[state], "orders": len(fulfilled_orders[state])}
    for state in sorted(fulfillments)
]
assert {k: answers["Q13"][k] for k in (
    "customers_with_evidence", "customers_with_multiple_orders", "max_orders_for_one_customer"
)} == {
    "customers_with_evidence": len(customer_orders),
    "customers_with_multiple_orders": sum(len(v) >= 2 for v in customer_orders.values()),
    "max_orders_for_one_customer": max(map(len, customer_orders.values())),
}

inventory = defaultdict(lambda: [0, 0, 0, 0, 0])
for d, r in datasets:
    if d != "demo-gap-20261101-20261105-v1":
        continue
    for row in r["stock_positions"]:
        if row["effective_at"] <= "2026-11-04T12:00:00Z" < row["valid_to"]:
            v = inventory[row["location"]]
            v[0] += 1; v[1] += row["stocked"]; v[2] += row["reserved"]
            v[3] += row["stocked"] - row["reserved"]
            v[4] += row["stocked"] - row["reserved"] >= row["required_quantity"]
assert answers["Q14"]["rows"] == [
    {"location": location, "variant_positions": v[0], "stocked": v[1],
     "reserved": v[2], "physical_unreserved": v[3], "positions_meeting_required_quantity": v[4]}
    for location, v in sorted(inventory.items())
]
assert answers["Q15"]["historic_seed_status"] == answers["Q15"]["gap_seed_status"] == "READY_FOR_DEMO"
assert answers["Q15"]["observed_paid_revenue_answer"] == "INSUFFICIENT_CONTRACT"
assert answers["Q15"]["observed_search_to_cart_answer"] == "INSUFFICIENT_CORRELATION"
print(json.dumps({"status": "PASS", "questions": 15, "independent_fixture_checks": 14}))
