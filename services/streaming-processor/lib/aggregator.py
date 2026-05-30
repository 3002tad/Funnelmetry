"""
Tumbling-window aggregator (1-minute buckets).

Accumulates events in memory. flush_completed() finalizes closed minutes;
flush_current_snapshot() UPSERTs the open minute without clearing state.
"""
from __future__ import annotations

import logging
from collections import defaultdict
from datetime import datetime, timedelta, timezone

logger = logging.getLogger(__name__)

_BEHAVIOR_TYPES = {
    "page_view", "product_view", "product_click", "scroll_depth",
    "search", "filter_apply", "banner_impression", "banner_click",
}
_COMMERCE_TYPES = {
    "add_to_cart", "remove_from_cart", "checkout_start", "purchase_succeeded",
    "payment_failed", "cart_abandoned",
}


def _floor_minute(dt: datetime) -> datetime:
    return dt.replace(second=0, microsecond=0)


def _revenue_from_metadata(metadata: dict) -> float:
    """Order revenue: amount, total_amount, or sum of line items (web-shop worker)."""
    if not metadata:
        return 0.0
    for key in ("amount", "total_amount", "price"):
        val = metadata.get(key)
        if val is not None:
            return float(val)
    items = metadata.get("items") or []
    total = 0.0
    for item in items:
        if not isinstance(item, dict):
            continue
        line = item.get("amount")
        if line is None:
            price = float(item.get("price") or 0)
            qty = float(item.get("quantity") or 1)
            line = price * qty
        total += float(line)
    return total


def _line_items(metadata: dict) -> list[dict]:
    items = metadata.get("items") or []
    return [i for i in items if isinstance(i, dict) and i.get("product_id")]


def _banner_id_from_event(event: dict, metadata: dict) -> str:
    """banner_id in metadata; web-shop may send name / banner_name only."""
    for key in ("banner_id", "bannerId", "banner_name", "name"):
        val = metadata.get(key) or event.get(key)
        if val is not None and str(val).strip():
            return str(val).strip()
    return ""


class WindowAggregator:
    """Aggregate events into 1-minute tumbling windows."""

    def __init__(self) -> None:
        # key: window_start → kpi counters
        self._tracking: dict[datetime, dict] = defaultdict(_empty_tracking_kpi)
        # key: (window_start, product_id) → counters
        self._product: dict[tuple, dict] = defaultdict(_empty_product_kpi)
        # key: (window_start, banner_id) → counters
        self._banner: dict[tuple, dict] = defaultdict(_empty_banner_kpi)
        # key: (window_start, product_id) → revenue counters
        self._product_revenue: dict[tuple, dict] = defaultdict(_empty_product_revenue_kpi)
        # track session ids per window for unique_sessions
        self._sessions: dict[datetime, set] = defaultdict(set)

    def add(self, event: dict) -> None:
        event_time: datetime = event["event_time"]
        if event_time.tzinfo is None:
            event_time = event_time.replace(tzinfo=timezone.utc)

        ws = _floor_minute(event_time)
        etype = event.get("event_type", "")
        product_id = event.get("product_id") or ""
        session_id = event.get("session_id", "")
        metadata = event.get("metadata") or {}

        # --- tracking_kpi_1m ---
        tk = self._tracking[ws]
        tk["total_events"] += 1
        self._sessions[ws].add(session_id)

        if etype == "page_view":
            tk["page_views"] += 1
        elif etype == "product_view":
            tk["product_views"] += 1
        elif etype in ("product_click", "banner_click"):
            tk["clicks"] += 1
        elif etype == "search":
            tk["searches"] += 1
        elif etype == "add_to_cart":
            tk["add_to_cart"] += 1
        elif etype == "remove_from_cart":
            tk["remove_from_cart"] += 1
        elif etype == "checkout_start":
            tk["checkout_start"] += 1
        elif etype == "purchase_succeeded":
            tk["purchases"] += 1
            tk["revenue"] += _revenue_from_metadata(metadata)

        # --- product_kpi_1m ---
        if product_id and etype in ("product_view", "add_to_cart", "remove_from_cart", "purchase_succeeded"):
            pk = self._product[(ws, product_id)]
            if etype == "product_view":
                pk["product_views"] += 1
            elif etype == "add_to_cart":
                pk["add_to_cart"] += 1
            elif etype == "remove_from_cart":
                pk["remove_from_cart"] += 1
            elif etype == "purchase_succeeded":
                pk["purchases"] += 1

        # --- banner_kpi_1m ---
        banner_id = _banner_id_from_event(event, metadata)
        if banner_id and etype in ("banner_impression", "banner_click"):
            bk = self._banner[(ws, banner_id)]
            if etype == "banner_impression":
                bk["impressions"] += 1
            elif etype == "banner_click":
                bk["clicks"] += 1
            bk["target_product_id"] = metadata.get("target_product_id") or bk.get("target_product_id") or ""

        # --- product_revenue_kpi_1m ---
        if etype == "purchase_succeeded":
            line_items = _line_items(metadata)
            if line_items:
                for item in line_items:
                    pid = item["product_id"]
                    prk = self._product_revenue[(ws, pid)]
                    prk["purchases"] += 1
                    amt = item.get("amount")
                    if amt is None:
                        amt = float(item.get("price") or 0) * float(item.get("quantity") or 1)
                    prk["revenue"] += float(amt)
            elif product_id:
                prk = self._product_revenue[(ws, product_id)]
                prk["purchases"] += 1
                prk["revenue"] += _revenue_from_metadata(metadata)
        elif product_id:
            prk = self._product_revenue[(ws, product_id)]
            if etype == "product_view":
                prk["views"] += 1
            elif etype in ("product_click", "banner_click"):
                prk["clicks"] += 1
            elif etype == "add_to_cart":
                prk["add_to_cart"] += 1
            elif etype == "remove_from_cart":
                prk["remove_from_cart"] += 1
            elif etype == "checkout_start":
                prk["checkout_start"] += 1

    def flush_current_snapshot(self) -> list[dict]:
        """UPSERT KPI for the in-progress minute (dashboard sees revenue within flush interval)."""
        cutoff = _floor_minute(datetime.now(timezone.utc))
        records: list[dict] = []

        if cutoff in self._tracking:
            records.append(_tracking_kpi_record(
                cutoff,
                self._tracking[cutoff],
                self._sessions.get(cutoff, set()),
            ))

        for (ws, pid), pk in self._product.items():
            if ws == cutoff:
                records.append(_product_kpi_record(ws, pid, pk))

        for (ws, bid), bk in self._banner.items():
            if ws == cutoff:
                records.append(_banner_kpi_record(ws, bid, bk))

        for (ws, pid), prk in self._product_revenue.items():
            if ws == cutoff:
                records.append(_product_revenue_kpi_record(ws, pid, prk))

        return records

    def flush_completed(self) -> list[dict]:
        """Return KPI records for windows that have closed, then remove them."""
        cutoff = _floor_minute(datetime.now(timezone.utc))
        records: list[dict] = []

        completed_ws = [ws for ws in self._tracking if ws < cutoff]
        for ws in completed_ws:
            tk = self._tracking.pop(ws)
            sessions = self._sessions.pop(ws, set())
            we = ws + timedelta(minutes=1)
            records.append(_tracking_kpi_record(ws, tk, sessions))
            logger.info("flushing tracking_kpi window %s → %s (%d events)", ws, we, tk["total_events"])

        for (ws, pid), pk in list(self._product.items()):
            if ws < cutoff:
                del self._product[(ws, pid)]
                records.append(_product_kpi_record(ws, pid, pk))

        for (ws, bid), bk in list(self._banner.items()):
            if ws < cutoff:
                del self._banner[(ws, bid)]
                records.append(_banner_kpi_record(ws, bid, bk))

        for (ws, pid), prk in list(self._product_revenue.items()):
            if ws < cutoff:
                del self._product_revenue[(ws, pid)]
                records.append(_product_revenue_kpi_record(ws, pid, prk))

        return records


def _tracking_kpi_record(ws: datetime, tk: dict, sessions: set) -> dict:
    we = ws + timedelta(minutes=1)
    unique_sessions = len(sessions)
    purchases = tk["purchases"]
    denom = unique_sessions or 1
    return {
        "type": "tracking_kpi",
        "window_start": ws,
        "window_end": we,
        **tk,
        "unique_sessions": unique_sessions,
        "conversion_rate": round(purchases / denom, 4),
    }


def _product_kpi_record(ws: datetime, pid: str, pk: dict) -> dict:
    views = pk["product_views"] or 1
    add_cart = pk["add_to_cart"]
    purchases = pk["purchases"]
    return {
        "type": "product_kpi",
        "window_start": ws,
        "product_id": pid,
        **pk,
        "add_to_cart_rate": round(add_cart / views, 4),
        "purchase_rate": round(purchases / views, 4),
    }


def _banner_kpi_record(ws: datetime, bid: str, bk: dict) -> dict:
    we = ws + timedelta(minutes=1)
    impressions = bk["impressions"] or 1
    return {
        "type": "banner_kpi",
        "window_start": ws,
        "window_end": we,
        "banner_id": bid,
        "impressions": bk["impressions"],
        "clicks": bk["clicks"],
        "ctr": round(bk["clicks"] / impressions, 4),
        "target_product_id": bk.get("target_product_id") or None,
    }


def _product_revenue_kpi_record(ws: datetime, pid: str, prk: dict) -> dict:
    we = ws + timedelta(minutes=1)
    views = prk["views"] or 1
    return {
        "type": "product_revenue_kpi",
        "window_start": ws,
        "window_end": we,
        "product_id": pid,
        **prk,
        "view_to_cart_rate": round(prk["add_to_cart"] / views, 4),
        "purchase_rate": round(prk["purchases"] / views, 4),
    }


def _empty_tracking_kpi() -> dict:
    return {
        "total_events": 0, "page_views": 0, "product_views": 0,
        "clicks": 0, "searches": 0, "add_to_cart": 0, "remove_from_cart": 0,
        "checkout_start": 0, "purchases": 0, "revenue": 0.0,
    }


def _empty_product_kpi() -> dict:
    return {"product_views": 0, "add_to_cart": 0, "remove_from_cart": 0, "purchases": 0}


def _empty_banner_kpi() -> dict:
    return {"impressions": 0, "clicks": 0, "target_product_id": ""}


def _empty_product_revenue_kpi() -> dict:
    return {
        "views": 0, "clicks": 0, "add_to_cart": 0, "remove_from_cart": 0,
        "checkout_start": 0, "purchases": 0, "revenue": 0.0,
    }
