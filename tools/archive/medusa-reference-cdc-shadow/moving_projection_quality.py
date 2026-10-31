"""Candidate bounded-freshness check for catalog and inventory/price CDC rows.

This module is deliberately independent of the authoritative quality lease.
It accepts source rows sampled after projection rows, and permits a bounded
number of in-flight row changes. Callers must persist ``first_seen`` across
process restarts before using the decision for any readable binding.
"""

import json
import math


def _key(table, row):
    key = row.get("key")
    if not isinstance(table, str) or not table or not isinstance(key, (str, list)):
        raise ValueError("invalid CDC row key")
    return json.dumps([table, key], sort_keys=True, separators=(",", ":"))


def _index(rows):
    if not isinstance(rows, dict):
        raise ValueError("CDC row sample is not a table mapping")
    indexed = {}
    for table, table_rows in rows.items():
        if not isinstance(table_rows, list):
            raise ValueError("CDC table sample is not a row list")
        for row in table_rows:
            if not isinstance(row, dict):
                raise ValueError("invalid CDC row")
            identifier = _key(table, row)
            if identifier in indexed:
                raise ValueError("duplicate CDC row key")
            indexed[identifier] = row.get("value")
    return indexed


def evaluate(source_rows, projection_rows, *, expected_topics, topic_ends, applied_offsets,
             connector_running, snapshot_complete, slot_status, safe_wal_bytes,
             minimum_safe_wal_bytes, max_pending_rows, max_offset_lag,
             max_pending_seconds, first_seen, now_seconds):
    """Return a candidate decision and the first-observation map to persist.

    Row values must already be canonicalized by the stream-specific verifier.
    Every row mismatch (insert/update/delete) is pending; an unchanged row is
    exact. Missing/foreign offset topics, invalid counts or stale pending rows
    block the stream. Thresholds are supplied by the caller, never hard-coded
    as an architecture decision.
    """
    if (type(max_pending_rows) is not int or max_pending_rows < 0 or
            type(max_offset_lag) is not int or max_offset_lag < 0 or
            not isinstance(max_pending_seconds, (int, float)) or
            not math.isfinite(max_pending_seconds) or max_pending_seconds <= 0 or
            not isinstance(now_seconds, (int, float)) or
            not math.isfinite(now_seconds) or not isinstance(first_seen, dict) or
            type(minimum_safe_wal_bytes) is not int or minimum_safe_wal_bytes < 0):
        raise ValueError("invalid moving projection quality policy")
    source = _index(source_rows)
    projection = _index(projection_rows)
    if set(source_rows) != set(projection_rows):
        raise ValueError("CDC projection table allowlist differs from source")
    mismatches = sorted(key for key in source.keys() | projection.keys()
                        if source.get(key, _MISSING) != projection.get(key, _MISSING))
    pending = {}
    pending_fresh = len(mismatches) <= max_pending_rows
    for key in mismatches:
        first = first_seen.get(key, now_seconds)
        if (not isinstance(first, (int, float)) or not math.isfinite(first) or
                first > now_seconds):
            pending_fresh = False
        else:
            pending[key] = first
            if now_seconds - first > max_pending_seconds:
                pending_fresh = False
    offset_lag = {}
    offsets_bounded = (isinstance(expected_topics, set) and
                       bool(expected_topics) and
                       all(isinstance(topic, str) and topic for topic in expected_topics) and
                       isinstance(topic_ends, dict) and
                       isinstance(applied_offsets, dict) and
                       set(topic_ends) == set(applied_offsets) == expected_topics)
    if offsets_bounded:
        for topic, end in topic_ends.items():
            applied = applied_offsets[topic]
            if (not isinstance(topic, str) or type(end) is not int or
                    type(applied) is not int or not 0 <= end - applied <= max_offset_lag):
                offsets_bounded = False
                break
            offset_lag[topic] = end - applied
    checks = {
        "connector_running": connector_running is True,
        "snapshot_complete": snapshot_complete is True,
        "slot_usable": slot_status in ("reserved", "extended"),
        "wal_headroom": type(safe_wal_bytes) is int and
        safe_wal_bytes >= minimum_safe_wal_bytes,
        "offset_backlog_bounded": offsets_bounded,
        "pending_rows_fresh": pending_fresh,
    }
    return {"status": "PASS_BOUNDED_LAG" if all(checks.values()) else
            "BLOCKED_BY_QUALITY", "checks": checks,
            "pending_row_count": len(mismatches), "pending_first_seen": pending,
            "offset_backlog": offset_lag}


_MISSING = object()
