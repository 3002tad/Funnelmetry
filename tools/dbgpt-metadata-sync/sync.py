#!/usr/bin/env python3
"""Publish a versioned, read-only metadata snapshot to one DB-GPT KB space.

PGHOST/PGPORT/PGDATABASE/PGUSER/PGPASSWORD must address the restricted
funnelmetry_ai role; DBGPT_URL defaults to the local DB-GPT server. This is an
operator-invoked sync, not a scheduler or an authorization boundary.
"""

import hashlib
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
valid_until; BLOCKED_BY_QUALITY or NULL product_count means do not report a
count. Source is Medusa reference CDC, not the retired Admin API snapshot.
funnelmetry_ai.current_products contains current product names and has grain
source_id x product_id; it is a quality-gated CDC view, not a historical catalog.
Source: Pipeline infra/postgres/v2/021_catalog_cdc_candidate.sql and
tools/dbgpt-metadata-sync/analytical-views.sql. This explanatory guide is a
derived integration note, not a published metric, tool or quality certificate.
Never calculate paid revenue, conversion or historical order value from it.
"""


def api(path, data=None, form=False):
    headers = {}
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


def find_page(path, predicate):
    page = 1
    while True:
        result = api(path + "?" + urlencode({"page": page, "page_size": 100}))
        for item in result.get("items", []):
            if predicate(item):
                return item
        if page >= result.get("total_pages", 0):
            return None
        page += 1


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


def main():
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
    space = find_page("/api/v2/serve/knowledge/spaces", lambda x: x.get("name") == space_name)
    if not space:
        api("/api/v1/knowledge/space/add", {"name": space_name, "vector_type": "VectorStore", "domain_type": "Normal", "owner": "funnelmetry", "desc": "Versioned reference metadata snapshot " + digest, "index_methods": ["VectorStore"]})
        space = find_page("/api/v2/serve/knowledge/spaces", lambda x: x.get("name") == space_name)
    if not space:
        raise RuntimeError("Created KB space was not visible")
    doc = find_document(space_name, lambda x: x.get("doc_name") == name)
    if not doc:
        # The current DB-GPT request model rejects None for doc_file even for
        # TEXT documents; a string placeholder is ignored by its TEXT path.
        doc_id = api("/api/v2/serve/knowledge/documents", {"doc_name": name, "doc_type": "TEXT", "space_id": str(space["id"]), "content": content, "doc_file": "text"}, form=True)
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
    main()
