"""
Map Integration Guide business events → tracking-api schema (Kafka pipeline).
Revenue KPI uses purchase_succeeded from order.completed only (Guide §17).
"""

_SKIP_TYPES = frozenset({
    "order.created",
    "inventory.reserved",
    "inventory.reserve_failed",
    "order.processing",
    "payment.succeeded",
    "payment.started",
})


def business_to_tracking(raw: dict) -> dict | None:
    event_type = raw.get("event_type") or ""
    if event_type in _SKIP_TYPES:
        return None

    if event_type == "order.completed":
        tracking_type = "purchase_succeeded"
    elif event_type == "payment.failed":
        tracking_type = "payment_failed"
    else:
        return None

    meta = dict(raw.get("metadata") or {})
    if raw.get("order_id"):
        meta["order_id"] = raw["order_id"]

    items = meta.get("items") or []
    product_id = None
    if items and isinstance(items[0], dict):
        product_id = items[0].get("product_id")

    occurred = raw.get("occurred_at") or raw.get("timestamp")
    source = raw.get("event_source") or "web_demo_worker"
    event_source = "commerce_backend_rabbitmq"

    return {
        "event_id": raw.get("event_id"),
        "event_type": tracking_type,
        "event_source": event_source,
        "event_category": "commerce",
        "anonymous_id": raw.get("anonymous_id"),
        "session_id": raw.get("session_id"),
        "user_id": raw.get("user_id"),
        "product_id": product_id,
        "timestamp": occurred,
        "metadata": {
            **meta,
            "business_event_type": event_type,
            "business_event_source": source,
        },
    }
