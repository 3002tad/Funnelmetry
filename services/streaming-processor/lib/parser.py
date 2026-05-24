"""Parse raw Kafka message bytes → event dict."""
from __future__ import annotations

import json
import logging

logger = logging.getLogger(__name__)


def parse(raw_bytes: bytes) -> dict | None:
    """Return parsed dict or None if the message is not valid JSON."""
    try:
        return json.loads(raw_bytes.decode("utf-8"))
    except Exception as exc:
        logger.warning("parse failed: %s | raw=%r", exc, raw_bytes[:200])
        return None
