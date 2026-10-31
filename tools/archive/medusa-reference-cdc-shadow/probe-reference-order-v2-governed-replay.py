#!/usr/bin/env python3
"""Replay the candidate order v2 sink group without changing source or old sink."""

import importlib.util
import json
import os
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location(
    "candidate_verifier", ROOT / "verify-reference-order-v2-governed-candidate.py")
check = importlib.util.module_from_spec(spec)
spec.loader.exec_module(check)
GROUP = "cdc-shadow-governed-reference-v2-epoch2"


def group_offset():
    output = check.run(check.BASE + ["exec", "-T", "kafka",
                                     "/opt/kafka/bin/kafka-consumer-groups.sh",
                                     "--bootstrap-server", "kafka:9092", "--group", GROUP,
                                     "--describe"])
    for line in output.splitlines():
        columns = line.split()
        if len(columns) >= 5 and columns[0] == GROUP and columns[1] == check.TOPIC and \
                columns[2] == "0" and columns[3].isdigit():
            return int(columns[3])
    return None


def main():
    if os.environ.get("COMPOSE_PROJECT_NAME") != "funnelmetry_cdc_shadow_cdc10":
        raise RuntimeError("requires exact isolated CDC-10 clone project")
    before = check.state()
    end = check.topic_end()
    if int(before["candidate_offset"] or 0) != end:
        raise RuntimeError("candidate sink must be caught up before replay")
    check.run(check.BASE + ["stop", "reference-order-v2-governed-sink"])
    try:
        check.run(check.BASE + ["exec", "-T", "kafka",
                                "/opt/kafka/bin/kafka-consumer-groups.sh",
                                "--bootstrap-server", "kafka:9092", "--group", GROUP,
                                "--reset-offsets", "--to-earliest", "--all-topics", "--execute"])
    finally:
        check.run(check.BASE + ["up", "-d", "reference-order-v2-governed-sink"])
    deadline = time.monotonic() + 120
    while group_offset() != end:
        if time.monotonic() >= deadline:
            raise RuntimeError("candidate consumer group did not reach topic end")
        time.sleep(5)
    after = check.state()
    matched = (before["candidate_counts"] == after["candidate_counts"] and
               before["candidate_states"] == after["candidate_states"] and
               before["candidate_offset"] == after["candidate_offset"] == end and
               after["readable_count"] == 0)
    print(json.dumps({"status": "PASS_REPLAY" if matched else "BLOCKED_BY_QUALITY",
                      "topic_end": end, "offset_unchanged":
                      before["candidate_offset"] == after["candidate_offset"],
                      "record_counts_unchanged":
                      before["candidate_counts"] == after["candidate_counts"],
                      "state_rows_unchanged":
                      before["candidate_states"] == after["candidate_states"]}, sort_keys=True))
    if not matched:
        raise RuntimeError("candidate sink replay changed durable state")


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, ValueError, OSError) as error:
        raise SystemExit(f"reference-order-v2-governed-replay: {error}") from None
