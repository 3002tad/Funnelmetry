#!/usr/bin/env python3
"""Publish/retrieve a derived DB-GPT KB document from the active PostgreSQL release.

Runs on the VPS operator host with Docker CLI and localhost Pipeline/DB-GPT APIs.
The admin password is read from a pre-existing root-owned file and never printed.
"""
import argparse
import ast
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import time
from urllib.request import Request, urlopen

RELEASE = "demo-commerce-analysis@1.2.0"
DEFINITION_SHA = "2bb4829a13acb231d5b5ce4f7ba77a3ee7259ea68de745048e4435befb691c9f"
API = "http://127.0.0.1:5670"
PIPELINE = "http://127.0.0.1:31080"
PIPELINE_HOST = os.environ.get("SWARM_PUBLIC_DOMAIN", "analyst.entidi.io.vn")

def read_release():
    containers = subprocess.check_output([
        "docker", "ps", "-q", "--filter",
        "label=com.docker.swarm.service.name=funnelmetry_vps_live_postgres",
    ], text=True).splitlines()
    if len(containers) != 1:
        raise RuntimeError("expected exactly one Pipeline PostgreSQL container")
    query = (
        "SET ROLE funnelmetry_ai_agent; "
        "SELECT row_to_json(x) FROM "
        "(SELECT release_id,definition,sha256,status FROM funnelmetry_demo.semantic_release) x;"
    )
    output = subprocess.check_output([
        "docker","exec","-i",containers[0],"psql","-X","-A","-t",
        "-v","ON_ERROR_STOP=1","-U","funnelmetry","-d","funnelmetry_handoff","-c",query,
    ], text=True)
    rows = [json.loads(line) for line in output.splitlines() if line.startswith("{")]
    if len(rows) != 1 or rows[0]["release_id"] != RELEASE or rows[0]["sha256"] != DEFINITION_SHA or rows[0]["status"] != "ACTIVE_DEMO":
        raise RuntimeError("active demo release unavailable or changed")
    return rows[0]["definition"]

def request(url, data, token=None):
    headers = {"Content-Type": "application/json"}
    if url.startswith(PIPELINE + "/"):
        # Traefik selects the Pipeline router by its public hostname.
        headers["Host"] = PIPELINE_HOST
    if token:
        headers["Authorization"] = "Bearer " + token
    encoded = json.dumps(data).encode()
    with urlopen(Request(url, data=encoded, headers=headers), timeout=60) as response:
        return json.load(response)

def acquire_token(path, email):
    with open(path, encoding="utf-8") as stream:
        password = stream.read().strip()
    result = request(PIPELINE + "/api/auth/login", {"email":email,"password":password})
    token = result.get("token")
    if not isinstance(token,str) or not token:
        raise RuntimeError("Pipeline login failed")
    return token

def api(path, payload, token):
    result = request(API + path, payload, token)
    if not result.get("success"):
        raise RuntimeError("DB-GPT API failed at " + path + ": " + str(result.get("err_msg", "unknown"))[:160])
    return result.get("data")

def find_space(name, token):
    matches = [s for s in api("/api/v1/knowledge/space/list",{"name":name},token) if s.get("name")==name]
    if len(matches)>1:
        raise RuntimeError("duplicate knowledge space")
    return matches[0] if matches else None

def find_document(space, name, token):
    page = 1
    while True:
        result = api(f"/api/v1/knowledge/{space}/document/list",{"page":page,"page_size":100},token)
        documents = result.get("data",[])
        for item in documents:
            if item.get("doc_name")==name:
                return item
        if not documents or 100*page>=result.get("total",0):
            return None
        page += 1

def guide(definition):
    lines = [
        "Funnelmetry synthetic demo semantic guide",
        f"Semantic release: {RELEASE}; PostgreSQL definition SHA-256: {DEFINITION_SHA}.",
        "Numeric and definition authority: funnelmetry_demo.semantic_release, PostgreSQL funnelmetry_handoff.",
        "This document is derived KB guidance. SQL must read the current PostgreSQL views.",
        "For both synthetic periods, query funnelmetry_demo.dataset_coverage for historical seed and funnelmetry_demo.gap_dataset_coverage for gap seed; report each result separately. READY_FOR_DEMO verifies fixture counts and session bounds against its manifest, not observed coverage or a source lease.",
        "funnelmetry_demo.gap_overlap_status reports observed events arriving inside synthetic dates, not gap seed quality. Do not claim a status for a view that was not queried.",
        "Synthetic period: [2025-11-01, 2026-11-05) UTC. Browser observed rows are exposed from 2026-11-05 onward.",
        "Synthetic order/payment/fulfillment/price/stock/customer rows are scenario data, not observed Medusa history.",
        "Always join synthetic assets with dataset_id plus entity key. Repeated catalog snapshots otherwise multiply rows.",
        "For PostgreSQL distinct entity counts across datasets use COUNT(DISTINCT (dataset_id, session_id)) or COUNT(DISTINCT (dataset_id, order_id)); do not drop dataset_id when IDs happen to be unique in one fixture.",
        "For synthetic session analysis use sessions(dataset_id, session_id, started_at), browser_events(dataset_id, session_id, event_type, occurred_at) and cart_links(dataset_id, session_id, cart_id, occurred_at). Count all sessions from sessions, not event rows. behavior_events_all combines synthetic and observed events but has no session_id.",
        "Historical dataset_coverage has period_start, period_end, demo_status and scope_note. gap_dataset_coverage has dataset_id, demo_status, mismatched_domains and invalid_sessions; it does not have period_start, period_end or scope_note. Inspect the real schema before selecting other columns.",
        "Use event occurred_at, session started_at, order created_at, payment action_at and fulfillment occurred_at separately.",
        "Search text is an independent demand signal. Observed search-to-cart has insufficient correlation.",
        "Synthetic payment CAPTURED and REFUNDED actions are supported; observed paid revenue has insufficient binding.",
        "Stocked minus reserved is a physical scenario position, not a sellable Medusa stock measure.",
        "Order reference_state=ON is synthetic state, not proof of paid revenue or live conversion.",
        "Monthly November 2026 is only four synthetic days, so compare periods of equal duration when describing trends.",
        "Use the 15 versioned benchmark questions in tools/demo-seed-pilot/demo-golden-v2.sql for SQL examples.",
        "Assets:",
    ]
    lines[-1:-1] = ["Analysis guidance:"] + ["- " + item for item in definition["analysis_guidance"]]
    for asset in definition["assets"]:
        lines.append(f"- {asset['id']}: {asset['view']}; grain {', '.join(asset['grain'])}; fields {', '.join(asset['fields'])}.")
        if asset.get("limitation"):
            lines.append(f"  Limitation: {asset['limitation']}.")
    lines.append("Relationships:")
    for rel in definition["relationships"]:
        lines.append(f"- {rel['from']} -> {rel['to']}: keys {', '.join(rel['keys'])}; {rel['cardinality']}; {rel['safe_aggregation']}.")
    lines.append("Measures:")
    for measure in definition["measures"]:
        lines.append(f"- {measure['id']}: {measure['expression']} on {measure['asset']}; {measure['unit']}.")
    return "\n".join(lines) + "\n"

def verify_golden_sql(token):
    base = Path(__file__).resolve().parent
    sql = (base / "demo-golden-v2.sql").read_text(encoding="utf-8")
    answers = json.loads((base / "demo-golden-v2-answers.json").read_text(encoding="utf-8"))
    expected = {answer["id"]: answer for answer in answers["answers"]}
    blocks = re.findall(r"(?ms)^-- (Q\d{2})\b[^\n]*\n(.*?)(?=^-- Q\d{2}\b|\Z)", sql)
    if len(blocks) != 15 or len(expected) != 15:
        raise RuntimeError("golden benchmark must contain exactly 15 questions")
    for question_id, block in blocks:
        statement = "\n".join(line for line in block.splitlines() if not line.lstrip().startswith("--")).strip()
        if not statement.endswith(";"):
            raise RuntimeError("missing SQL terminator in " + question_id)
        result = api("/api/v1/editor/sql/run", {"db_name":"funnelmetry_handoff","sql":statement[:-1]}, token)
        values = result.get("values") if isinstance(result, dict) else None
        if result.get("result_info") or not values or len(values) != 1 or len(values[0]) != 1:
            raise RuntimeError("DB-GPT SQL execution failed for " + question_id)
        raw_value = values[0][0]
        try:
            actual = json.loads(raw_value)
        except json.JSONDecodeError:
            # The DB-GPT SQL editor stringifies psycopg's decoded jsonb dict.
            actual = ast.literal_eval(raw_value)
        if not isinstance(actual, dict):
            raise RuntimeError("unexpected DB-GPT SQL answer type for " + question_id)
        baseline = dict(expected[question_id])
        if question_id == "Q15":
            # Observed rows can arrive after the answer snapshot was recorded.
            actual.pop("observed_browser_events_after_boundary", None)
            baseline.pop("observed_browser_events_after_boundary", None)
        if actual != baseline:
            raise RuntimeError("DB-GPT SQL answer differs from fixture baseline for " + question_id)
    return len(blocks)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["check","publish","verify"])
    parser.add_argument("--password-file", required=True)
    parser.add_argument("--email", choices=["admin@example.local","analyst@example.local"],
                        default="admin@example.local")
    args = parser.parse_args()
    definition = read_release()
    content = guide(definition)
    digest = hashlib.sha256(content.encode()).hexdigest()
    space_name = "funnelmetry-demo-1-2-0-" + digest[:12]
    doc_name = "demo-commerce-analysis-1.2.0-" + digest[:12]
    token = acquire_token(args.password_file, args.email)
    space = find_space(space_name, token)
    document = find_document(space_name, doc_name, token) if space else None
    if args.command == "check":
        print(json.dumps({"release_id":RELEASE,"kb_space":space_name,
                          "document_status":document.get("status") if document else "MISSING"}))
        return
    if args.command == "publish":
        if not space:
            api("/api/v1/knowledge/space/add",{"name":space_name,"vector_type":"VectorStore",
                "domain_type":"Normal","owner":"funnelmetry","desc":"Derived demo metadata "+digest,
                "index_methods":["VectorStore"]},token)
            space = find_space(space_name,token)
        if not space:
            raise RuntimeError("new knowledge space not visible")
        if not document:
            doc_id = api(f"/api/v1/knowledge/{space_name}/document/add",{
                "doc_name":doc_name,"doc_type":"TEXT","content":content},token)
            document = {"id":int(doc_id),"status":"TODO"}
        if document.get("status") not in ("RUNNING","FINISHED"):
            api(f"/api/v1/knowledge/{space_name}/document/sync",{
                "doc_ids":[document["id"]],"model_name":"text-embedding-v3"},token)
        for _ in range(40):
            document = find_document(space_name,doc_name,token)
            if document and document.get("status")=="FINISHED":
                break
            if document and document.get("status") in ("FAILED","ERROR"):
                raise RuntimeError("knowledge indexing failed")
            time.sleep(2)
    if not document or document.get("status")!="FINISHED":
        raise RuntimeError("knowledge document not indexed")
    if args.command == "verify":
        result = api(f"/api/v1/knowledge/{space_name}/recall_test",{
            "question":"Funnelmetry synthetic demo semantic release, dataset_id join, observed paid revenue limitation",
            "recall_top_k":5,"recall_score_threshold":-100},token)
        if not result:
            raise RuntimeError("knowledge retrieval returned no chunks")
        content_found = RELEASE in json.dumps(result,ensure_ascii=False)
        if not content_found:
            raise RuntimeError("knowledge retrieval did not return expected release marker")
        sql_count = verify_golden_sql(token)
    print(json.dumps({"release_id":RELEASE,"kb_space":space_name,
                      "document_id":document["id"],"status":document["status"],
                      "retrieval":"PASS" if args.command=="verify" else "NOT_RUN",
                      "db_gpt_sql":f"{sql_count}/15 PASS" if args.command=="verify" else "NOT_RUN"}))

if __name__ == "__main__":
    main()
