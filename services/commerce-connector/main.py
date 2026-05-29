#!/usr/bin/env python3
"""
Tracking business event consumer — Integration Guide §9.

Consumes tracking.business-events (topic bindings), maps to tracking schema,
forwards to tracking-api POST /track. Separate queue from web-demo-worker.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import signal
from collections import OrderedDict

import aio_pika
import httpx

from lib.map_event import business_to_tracking
from lib.topology import TRACKING_QUEUE, assert_tracking_topology

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("tracking-business-consumer")

RABBITMQ_URL = os.environ.get("RABBITMQ_URL", "").strip()
TRACKING_URL = os.environ.get("TRACKING_API_URL", "http://tracking-api:3000").strip()
DEDUP_MAX = int(os.environ.get("EVENT_DEDUP_CACHE_SIZE", "5000"))

_running = True
_seen_ids: OrderedDict[str, bool] = OrderedDict()


def _require_env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


def _handle_signal(signum, _frame) -> None:
    global _running
    logger.info("signal %d — shutting down", signum)
    _running = False


signal.signal(signal.SIGINT, _handle_signal)
signal.signal(signal.SIGTERM, _handle_signal)


def _dedup_seen(event_id: str) -> bool:
    if not event_id:
        return False
    if event_id in _seen_ids:
        return True
    _seen_ids[event_id] = True
    while len(_seen_ids) > DEDUP_MAX:
        _seen_ids.popitem(last=False)
    return False


def _validate_business_event(event: dict) -> None:
    required = ("event_id", "event_type", "event_source", "occurred_at", "session_id", "order_id")
    for field in required:
        if event.get(field) in (None, ""):
            raise ValueError(f"Missing required field: {field}")


async def forward_to_tracking(event: dict, client: httpx.AsyncClient) -> bool:
    mapped = business_to_tracking(event)
    if not mapped:
        logger.debug("skip unmapped event_type=%s", event.get("event_type"))
        return True

    if _dedup_seen(mapped.get("event_id") or ""):
        logger.info("duplicate event_id=%s — ack", mapped.get("event_id"))
        return True

    try:
        res = await client.post(f"{TRACKING_URL}/track", json=mapped, timeout=5.0)
        if res.status_code == 202:
            logger.info(
                "Consumed business event: %s %s -> %s",
                event.get("event_type"),
                event.get("order_id"),
                mapped.get("event_type"),
            )
            return True
        logger.warning("tracking api %d event_id=%s", res.status_code, mapped.get("event_id"))
        return False
    except Exception as exc:
        logger.error("forward failed event_id=%s: %s", mapped.get("event_id"), exc)
        return False


async def connect_rabbitmq() -> aio_pika.RobustConnection:
    url = _require_env("RABBITMQ_URL")
    while True:
        try:
            conn = await aio_pika.connect_robust(url)
            logger.info("RabbitMQ connected")
            return conn
        except Exception as exc:
            logger.warning("RabbitMQ not ready (%s) — retry in 5s", exc)
            await asyncio.sleep(5)


async def main() -> None:
    logger.info("tracking business consumer starting — queue=%s", TRACKING_QUEUE)

    async with httpx.AsyncClient() as http_client:
        conn = await connect_rabbitmq()
        async with conn:
            channel = await conn.channel()
            await channel.set_qos(prefetch_count=10)
            await assert_tracking_topology(channel)

            queue = await channel.get_queue(TRACKING_QUEUE)

            async with queue.iterator() as q:
                async for message in q:
                    if not _running:
                        break
                    async with message.process(requeue=False):
                        try:
                            event = json.loads(message.body.decode("utf-8"))
                            _validate_business_event(event)
                            ok = await forward_to_tracking(event, http_client)
                            if not ok:
                                raise RuntimeError("forward to tracking-api failed")
                        except json.JSONDecodeError as exc:
                            logger.warning("invalid JSON: %s", exc)
                        except ValueError as exc:
                            logger.warning("validation: %s", exc)
                        except Exception as exc:
                            logger.error("process failed: %s", exc)
                            raise

    logger.info("tracking business consumer stopped")


if __name__ == "__main__":
    asyncio.run(main())
