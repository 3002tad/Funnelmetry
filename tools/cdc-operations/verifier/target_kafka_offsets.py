"""Read exact partition-zero ends for target CDC topics in one Kafka query."""

import re
import subprocess


def parse_topic_ends(output, topics):
    requested = set(topics)
    if len(requested) != len(topics) or not requested:
        raise ValueError("duplicate or empty target topic request")
    ends = {}
    for line in output.splitlines():
        parts = line.rsplit(":", 2)
        if len(parts) != 3 or parts[0] not in requested:
            continue
        topic, partition, offset = parts
        if partition != "0" or not re.fullmatch(r"[0-9]+", offset) or topic in ends:
            raise ValueError("target CDC topic is not an exact single partition")
        ends[topic] = int(offset)
    if set(ends) != requested:
        raise ValueError("target CDC topic missing from Kafka offset response")
    return ends


def read_topic_ends(container, topics):
    result = subprocess.run(
        ["docker", "exec", container, "/opt/kafka/bin/kafka-get-offsets.sh",
         "--bootstrap-server", "kafka:9092"],
        text=True, capture_output=True, check=False)
    if result.returncode:
        raise RuntimeError("target Kafka offset query failed")
    return parse_topic_ends(result.stdout, topics)
