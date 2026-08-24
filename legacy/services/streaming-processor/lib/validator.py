"""Validate required fields on a parsed tracking event."""
from __future__ import annotations

import logging

logger = logging.getLogger(__name__)

_REQUIRED = ("event_type", "anonymous_id", "session_id")


def validate(event: dict) -> bool:
    """Return True if the event has all required fields with non-empty values."""
    for field in _REQUIRED:
        val = event.get(field)
        if not val or not str(val).strip():
            logger.debug("validation failed — missing %s | event_id=%s", field, event.get("event_id"))
            return False
    return True
