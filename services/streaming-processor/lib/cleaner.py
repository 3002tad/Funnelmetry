"""Normalize and coerce event fields into clean types."""
from __future__ import annotations

import logging
from datetime import datetime, timezone

from dateutil import parser as dateutil_parser

logger = logging.getLogger(__name__)


def _parse_timestamp(value: str | None) -> datetime:
    if not value:
        return datetime.now(timezone.utc)
    try:
        dt = dateutil_parser.parse(value)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except Exception:
        return datetime.now(timezone.utc)


def clean(raw: dict) -> dict:
    """Return a new dict with normalized fields ready for Postgres insertion."""
    event = dict(raw)

    event["event_time"] = _parse_timestamp(event.get("timestamp"))

    # Normalize string fields: strip whitespace, coerce None → None
    for field in ("event_id", "event_source", "event_category", "event_type",
                  "anonymous_id", "session_id", "user_id", "page_url", "product_id"):
        val = event.get(field)
        event[field] = val.strip() if isinstance(val, str) else val

    if not isinstance(event.get("metadata"), dict):
        event["metadata"] = {}

    return event
