#!/usr/bin/env python3
"""One-shot candidate-table restart check; cleans its own synthetic row."""

import argparse
import json
import re
import subprocess
import sys
import time
import uuid
from pathlib import Path


ROOT = Path(__file__).resolve().parent
TABLE = "cdc_projection_pending_quality_candidate"
SOURCE = "medusa-reference"
EPOCH = "cdc11_catalog_epoch1"
STREAM = "catalog"


def sql(container, statement):
    result = subprocess.run(["docker", "exec", "-i", container, "psql", "-X",
        "-U", "funnelmetry", "-d", "funnelmetry_handoff", "-At",
        "-v", "ON_ERROR_STOP=1"], input=statement, text=True, capture_output=True,
        check=False)
    if result.returncode:
        raise RuntimeError("candidate pending-age SQL failed")
    return result.stdout.strip()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pipeline-container", required=True)
    args = parser.parse_args()
    if not re.fullmatch(r"[a-f0-9]{12,64}", args.pipeline_container):
        parser.error("explicit Pipeline PostgreSQL container ID required")
    key = "cdc11-synthetic-projection-age-" + uuid.uuid4().hex
    first = time.time() - 30
    scoped = (f"source_id='{SOURCE}' AND coverage_epoch_id='{EPOCH}' "
              f"AND stream_name='{STREAM}' AND row_key='{key}'")
    sql(args.pipeline_container,
        f"INSERT INTO {TABLE}(source_id,coverage_epoch_id,stream_name,row_key,"
        f"first_observed_at,last_observed_at) VALUES('{SOURCE}','{EPOCH}',"
        f"'{STREAM}','{key}',to_timestamp({first}),clock_timestamp());")
    try:
        child = subprocess.run([sys.executable, "-c",
            "import json,sys;sys.path.insert(0,sys.argv[1]);"
            "import importlib.util;spec=importlib.util.spec_from_file_location('p',"
            "sys.argv[1]+'/probe-target-moving-projections.py');"
            "p=importlib.util.module_from_spec(spec);spec.loader.exec_module(p);"
            "print(json.dumps(p.read_pending(sys.argv[2])))",
            str(ROOT), args.pipeline_container], text=True, capture_output=True,
            check=False)
        if child.returncode:
            raise RuntimeError("new Python process could not read candidate pending age")
        result = json.loads(child.stdout)
        restored = result["catalog"][key]
        if abs(restored - first) > 0.01 or time.time() - restored < 29:
            raise RuntimeError("pending first observation changed across process restart")
        print(json.dumps({"status": "PASS_PERSISTED_PROJECTION_AGE",
                          "age_floor_seconds": 29,
                          "scope": "CANDIDATE_TABLE_ONLY"}, sort_keys=True))
    finally:
        sql(args.pipeline_container, f"DELETE FROM {TABLE} WHERE {scoped};")
        remaining = sql(args.pipeline_container,
            f"SELECT count(*) FROM {TABLE} WHERE {scoped};")
        if remaining != "0":
            raise RuntimeError("synthetic candidate pending row was not removed")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (RuntimeError, OSError, ValueError, KeyError, json.JSONDecodeError) as error:
        raise SystemExit(f"cdc-target-projection-pending-restart: {error}") from None
