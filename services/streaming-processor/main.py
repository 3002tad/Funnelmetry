#!/usr/bin/env python3
"""
Streaming Processor — Phase 2.

Pipeline:
  Kafka(tracking_events_raw)
    → parser → validator → cleaner
    → sink_postgres(tracking_events_clean)   [per-event, idempotent]
    → aggregator(tumbling 1-min window)
       └→ flush every FLUSH_INTERVAL_SEC
          → sink_postgres(KPI tables)
          → insight_generator → Qdrant (RAG insights)
"""
from __future__ import annotations

import logging
import os
import signal
import socket
import sys
import time

from kafka import KafkaConsumer
from kafka.errors import NoBrokersAvailable

from lib import aggregator as agg_mod
from lib import cleaner, insight_generator, parser, validator
from lib.aggregator import WindowAggregator
from lib.sink_postgres import PostgresSink

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("streaming-processor")

# ── Config ─────────────────────────────────────────────────────────────────
KAFKA_BOOTSTRAP = os.environ.get("KAFKA_BOOTSTRAP_SERVERS", "kafka:9092")
KAFKA_TOPIC = os.environ.get("KAFKA_TOPIC_RAW", "tracking_events_raw")
KAFKA_GROUP = os.environ.get("KAFKA_GROUP_ID", "streaming-processor")
FLUSH_INTERVAL = int(os.environ.get("FLUSH_INTERVAL_SEC", "30"))

POSTGRES_DSN = (
    f"host={os.environ.get('POSTGRES_HOST', 'postgres')} "
    f"port={os.environ.get('POSTGRES_PORT', '5432')} "
    f"dbname={os.environ.get('POSTGRES_DB', 'realtime')} "
    f"user={os.environ.get('POSTGRES_USER', 'app')} "
    f"password={os.environ.get('POSTGRES_PASSWORD', 'app')}"
)


# ── Dependency wait ─────────────────────────────────────────────────────────
def _wait_tcp(host: str, port: int, label: str) -> None:
    logger.info("waiting for %s (%s:%d)…", label, host, port)
    while True:
        try:
            with socket.create_connection((host, port), timeout=3):
                logger.info("%s ready", label)
                return
        except OSError:
            time.sleep(3)


def wait_for_dependencies() -> None:
    kafka_host, _, kafka_port = KAFKA_BOOTSTRAP.partition(":")
    pg_host = os.environ.get("POSTGRES_HOST", "postgres")
    pg_port = int(os.environ.get("POSTGRES_PORT", "5432"))
    _wait_tcp(kafka_host, int(kafka_port or 9092), "Kafka")
    _wait_tcp(pg_host, pg_port, "PostgreSQL")
    qdrant_url = os.environ.get("QDRANT_URL", "").strip()
    if qdrant_url:
        from urllib.parse import urlparse

        parsed = urlparse(qdrant_url)
        q_host = parsed.hostname or "qdrant"
        q_port = parsed.port or 6333
        _wait_tcp(q_host, q_port, "Qdrant")


# ── Pipeline ────────────────────────────────────────────────────────────────
def build_consumer() -> KafkaConsumer:
    while True:
        try:
            consumer = KafkaConsumer(
                KAFKA_TOPIC,
                bootstrap_servers=KAFKA_BOOTSTRAP.split(","),
                group_id=KAFKA_GROUP,
                auto_offset_reset="earliest",
                enable_auto_commit=True,
                consumer_timeout_ms=1000,  # yields control for periodic flush
            )
            logger.info("kafka consumer connected — topic=%s group=%s", KAFKA_TOPIC, KAFKA_GROUP)
            return consumer
        except NoBrokersAvailable:
            logger.warning("no kafka brokers — retrying in 5s")
            time.sleep(5)


def run_pipeline(consumer: KafkaConsumer, sink: PostgresSink, window: WindowAggregator) -> None:
    last_flush = time.monotonic()
    processed = 0
    skipped = 0

    while _running:
        for msg in consumer:
            if not _running:
                break

            raw = parser.parse(msg.value)
            if raw is None:
                skipped += 1
                continue

            if not validator.validate(raw):
                skipped += 1
                continue

            event = cleaner.clean(raw)

            try:
                sink.write_event(event)
            except Exception:
                skipped += 1
                continue

            window.add(event)
            processed += 1

        # Periodic flush (runs even when consumer_timeout_ms fires with no msgs)
        if time.monotonic() - last_flush >= FLUSH_INTERVAL:
            kpi_records = window.flush_completed()
            if kpi_records:
                try:
                    sink.write_kpi_batch(kpi_records)
                    insight_generator.generate(kpi_records)
                except Exception as exc:
                    logger.error("kpi flush error: %s", exc)
            logger.info("status — processed=%d skipped=%d", processed, skipped)
            last_flush = time.monotonic()


# ── Signal handling ─────────────────────────────────────────────────────────
_running = True


def _handle_signal(signum, _frame) -> None:
    global _running
    logger.info("received signal %d — shutting down", signum)
    _running = False


signal.signal(signal.SIGINT, _handle_signal)
signal.signal(signal.SIGTERM, _handle_signal)


# ── Entry point ─────────────────────────────────────────────────────────────
def main() -> None:
    logger.info("streaming processor starting")
    wait_for_dependencies()

    sink = PostgresSink(POSTGRES_DSN)
    window = WindowAggregator()
    consumer = build_consumer()

    try:
        run_pipeline(consumer, sink, window)
    finally:
        logger.info("flushing remaining KPI windows…")
        kpi_records = window.flush_completed()
        if kpi_records:
            try:
                sink.write_kpi_batch(kpi_records)
            except Exception as exc:
                logger.error("final flush error: %s", exc)
        consumer.close()
        sink.close()
        logger.info("streaming processor stopped")


if __name__ == "__main__":
    main()
