#!/usr/bin/env python3
"""
Spark streaming placeholder — infra-only stack.

Waits until Kafka and PostgreSQL are reachable, then idles until a new
streaming job and schema are implemented.
"""

import logging
import os
import socket
import sys
import time

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)

KAFKA_BOOTSTRAP = os.environ.get("KAFKA_BOOTSTRAP_SERVERS", "kafka:9092")
POSTGRES_HOST = os.environ.get("POSTGRES_HOST", "postgres")
POSTGRES_PORT = int(os.environ.get("POSTGRES_PORT", "5432"))
POLL_SEC = int(os.environ.get("HEALTH_POLL_SEC", "30"))


def check_tcp(host: str, port: int, timeout: float = 3.0) -> bool:
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


def wait_for_dependencies() -> None:
    kafka_host, _, kafka_port = KAFKA_BOOTSTRAP.partition(":")
    kafka_port = int(kafka_port or "9092")

    logger.info("Waiting for Kafka (%s:%s) and Postgres (%s:%s)...", kafka_host, kafka_port, POSTGRES_HOST, POSTGRES_PORT)
    while True:
        kafka_ok = check_tcp(kafka_host, kafka_port)
        pg_ok = check_tcp(POSTGRES_HOST, POSTGRES_PORT)
        if kafka_ok and pg_ok:
            logger.info("Dependencies ready. Streaming job not configured yet — idling.")
            return
        time.sleep(3)


def main() -> None:
    logger.info("Spark streaming placeholder starting")
    wait_for_dependencies()
    while True:
        kafka_host, _, kafka_port = KAFKA_BOOTSTRAP.partition(":")
        kafka_port = int(kafka_port or "9092")
        if check_tcp(kafka_host, kafka_port) and check_tcp(POSTGRES_HOST, POSTGRES_PORT):
            logger.info("Healthy (kafka + postgres). Awaiting new pipeline schema.")
        else:
            logger.warning("Dependency check failed — will retry")
        time.sleep(POLL_SEC)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        logger.info("Shutting down")
        sys.exit(0)
