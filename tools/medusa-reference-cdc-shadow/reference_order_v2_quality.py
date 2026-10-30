"""Pure, fail-closed checks for a reference order-state v2 CDC quality lease.

The runtime probe supplies independently sampled source, mapper, sink, Kafka and
Connect evidence. This module deliberately has no database write capability.
"""

import hashlib
import json


TABLES = ("order", "order_cart", "cart")


def _states(rows):
    if not isinstance(rows, list):
        return None
    result = {}
    for row in rows:
        if not isinstance(row, dict) or not isinstance(row.get("order_id"), str):
            return None
        order_id = row["order_id"]
        if order_id in result or not isinstance(row.get("active"), bool):
            return None
        # An inactive order has no active journey edge even if a stale link is
        # retained in a source or projection row.
        result[order_id] = (row["active"], row.get("cart_id") if row["active"] else None)
    return result


def _digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def evaluate(sample, *, prefix, fact_topic, minimum_safe_wal_bytes):
    """Return checks and a status; missing/malformed evidence always blocks."""
    source = sample.get("source") or {}
    mapper = sample.get("mapper") or {}
    sink = sample.get("sink") or {}
    ends = sample.get("topic_ends") or {}
    epoch = mapper.get("epoch") or {}
    quality = sink.get("quality") or {}
    source_states = _states(source.get("states"))
    mapper_states = _states(mapper.get("states"))
    sink_states = _states(sink.get("states"))
    raw_topics = {f"{prefix}.public.{table}" for table in TABLES} | {f"{prefix}.transaction"}
    mapper_offsets = mapper.get("offsets") or {}
    sink_offset = sink.get("offset")
    safe_wal = source.get("slot_safe_wal_size")
    try:
        safe_wal = int(safe_wal) if safe_wal is not None else None
        # An initial snapshot may have no transaction END records. Kafka's
        # transaction topic then ends at zero while the mapper has no offset
        # row for it yet. Treat only that exact empty prefix as caught up.
        offsets_match = (set(mapper_offsets).issubset(raw_topics) and
                         all(type(ends.get(topic)) is int and
                             ((topic in mapper_offsets and
                               type(mapper_offsets[topic]) is int and
                               mapper_offsets[topic] == ends[topic]) or
                              (topic not in mapper_offsets and ends[topic] == 0))
                             for topic in raw_topics) and
                         type(sink_offset) is int and
                         type(ends.get(fact_topic)) is int and
                         sink_offset == ends[fact_topic] and
                         set(ends) == raw_topics | {fact_topic})
    except (TypeError, ValueError):
        offsets_match = False
    outbox = mapper.get("outbox_counts") or {}
    inbox = sink.get("inbox_counts") or {}
    # A hard-deleted source order has no row to compare. Its previously
    # observed mapper tombstone must remain inactive for audit/retraction.
    source_matches_mapper = (source_states is not None and mapper_states is not None and
        all(mapper_states.get(order_id) == state for order_id, state in source_states.items()) and
        all(order_id in source_states or not state[0]
            for order_id, state in mapper_states.items()))
    checks = {
        "unambiguous_source": source.get("ambiguous_orders") == 0,
        "usable_slot": source.get("slot_status") in ("reserved", "extended"),
        "finite_wal_headroom": safe_wal is not None and safe_wal >= minimum_safe_wal_bytes,
        "connector_running": sample.get("connector_running") is True,
        "baseline_verified": (epoch.get("status") == "BASELINE_VERIFIED" and
                              epoch.get("snapshot_last_seen") is True and
                              quality.get("baseline_complete") is True and
                              epoch.get("baseline_digest") is not None and
                              epoch.get("baseline_digest") == quality.get("baseline_digest") and
                              epoch.get("baseline_active_count") ==
                              quality.get("baseline_active_orders") and
                              outbox.get("BASELINE") == quality.get("baseline_orders") ==
                              quality.get("baseline_active_orders") and
                              outbox.get("BASELINE_COMPLETE") == 1),
        "gap_disclosed": (epoch.get("previous_epoch_gap") == "INCOMPLETE" and
                          quality.get("historical_gap_status") == "INCOMPLETE"),
        "ordered_prefix_complete": mapper.get("pending_ends") == 0 and
                                   mapper.get("unpublished") == 0,
        "offsets_caught_up": offsets_match,
        "outbox_inbox_equal": (outbox == inbox and
                               sum(outbox.values()) == sink_offset
                               if all(type(n) is int and n >= 0 for n in outbox.values()) and
                               type(sink_offset) is int else False),
        "source_mapper_equal": source_matches_mapper,
        "mapper_sink_equal": mapper_states is not None and mapper_states == sink_states,
    }
    return {
        "status": "PASS" if all(checks.values()) else "BLOCKED_BY_QUALITY",
        "checks": checks,
        "source_count": len(source_states) if source_states is not None else None,
        "sink_count": len(sink_states) if sink_states is not None else None,
        "source_digest": _digest(source_states) if source_states is not None else None,
        "mapper_digest": _digest(mapper_states) if mapper_states is not None else None,
        "sink_digest": _digest(sink_states) if sink_states is not None else None,
        "fact_offset": sink_offset,
        "slot_safe_wal_size": safe_wal,
    }
