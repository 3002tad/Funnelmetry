#!/usr/bin/env python3
"""
Commerce Connector — Phase 5.

Consumes commerce events from RabbitMQ (exchange: commerce_events)
and forwards them to Tracking API POST /track.

Events are already in the unified tracking schema (emitted by commerce-backend),
so no transformation is needed — just forward as-is.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import signal

import aio_pika
import httpx

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("commerce-connector")

RABBITMQ_URL = os.environ.get("RABBITMQ_URL", "amqp://app:app@rabbitmq:5672")
EXCHANGE_NAME = os.environ.get("RABBITMQ_EXCHANGE", "commerce_events")
QUEUE_NAME = os.environ.get("RABBITMQ_QUEUE", "commerce_connector_queue")
TRACKING_URL = os.environ.get("TRACKING_API_URL", "http://tracking-api:3000")

_running = True


def _handle_signal(signum, _frame) -> None:
    global _running
    logger.info("signal %d — shutting down", signum)
    _running = False


signal.signal(signal.SIGINT, _handle_signal)
signal.signal(signal.SIGTERM, _handle_signal)


async def forward_to_tracking(event: dict, client: httpx.AsyncClient) -> bool:
    """POST event to Tracking API. Returns True on success."""
    try:
        res = await client.post(
            f"{TRACKING_URL}/track",
            json=event,
            timeout=5.0,
        )
        if res.status_code == 202:
            logger.info(
                "forwarded event_id=%s type=%s",
                event.get("event_id"), event.get("event_type"),
            )
            return True
        logger.warning(
            "tracking api returned %d for event_id=%s",
            res.status_code, event.get("event_id"),
        )
        return False
    except Exception as exc:
        logger.error("forward failed event_id=%s: %s", event.get("event_id"), exc)
        return False


async def process_message(
    message: aio_pika.IncomingMessage,
    client: httpx.AsyncClient,
) -> None:
    async with message.process(requeue=True):
        try:
            event = json.loads(message.body.decode("utf-8"))
        except Exception as exc:
            logger.warning("invalid message body: %s", exc)
            return

        ok = await forward_to_tracking(event, client)
        if not ok:
            # nack → requeue for retry
            await message.nack(requeue=True)


async def connect_rabbitmq() -> aio_pika.RobustConnection:
    logger.info("connecting to RabbitMQ…")
    while True:
        try:
            conn = await aio_pika.connect_robust(RABBITMQ_URL)
            logger.info("RabbitMQ connected")
            return conn
        except Exception as exc:
            logger.warning("RabbitMQ not ready (%s) — retry in 5s", exc)
            await asyncio.sleep(5)


async def main() -> None:
    logger.info("commerce connector starting")

    async with httpx.AsyncClient() as http_client:
        conn = await connect_rabbitmq()
        async with conn:
            channel = await conn.channel()
            await channel.set_qos(prefetch_count=10)

            exchange = await channel.declare_exchange(
                EXCHANGE_NAME, aio_pika.ExchangeType.FANOUT, durable=True
            )
            queue = await channel.declare_queue(QUEUE_NAME, durable=True)
            await queue.bind(exchange)

            logger.info(
                "consuming queue=%s exchange=%s tracking=%s",
                QUEUE_NAME, EXCHANGE_NAME, TRACKING_URL,
            )

            async with queue.iterator() as q:
                async for message in q:
                    if not _running:
                        break
                    await process_message(message, http_client)

    logger.info("commerce connector stopped")


if __name__ == "__main__":
    asyncio.run(main())
