#!/usr/bin/env python3
"""Exercise catalog CDC semantics on a disposable, isolated Medusa clone only."""

import argparse
import importlib.util
import json
import os
import re
import subprocess
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parent
PROJECT = re.compile(r"funnelmetry_cdc_catalog_shadow_[a-z0-9][a-z0-9_-]{0,32}\Z")
spec = importlib.util.spec_from_file_location("catalog_verify", ROOT / "verify-catalog-shadow.py")
verify = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verify)
BASE = verify.BASE
FULL = verify.PROJECTION
SUFFIX = " [cdc10-catalog-probe]"


def run(command, stdin=None):
    result = subprocess.run(command, input=stdin, text=True, capture_output=True, check=False)
    if result.returncode:
        raise RuntimeError(f"isolated probe command failed: {command[0]} (exit {result.returncode})")
    return result.stdout.strip()


def source_sql(statement):
    return run(BASE + ["exec", "-T", "postgres", "psql", "-X", "-U", "medusa",
                       "-d", "medusa", "-At", "-v", "ON_ERROR_STOP=1"], statement)


def projection_sql(statement):
    return run(FULL + ["exec", "-T", "catalog-projection-db", "psql", "-X",
                       "-U", "catalog_projection", "-d", "catalog_projection", "-At",
                       "-v", "ON_ERROR_STOP=1"], statement)


def state():
    return verify.evaluate(verify.source(), verify.projection(), verify.topic_ends(),
                           verify.connector_running())


def catch_up(label, timeout):
    start = time.monotonic()
    while True:
        result = state()
        if result["status"] == "PASS":
            return {"case": label, "status": "PASS",
                    "catch_up_seconds": round(time.monotonic() - start, 3),
                    "audit_count": result["audit_count"],
                    "counts": {key: value["projection"] for key, value in result["counts"].items()}}
        if time.monotonic() - start > timeout:
            raise RuntimeError(f"{label}: projection did not reconcile before timeout")
        time.sleep(2)


def identifier(value):
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", value):
        raise RuntimeError("unexpected source identifier shape")
    return value


def quote(value):
    return "'" + value.replace("'", "''") + "'"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--timeout-seconds", type=int, default=90)
    args = parser.parse_args()
    if not PROJECT.fullmatch(os.environ.get("COMPOSE_PROJECT_NAME", "")):
        parser.error("only an isolated catalog shadow clone may be modified")
    if not 10 <= args.timeout_seconds <= 600:
        parser.error("timeout must be 10..600 seconds")
    if int(source_sql("SELECT count(*) FROM product;")) < 2:
        raise RuntimeError("probe requires at least two cloned products")
    if int(source_sql("SELECT count(*) FROM product_category;")) < 1 or \
            int(source_sql("SELECT count(*) FROM product_variant;")) < 1:
        raise RuntimeError("probe requires a cloned variant and category")
    if source_sql("SELECT count(*) FROM pg_stat_activity WHERE datname='medusa' "
                  "AND application_name ILIKE '%medusa%';") != "0":
        raise RuntimeError("unexpected application connection to clone")

    results = [catch_up("initial_snapshot", args.timeout_seconds)]
    product = identifier(source_sql("SELECT id FROM product WHERE deleted_at IS NULL "
                                    "ORDER BY id LIMIT 1;"))
    if source_sql(f"SELECT title LIKE '%{SUFFIX}' FROM product WHERE id={quote(product)};") != "f":
        raise RuntimeError("probe title suffix already present")
    source_sql(f"UPDATE product SET title=title || {quote(SUFFIX)}, updated_at=now() "
               f"WHERE id={quote(product)};")
    results.append(catch_up("product_update", args.timeout_seconds))
    source_sql(f"UPDATE product SET title=left(title,length(title)-{len(SUFFIX)}), "
               f"updated_at=now() WHERE id={quote(product)} AND title LIKE '%{SUFFIX}';")
    results.append(catch_up("product_update_restore", args.timeout_seconds))

    soft = identifier(source_sql("SELECT id FROM product WHERE deleted_at IS NULL "
                                 f"AND id<>{quote(product)} ORDER BY id LIMIT 1;"))
    source_sql(f"UPDATE product SET deleted_at=now(),updated_at=now() WHERE id={quote(soft)};")
    results.append(catch_up("product_soft_delete", args.timeout_seconds))
    source_sql(f"UPDATE product SET deleted_at=NULL,updated_at=now() WHERE id={quote(soft)};")
    results.append(catch_up("product_soft_delete_restore", args.timeout_seconds))

    relation = source_sql("SELECT p.id || '|' || c.id FROM product p CROSS JOIN "
                          "product_category c WHERE NOT EXISTS (SELECT 1 FROM "
                          "product_category_product pc WHERE pc.product_id=p.id "
                          "AND pc.product_category_id=c.id) ORDER BY p.id,c.id LIMIT 1;")
    relation_product, relation_category = map(identifier, relation.split("|"))
    source_sql("INSERT INTO product_category_product(product_id,product_category_id) "
               f"VALUES({quote(relation_product)},{quote(relation_category)});")
    results.append(catch_up("category_relation_added", args.timeout_seconds))
    source_sql("DELETE FROM product_category_product "
               f"WHERE product_id={quote(relation_product)} "
               f"AND product_category_id={quote(relation_category)};")
    results.append(catch_up("category_relation_removed", args.timeout_seconds))

    variant = source_sql("SELECT id || '|' || product_id FROM product_variant "
                         "WHERE product_id IS NOT NULL ORDER BY id LIMIT 1;")
    variant_id, original_product = map(identifier, variant.split("|"))
    new_product = identifier(source_sql("SELECT id FROM product "
                                        f"WHERE id<>{quote(original_product)} "
                                        "ORDER BY id LIMIT 1;"))
    source_sql(f"UPDATE product_variant SET product_id={quote(new_product)}, "
               f"updated_at=now() WHERE id={quote(variant_id)};")
    results.append(catch_up("variant_relation_changed", args.timeout_seconds))
    source_sql(f"UPDATE product_variant SET product_id={quote(original_product)}, "
               f"updated_at=now() WHERE id={quote(variant_id)};")
    results.append(catch_up("variant_relation_restored", args.timeout_seconds))

    before = int(projection_sql("SELECT count(*) FROM catalog_cdc_audit;"))
    run(FULL + ["stop", "catalog-projector"])
    try:
        run(BASE + ["exec", "-T", "kafka", "/opt/kafka/bin/kafka-consumer-groups.sh",
                    "--bootstrap-server", "kafka:9092", "--group",
                    "cdc-shadow-catalog-projector-v1", "--reset-offsets", "--to-earliest",
                    "--all-topics", "--execute"])
    finally:
        run(FULL + ["up", "-d", "catalog-projector"])
    replay = catch_up("replay_from_earliest", args.timeout_seconds)
    replay["audit_unchanged"] = replay["audit_count"] == before
    if not replay["audit_unchanged"]:
        raise RuntimeError("replay generated duplicate catalog audit rows")
    results.append(replay)
    final = state()
    print(json.dumps({"status": "PASS", "cases": results,
                      "final_digest_match": final["source_digest"] == final["projection_digest"],
                      "final_topic_offsets": final["next_input_offsets"]}, sort_keys=True))


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, ValueError, OSError, subprocess.TimeoutExpired) as error:
        raise SystemExit(f"cdc-catalog-shadow-probe: {error}") from None
