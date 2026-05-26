"""
PostgreSQL sink: write clean events and KPI records.

Uses ON CONFLICT for idempotency so the processor can be restarted safely.
"""
from __future__ import annotations

import json
import logging
from contextlib import contextmanager

import psycopg2
import psycopg2.extras

logger = logging.getLogger(__name__)

_INSERT_EVENT = """
INSERT INTO tracking_events_clean
  (event_id, event_time, event_source, event_category, event_type,
   anonymous_id, session_id, user_id, page_url, product_id, metadata)
VALUES
  (%(event_id)s, %(event_time)s, %(event_source)s, %(event_category)s, %(event_type)s,
   %(anonymous_id)s, %(session_id)s, %(user_id)s, %(page_url)s, %(product_id)s, %(metadata)s)
ON CONFLICT (event_id) DO NOTHING;
"""

_UPSERT_TRACKING_KPI = """
INSERT INTO tracking_kpi_1m
  (window_start, window_end, total_events, page_views, product_views,
   clicks, searches, add_to_cart, checkout_start, purchases, revenue,
   unique_sessions, conversion_rate)
VALUES
  (%(window_start)s, %(window_end)s, %(total_events)s, %(page_views)s,
   %(product_views)s, %(clicks)s, %(searches)s, %(add_to_cart)s,
   %(checkout_start)s, %(purchases)s, %(revenue)s, %(unique_sessions)s,
   %(conversion_rate)s)
ON CONFLICT (window_start) DO UPDATE SET
  total_events    = EXCLUDED.total_events,
  page_views      = EXCLUDED.page_views,
  product_views   = EXCLUDED.product_views,
  clicks          = EXCLUDED.clicks,
  searches        = EXCLUDED.searches,
  add_to_cart     = EXCLUDED.add_to_cart,
  checkout_start  = EXCLUDED.checkout_start,
  purchases       = EXCLUDED.purchases,
  revenue         = EXCLUDED.revenue,
  unique_sessions = EXCLUDED.unique_sessions,
  conversion_rate = EXCLUDED.conversion_rate,
  processed_at    = CURRENT_TIMESTAMP;
"""

_UPSERT_PRODUCT_KPI = """
INSERT INTO product_kpi_1m
  (window_start, product_id, product_views, add_to_cart, purchases,
   add_to_cart_rate, purchase_rate)
VALUES
  (%(window_start)s, %(product_id)s, %(product_views)s, %(add_to_cart)s,
   %(purchases)s, %(add_to_cart_rate)s, %(purchase_rate)s)
ON CONFLICT (window_start, product_id) DO UPDATE SET
  product_views   = EXCLUDED.product_views,
  add_to_cart     = EXCLUDED.add_to_cart,
  purchases       = EXCLUDED.purchases,
  add_to_cart_rate = EXCLUDED.add_to_cart_rate,
  purchase_rate   = EXCLUDED.purchase_rate;
"""

_UPSERT_BANNER_KPI = """
INSERT INTO banner_kpi_1m
  (window_start, window_end, banner_id, impressions, clicks, ctr, target_product_id)
VALUES
  (%(window_start)s, %(window_end)s, %(banner_id)s, %(impressions)s, %(clicks)s,
   %(ctr)s, %(target_product_id)s)
ON CONFLICT (window_start, banner_id) DO UPDATE SET
  impressions         = EXCLUDED.impressions,
  clicks              = EXCLUDED.clicks,
  ctr                 = EXCLUDED.ctr,
  target_product_id   = EXCLUDED.target_product_id;
"""

_UPSERT_PRODUCT_REVENUE_KPI = """
INSERT INTO product_revenue_kpi_1m
  (window_start, window_end, product_id, views, clicks, add_to_cart,
   checkout_start, purchases, revenue, view_to_cart_rate, purchase_rate)
VALUES
  (%(window_start)s, %(window_end)s, %(product_id)s, %(views)s, %(clicks)s,
   %(add_to_cart)s, %(checkout_start)s, %(purchases)s, %(revenue)s,
   %(view_to_cart_rate)s, %(purchase_rate)s)
ON CONFLICT (window_start, product_id) DO UPDATE SET
  views            = EXCLUDED.views,
  clicks           = EXCLUDED.clicks,
  add_to_cart      = EXCLUDED.add_to_cart,
  checkout_start   = EXCLUDED.checkout_start,
  purchases        = EXCLUDED.purchases,
  revenue          = EXCLUDED.revenue,
  view_to_cart_rate = EXCLUDED.view_to_cart_rate,
  purchase_rate    = EXCLUDED.purchase_rate;
"""

# Auto-populate catalog when an event carries product name/price in metadata.
# Only updates rows where name was previously unknown (fallback = product_id).
_UPSERT_PRODUCT_CATALOG = """
INSERT INTO products_catalog (product_id, name, price, category)
VALUES (%(product_id)s, %(name)s, %(price)s, %(category)s)
ON CONFLICT (product_id) DO UPDATE SET
  name     = CASE WHEN products_catalog.name = products_catalog.product_id
                  THEN EXCLUDED.name ELSE products_catalog.name END,
  price    = CASE WHEN products_catalog.price = 0
                  THEN EXCLUDED.price ELSE products_catalog.price END,
  category = CASE WHEN products_catalog.category IS NULL OR products_catalog.category = ''
                  THEN EXCLUDED.category ELSE products_catalog.category END;
"""

_KPI_DISPATCH = {
    "tracking_kpi": _UPSERT_TRACKING_KPI,
    "product_kpi": _UPSERT_PRODUCT_KPI,
    "banner_kpi": _UPSERT_BANNER_KPI,
    "product_revenue_kpi": _UPSERT_PRODUCT_REVENUE_KPI,
}


class PostgresSink:
    def __init__(self, dsn: str) -> None:
        self._dsn = dsn
        self._conn: psycopg2.extensions.connection | None = None

    def _connect(self) -> None:
        self._conn = psycopg2.connect(self._dsn)
        self._conn.autocommit = False
        logger.info("postgres connected")

    @contextmanager
    def _cursor(self):
        if self._conn is None or self._conn.closed:
            self._connect()
        try:
            with self._conn.cursor() as cur:
                yield cur
            self._conn.commit()
        except Exception:
            self._conn.rollback()
            raise

    def write_event(self, event: dict) -> None:
        """Write a single event. Prefer write_events_batch for throughput."""
        self.write_events_batch([event])

    def write_events_batch(self, events: list[dict]) -> None:
        """Batch-insert events — one commit for the whole batch (much faster)."""
        if not events:
            return

        params_list = [
            {
                "event_id": e.get("event_id"),
                "event_time": e.get("event_time"),
                "event_source": e.get("event_source"),
                "event_category": e.get("event_category"),
                "event_type": e.get("event_type"),
                "anonymous_id": e.get("anonymous_id"),
                "session_id": e.get("session_id"),
                "user_id": e.get("user_id"),
                "page_url": e.get("page_url"),
                "product_id": e.get("product_id"),
                "metadata": json.dumps(e.get("metadata") or {}),
            }
            for e in events
        ]

        catalog_params = []
        for e in events:
            pid = e.get("product_id")
            meta = e.get("metadata") or {}
            p_name = meta.get("name") or meta.get("product_name")
            p_price = meta.get("price") or meta.get("unit_price")
            if pid and p_name and p_price is not None:
                catalog_params.append({
                    "product_id": pid,
                    "name": str(p_name),
                    "price": float(p_price),
                    "category": meta.get("category") or "",
                })

        try:
            with self._cursor() as cur:
                psycopg2.extras.execute_batch(cur, _INSERT_EVENT, params_list)
                if catalog_params:
                    psycopg2.extras.execute_batch(cur, _UPSERT_PRODUCT_CATALOG, catalog_params)
            logger.debug("wrote batch of %d events", len(events))
        except Exception as exc:
            logger.error("write_events_batch failed (batch size=%d): %s", len(events), exc)
            raise

    def write_kpi_batch(self, records: list[dict]) -> None:
        if not records:
            return
        try:
            with self._cursor() as cur:
                for rec in records:
                    kpi_type = rec.get("type")
                    sql = _KPI_DISPATCH.get(kpi_type)
                    if sql is None:
                        logger.warning("unknown kpi type: %s", kpi_type)
                        continue
                    cur.execute(sql, rec)
            logger.info("flushed %d KPI records to postgres", len(records))
        except Exception as exc:
            logger.error("write_kpi_batch failed: %s", exc)
            raise

    def close(self) -> None:
        if self._conn and not self._conn.closed:
            self._conn.close()
