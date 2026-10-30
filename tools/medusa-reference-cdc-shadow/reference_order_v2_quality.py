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


def evaluate_moving(sample, *, prefix, fact_topic, minimum_safe_wal_bytes,
                    max_pending_orders, max_raw_offset_lag,
                    max_pending_seconds, pending_first_seen, now_seconds):
    """Candidate bounded-lag decision for a source sample taken LAST.

    The mapper/sink may be behind the source only for newly inserted order IDs.
    Changes to an already observed order, bad lineage, a lost slot, or a stale
    pending ID fail closed. Caller must persist pending_first_seen across restarts
    before this decision may publish a live quality lease.
    """
    if (not isinstance(max_pending_orders, int) or max_pending_orders < 0 or
            not isinstance(max_raw_offset_lag, int) or max_raw_offset_lag < 0 or
            not isinstance(max_pending_seconds, (int, float)) or max_pending_seconds <= 0 or
            not isinstance(now_seconds, (int, float)) or
            not isinstance(pending_first_seen, dict)):
        raise ValueError("moving order quality policy is invalid")
    result = evaluate(sample, prefix=prefix, fact_topic=fact_topic,
                      minimum_safe_wal_bytes=minimum_safe_wal_bytes)
    source = _states((sample.get("source") or {}).get("states"))
    mapper = _states((sample.get("mapper") or {}).get("states"))
    sink = _states((sample.get("sink") or {}).get("states"))
    raw_topics = {f"{prefix}.public.{table}" for table in TABLES} | {
        f"{prefix}.transaction"}
    ends = sample.get("topic_ends") or {}
    mapper_offsets = (sample.get("mapper") or {}).get("offsets") or {}
    sink_offset = (sample.get("sink") or {}).get("offset")
    pending = set()
    comparable = source is not None and mapper is not None and sink is not None
    existing_equal = comparable
    if comparable:
        for order_id, source_state in source.items():
            mapper_state = mapper.get(order_id)
            sink_state = sink.get(order_id)
            if mapper_state is None or sink_state is None:
                pending.add(order_id)
            elif mapper_state != source_state or sink_state != source_state:
                existing_equal = False
        # A later source sample cannot omit an active projected order unless
        # that source order was deleted or its lineage has diverged.
        for order_id, state in mapper.items():
            if order_id not in source and state[0]:
                existing_equal = False
        for order_id, state in sink.items():
            if order_id not in source and state[0]:
                existing_equal = False
        for order_id in set(mapper) & set(sink):
            if mapper[order_id] != sink[order_id]:
                existing_equal = False
        if any(order_id not in mapper for order_id in sink):
            existing_equal = False
    next_pending = {}
    pending_fresh = comparable
    for order_id in pending:
        first = pending_first_seen.get(order_id, now_seconds)
        if not isinstance(first, (int, float)) or first > now_seconds or \
                now_seconds - first > max_pending_seconds:
            pending_fresh = False
        else:
            next_pending[order_id] = first
    pending_fresh = pending_fresh and len(pending) <= max_pending_orders
    offsets_bounded = (set(ends) == raw_topics | {fact_topic} and
                       set(mapper_offsets).issubset(raw_topics) and
                       type(sink_offset) is int)
    raw_backlog = {}
    if offsets_bounded:
        for topic in raw_topics:
            end, applied = ends.get(topic), mapper_offsets.get(topic, 0)
            if type(end) is not int or type(applied) is not int or \
                    not 0 <= end - applied <= max_raw_offset_lag:
                offsets_bounded = False
                break
            raw_backlog[topic] = end - applied
        fact_end = ends.get(fact_topic)
        offsets_bounded = offsets_bounded and type(fact_end) is int and \
            0 <= fact_end - sink_offset <= 2 * max_pending_orders
    mapper_status = sample.get("mapper") or {}
    outbox = mapper_status.get("outbox_counts") or {}
    inbox = (sample.get("sink") or {}).get("inbox_counts") or {}
    record_prefix_valid = (all(type(value) is int and value >= 0 for value in
                               list(outbox.values()) + list(inbox.values())) and
                           all(outbox.get(kind, -1) >= count for kind, count in
                               inbox.items()) and
                           type(sink_offset) is int and sum(inbox.values()) == sink_offset and
                           0 <= sum(outbox.values()) - sum(inbox.values()) <=
                           2 * max_pending_orders and
                           type(mapper_status.get("pending_ends")) is int and
                           type(mapper_status.get("unpublished")) is int and
                           0 <= mapper_status["pending_ends"] <= max_pending_orders and
                           0 <= mapper_status["unpublished"] <= 2 * max_pending_orders)
    checks = dict(result["checks"])
    for strict_key in ("source_mapper_equal", "mapper_sink_equal",
                       "ordered_prefix_complete", "offsets_caught_up",
                       "outbox_inbox_equal"):
        checks.pop(strict_key)
    checks.update({"state_prefix_consistent": existing_equal,
                   "ordered_prefix_bounded": record_prefix_valid,
                   "offset_backlog_bounded": offsets_bounded,
                   "pending_fresh": pending_fresh})
    result.update({"status": "PASS_BOUNDED_LAG" if all(checks.values()) else
                   "BLOCKED_BY_QUALITY", "checks": checks,
                   "pending_order_count": len(pending),
                   "pending_first_seen": next_pending,
                   "raw_offset_backlog": raw_backlog})
    return result
