#!/usr/bin/env python3
"""Publish a versioned, read-only metadata snapshot to one DB-GPT KB space.

PGHOST/PGPORT/PGDATABASE/PGUSER/PGPASSWORD must address the restricted
funnelmetry_ai role; DBGPT_URL defaults to the local DB-GPT server. This is an
operator-invoked sync, not a scheduler or an authorization boundary.
"""

import hashlib
import argparse
import json
import os
import time
from urllib.parse import urlencode
from urllib.request import Request, urlopen

import psycopg2
from psycopg2.extras import RealDictCursor


BASE = os.environ.get("DBGPT_URL", "http://127.0.0.1:5670").rstrip("/")
EXPECTED = ("asset.reference_medusa_current_offer", "1.0.0", "reference.medusa.current_offer.v1")
GUIDE = """Current product reference for exploratory questions:
Use funnelmetry_ai.current_product_summary for the current product count.
Its grain is source_id; product_count counts current source/product rows, not
variants, orders, customers, sales or revenue. Check status on every query:
REFERENCE_CURRENT_ONLY permits a current reference answer with verified_at and
valid_until; a BLOCKED_BY_QUALITY error means do not report a count or infer
zero. Check funnelmetry_ai.catalog_quality for the current quality status.
Source is Medusa reference CDC, not the retired Admin API snapshot.
funnelmetry_ai.current_products contains current product names and has grain
source_id x product_id; it is a quality-gated CDC view, not a historical catalog.
current_variants has source_id x variant_id grain and links by source_id and
product_id. current_categories has source_id x category_id grain;
current_product_categories links source_id, product_id and category_id.
These are current catalog records only; joining variants or categories can
multiply product rows. Check quality and avoid counting joined rows as products.
Exploration schema funnelmetry_explore contains catalog_products,
catalog_variants, catalog_categories, catalog_product_categories, cart_lines,
order_recorded_state, behavior_events, funnel_instances, funnel_steps and
inventory_price_context. These are source projections marked UNVERIFIED;
use them to explore or diagnose, and explain quality and historical coverage.
UNVERIFIED on an exploratory view is not a blanket ban on descriptive analysis:
report observed counts and distributions as provisional, identify the source,
grain, period and coverage limitations, and do not claim official completeness.
For the seeded KLTN demo, query funnelmetry_demo.dataset_coverage. Its
READY_FOR_DEMO status applies to the synthetic dataset and period only, and
means fixture domain counts and session dates match the pinned manifest.
Use funnelmetry_demo synthetic views for descriptive analysis within that
period, identifying their synthetic origin. Source CDC history has separate
coverage and its historical gap does not prohibit analysis of the demo seed.
This readiness check does not prove observed coverage or fresh row checksums.
If a requested metric has a blocking quality gate, do not present raw rows as
the same confirmed metric; independent exploratory observations may still be
reported separately with their own limitations.
Catalog and inventory_price_context also expose source_quality_status,
source_quality_verified_at and source_quality_valid_until, scoped to their own
source and coverage epoch. REFERENCE_CURRENT_ONLY means a fresh reconciled
source lease for the current reference, not verified historical completeness,
and does not resolve inventory availability or customer price.
For cart_lines, order_recorded_state, behavior_events and inventory_price_context,
the exploration label is the column quality_status, not status. For funnel
instances and steps, exploration_status is UNVERIFIED and quality_status is
the separate funnel projection status. order_recorded_state additionally has
source_quality_status and historical_gap_status. funnelmetry_ai.catalog_quality
describes catalog quality only; do not attribute it to cart, order or funnels.
For order analysis query funnelmetry_explore.order_reference_coverage: it
separately reports current_state_status and historical_gap_status, profile
activation and ingestion times for baseline/transition evidence. INCOMPLETE
means a historical source gap, not that every order is bad or that a fresh
CURRENT_STATE_READY current count is unusable. Gap endpoints UNKNOWN and
ingestion timestamps do not prove a complete historical interval. A profile
terminal is not the same as a count of all active order rows; require checkout,
post-activation transition and journey evidence. Baseline is not a new event.
Join catalog tables on source_id, coverage_epoch_id and the corresponding ID;
cart and catalog coverage epochs are independent and must not be equated.
Catalog relationships and funnel steps can multiply rows. CDC order state ON
is the terminal condition of the active reference-commerce-current-state@2.0.0
funnel: count journeys with checkout and terminal ON after activation in a
verified coverage epoch; OFF can retract it and baseline does not create ON.
The order may still be pending in Medusa; pending alone does not determine ON.
Report this reference funnel terminal using its own profile and quality. It
does not prove payment, delivery or revenue and is not the historical
commerce-conversion metric based on order.placed.
inventory_price_context is unresolved raw context, not sellable inventory or
customer-facing price. Search text may contain sensitive information.
Source: Pipeline infra/postgres/v2/021_catalog_cdc_candidate.sql and
tools/dbgpt-metadata-sync/analytical-views.sql and exploration-views.sql.
This explanatory guide is a
derived integration note, not a published metric, tool or quality certificate.
Never calculate paid revenue, conversion or historical order value from it.
"""


def api(path, data=None, form=False):
    headers = {}
    # Integration mode verifies the existing Funnelmetry session on every API
    # request. Keep the optional short-lived token outside command arguments.
    token = os.environ.get("DBGPT_PIPELINE_BEARER_TOKEN", "").strip()
    if token:
        if "\r" in token or "\n" in token:
            raise ValueError("Invalid DB-GPT bearer token")
        headers["Authorization"] = "Bearer " + token
    if data is not None:
        if form:
            data = urlencode(data).encode()
            headers["Content-Type"] = "application/x-www-form-urlencoded"
        else:
            data = json.dumps(data).encode()
            headers["Content-Type"] = "application/json"
    with urlopen(Request(BASE + path, data=data, headers=headers), timeout=60) as response:
        result = json.load(response)
    if not result.get("success"):
        raise RuntimeError("DB-GPT request failed: " + path + ": " + str(result.get("err_msg", "unknown")))
    return result.get("data")


def find_space(name):
    # These v1 endpoints are available under the Pipeline identity policy.
    spaces = api("/api/v1/knowledge/space/list", {"name": name})
    matches = [space for space in spaces if space.get("name") == name]
    if len(matches) > 1:
        raise RuntimeError("Duplicate DB-GPT knowledge space name")
    return matches[0] if matches else None


def find_document(space_name, predicate):
    # DB-GPT's v2 document-list route currently serializes documents using the
    # space response model, dropping document name/status. The v1 UI endpoint
    # returns the document fields required for idempotency and sync status.
    page = 1
    while True:
        result = api("/api/v1/knowledge/" + space_name + "/document/list", {"page": page, "page_size": 100})
        items = result.get("data", [])
        for item in items:
            if predicate(item):
                return item
        if not items or page * 100 >= result.get("total", 0):
            return None
        page += 1


def main(check_only=False):
    with psycopg2.connect(connect_timeout=10, options="-c statement_timeout=10000") as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("SELECT * FROM funnelmetry_ai.reference_offer_metadata")
            rows = cur.fetchall()
    if len(rows) != 1:
        raise RuntimeError("Expected exactly one active reference-offer release")
    row = rows[0]
    if tuple(row[k] for k in ("asset_id", "asset_version", "contract_id")) != EXPECTED or row["binding_state"] != "ACTIVE":
        raise RuntimeError("Reference-offer identity or activation does not match")
    definition = row["definition"]
    if not isinstance(definition, dict) or tuple(definition.get(k) for k in ("asset_id", "asset_version", "contract_id")) != EXPECTED:
        raise RuntimeError("Published definition identity mismatch")
    canonical = json.dumps(definition, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    digest = hashlib.sha256((canonical + "\n" + GUIDE).encode()).hexdigest()
    space_name = "funnelmetry-offer-1-0-0-" + digest[:12]
    name = "reference-offer-1.0.0-" + digest[:12]
    content = (
        "Funnelmetry versioned reference metadata snapshot\n"
        + "Source: PostgreSQL funnelmetry_ai.reference_offer_metadata; binding ACTIVE.\n"
        + "Snapshot digest SHA-256: " + digest + "\n"
        + "This is a derived retrieval copy. Runtime quality can change; check it at query time.\n"
        + "Published asset definition:\n" + json.dumps(definition, ensure_ascii=False, indent=2)
        + "\n\n" + GUIDE
    )
    space = find_space(space_name)
    if check_only:
        doc = find_document(space_name, lambda x: x.get("doc_name") == name) if space else None
        result = {"space": space_name, "sha256": digest, "asset": EXPECTED[0],
                  "version": EXPECTED[1], "status": doc.get("status") if doc else "MISSING"}
        print(json.dumps(result))
        return
    if not space:
        api("/api/v1/knowledge/space/add", {"name": space_name, "vector_type": "VectorStore", "domain_type": "Normal", "owner": "funnelmetry", "desc": "Versioned reference metadata snapshot " + digest, "index_methods": ["VectorStore"]})
        space = find_space(space_name)
    if not space:
        raise RuntimeError("Created KB space was not visible")
    doc = find_document(space_name, lambda x: x.get("doc_name") == name)
    if not doc:
        doc_id = api("/api/v1/knowledge/" + space_name + "/document/add", {"doc_name": name, "doc_type": "TEXT", "content": content})
        doc = {"id": int(doc_id), "status": "TODO"}
    if doc.get("status") not in ("RUNNING", "FINISHED"):
        api("/api/v1/knowledge/" + space_name + "/document/sync", {"doc_ids": [doc["id"]], "model_name": "text-embedding-v3"})
    for _ in range(30):
        doc = find_document(space_name, lambda x: x.get("id") == doc["id"])
        if doc and doc.get("status") == "FINISHED":
            print(json.dumps({"space": space_name, "document_id": doc["id"], "status": "FINISHED", "sha256": digest, "asset": EXPECTED[0], "version": EXPECTED[1]}))
            return
        if doc and doc.get("status") in ("FAILED", "ERROR"):
            raise RuntimeError("DB-GPT KB indexing failed: " + str(doc.get("result", "unknown"))[:300])
        time.sleep(2)
    raise RuntimeError("DB-GPT KB indexing did not finish within the wait period")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Read current release and KB status without publishing or indexing")
    main(check_only=parser.parse_args().check)
