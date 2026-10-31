#!/usr/bin/env python3
"""Guarded candidate-only migration 026 on the CDC-11 target Pipeline DB."""

import argparse
import hashlib
import json
import re
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
MIGRATIONS = (
    "021_catalog_cdc_candidate.sql",
    "022_inventory_price_cdc_context_candidate.sql",
    "023_reference_order_cdc_v2_candidate.sql",
    "025_reference_order_cdc_v2_funnel_candidate.sql",
    "026_reference_order_cdc_v2_pending_quality_candidate.sql",
)
TABLE = "reference_cdc_v2_pending_quality_candidate"
SERVICE = "funnelmetry_vps_live_postgres"


def run(command, input_text=None):
    result = subprocess.run(command, input=input_text, text=True,
                            capture_output=True, check=False)
    if result.returncode:
        raise RuntimeError(f"candidate migration command failed ({command[0]} exit {result.returncode})")
    return result.stdout.strip()


def pipeline_container():
    values = run(["docker", "ps", "-q", "--filter",
                  f"label=com.docker.swarm.service.name={SERVICE}"]).splitlines()
    if len(values) != 1 or not re.fullmatch(r"[a-f0-9]{12,64}", values[0]):
        raise RuntimeError("Pipeline target PostgreSQL task is not unique")
    return values[0]


def sql(container, statement):
    return run(["docker", "exec", "-i", container, "psql", "-X", "-U",
                "funnelmetry", "-d", "funnelmetry_handoff", "-At",
                "-v", "ON_ERROR_STOP=1"], statement)


def expected():
    directory = ROOT / "infra" / "postgres" / "v2"
    return [(name, hashlib.sha256((directory / name).read_bytes()).hexdigest())
            for name in MIGRATIONS]


def inspect(container, digests):
    output = sql(container, f"""SELECT json_build_object(
      'ready',(SELECT status FROM handoff_bootstrap WHERE id=1),
      'journal',(SELECT COALESCE(json_agg(json_build_array(file_name,
        content_sha256) ORDER BY file_name),'[]'::json)
        FROM cdc_candidate_migration_journal),
      'table_present',to_regclass('public.{TABLE}') IS NOT NULL)::text;""")
    value = json.loads(output)
    journal = value.get("journal")
    reviewed = [list(pair) for pair in digests]
    if value.get("ready") != "READY" or not isinstance(journal, list) or \
            journal not in (reviewed[:4], reviewed) or \
            value.get("table_present") != (len(journal) == 5):
        raise RuntimeError("target candidate journal/schema differs from reviewed prefix")
    return "ALREADY_APPLIED" if len(journal) == 5 else "READY_TO_APPLY"


def apply(container, digests):
    prior = json.dumps(digests[:4], separators=(",", ":"))
    filename, digest = digests[4]
    migration = (ROOT / "infra" / "postgres" / "v2" / filename).read_text(
        encoding="utf-8")
    statement = f"""BEGIN;
      SELECT pg_advisory_xact_lock(hashtext('funnelmetry-cdc11-candidate-migrations'));
      DO $check$ BEGIN
        IF (SELECT status FROM handoff_bootstrap WHERE id=1) <> 'READY'
          OR (SELECT COALESCE(jsonb_agg(jsonb_build_array(file_name,
            content_sha256) ORDER BY file_name),'[]'::jsonb)
            FROM cdc_candidate_migration_journal) <> '{prior}'::jsonb
          OR to_regclass('public.{TABLE}') IS NOT NULL
        THEN RAISE EXCEPTION 'CDC-11 candidate migration prefix changed';
        END IF;
      END $check$;
      {migration}
      INSERT INTO cdc_candidate_migration_journal(file_name,content_sha256)
        VALUES('{filename}','{digest}');
      COMMIT;"""
    output = sql(container, statement)
    if "COMMIT" not in output.splitlines():
        raise RuntimeError("candidate migration did not commit")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=("plan", "apply"))
    parser.add_argument("--acknowledge-candidate-only", action="store_true")
    args = parser.parse_args()
    if args.mode == "apply" and not args.acknowledge_candidate_only:
        parser.error("candidate-only acknowledgement required")
    digests = expected()
    container = pipeline_container()
    before = inspect(container, digests)
    if args.mode == "apply" and before == "READY_TO_APPLY":
        apply(container, digests)
        after = inspect(container, digests)
        if after != "ALREADY_APPLIED":
            raise RuntimeError("candidate migration post-check failed")
        print(json.dumps({"status": "APPLIED_CANDIDATE_ONLY", "file": MIGRATIONS[4]}))
    else:
        print(json.dumps({"status": before, "file": MIGRATIONS[4]}))


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, OSError, ValueError, json.JSONDecodeError) as error:
        raise SystemExit(f"cdc-target-pending-migration: {error}") from None
