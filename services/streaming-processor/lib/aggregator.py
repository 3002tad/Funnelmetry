"""
Tumbling-window aggregator (1-minute buckets).

Accumulates events in memory and returns completed window KPI records when
flush_completed() is called. A window is "completed" when now() > window_end.
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
    "add_to_cart", "checkout_start", "purchase_succeeded",
    "payment_failed", "cart_abandoned",
}


def _floor_minute(dt: datetime) -> datetime:
    return dt.replace(second=0, microsecond=0)


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
        elif etype == "checkout_start":
            tk["checkout_start"] += 1
        elif etype == "purchase_succeeded":
            tk["purchases"] += 1

        # --- product_kpi_1m ---
        if product_id and etype in ("product_view", "add_to_cart", "purchase_succeeded"):
            pk = self._product[(ws, product_id)]
            if etype == "product_view":
                pk["product_views"] += 1
            elif etype == "add_to_cart":
                pk["add_to_cart"] += 1
            elif etype == "purchase_succeeded":
                pk["purchases"] += 1

        # --- banner_kpi_1m ---
        banner_id = metadata.get("banner_id") or ""
        if banner_id and etype in ("banner_impression", "banner_click"):
            bk = self._banner[(ws, banner_id)]
            if etype == "banner_impression":
                bk["impressions"] += 1
            elif etype == "banner_click":
                bk["clicks"] += 1
            bk["target_product_id"] = metadata.get("target_product_id") or bk.get("target_product_id") or ""

        # --- product_revenue_kpi_1m ---
        if product_id:
            prk = self._product_revenue[(ws, product_id)]
            if etype == "product_view":
                prk["views"] += 1
            elif etype in ("product_click", "banner_click"):
                prk["clicks"] += 1
            elif etype == "add_to_cart":
                prk["add_to_cart"] += 1
            elif etype == "checkout_start":
                prk["checkout_start"] += 1
            elif etype == "purchase_succeeded":
                prk["purchases"] += 1
                prk["revenue"] += float(metadata.get("amount") or metadata.get("price") or 0)

    def flush_completed(self) -> list[dict]:
        """Return KPI records for windows that have closed, then remove them."""
        now = datetime.now(timezone.utc)
        cutoff = _floor_minute(now)  # windows strictly before this minute are closed
        records = []

        completed_ws = [ws for ws in self._tracking if ws < cutoff]
        for ws in completed_ws:
            we = ws + timedelta(minutes=1)
            tk = self._tracking.pop(ws)
            sessions = self._sessions.pop(ws, set())
            unique_sessions = len(sessions)
            purchases = tk["purchases"]
            unique_sessions_nonzero = unique_sessions or 1
            conversion_rate = round(purchases / unique_sessions_nonzero, 4)

            records.append({
                "type": "tracking_kpi",
                "window_start": ws,
                "window_end": we,
                **tk,
                "unique_sessions": unique_sessions,
                "conversion_rate": conversion_rate,
            })
            logger.info("flushing tracking_kpi window %s → %s (%d events)", ws, we, tk["total_events"])

        for (ws, pid), pk in list(self._product.items()):
            if ws < cutoff:
                del self._product[(ws, pid)]
                views = pk["product_views"] or 1
                add_cart = pk["add_to_cart"]
                purchases = pk["purchases"]
                records.append({
                    "type": "product_kpi",
                    "window_start": ws,
                    "product_id": pid,
                    **pk,
                    "add_to_cart_rate": round(add_cart / views, 4),
                    "purchase_rate": round(purchases / views, 4),
                })

        for (ws, bid), bk in list(self._banner.items()):
            if ws < cutoff:
                del self._banner[(ws, bid)]
                we = ws + timedelta(minutes=1)
                impressions = bk["impressions"] or 1
                records.append({
                    "type": "banner_kpi",
                    "window_start": ws,
                    "window_end": we,
                    "banner_id": bid,
                    "impressions": bk["impressions"],
                    "clicks": bk["clicks"],
                    "ctr": round(bk["clicks"] / impressions, 4),
                    "target_product_id": bk.get("target_product_id") or None,
                })

        for (ws, pid), prk in list(self._product_revenue.items()):
            if ws < cutoff:
                del self._product_revenue[(ws, pid)]
                we = ws + timedelta(minutes=1)
                views = prk["views"] or 1
                records.append({
                    "type": "product_revenue_kpi",
                    "window_start": ws,
                    "window_end": we,
                    "product_id": pid,
                    **prk,
                    "view_to_cart_rate": round(prk["add_to_cart"] / views, 4),
                    "purchase_rate": round(prk["purchases"] / views, 4),
                })

        return records


def _empty_tracking_kpi() -> dict:
    return {
        "total_events": 0, "page_views": 0, "product_views": 0,
        "clicks": 0, "searches": 0, "add_to_cart": 0,
        "checkout_start": 0, "purchases": 0,
    }


def _empty_product_kpi() -> dict:
    return {"product_views": 0, "add_to_cart": 0, "purchases": 0}


def _empty_banner_kpi() -> dict:
    return {"impressions": 0, "clicks": 0, "target_product_id": ""}


def _empty_product_revenue_kpi() -> dict:
    return {
        "views": 0, "clicks": 0, "add_to_cart": 0,
        "checkout_start": 0, "purchases": 0, "revenue": 0.0,
    }
