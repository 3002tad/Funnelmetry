"""
Generate pipeline insights from flushed KPI records and persist to Qdrant.

Numbers stay in PostgreSQL; Qdrant stores human-readable insight text for chatbot RAG.
"""
from __future__ import annotations

import logging
import os
from datetime import datetime, timezone

from lib.embed import embed_text
from lib.qdrant_client import QdrantClient

logger = logging.getLogger(__name__)

_qdrant: QdrantClient | None = None

def _require_env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


def _client() -> QdrantClient | None:
    global _qdrant
    url = _require_env("QDRANT_URL")
    if _qdrant is None:
        collection = _require_env("QDRANT_COLLECTION")
        _qdrant = QdrantClient(url, collection)
    return _qdrant


def _iso(dt) -> str:
    if isinstance(dt, datetime):
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.isoformat()
    return str(dt)


def _build_insights(kpi_records: list[dict]) -> list[dict]:
    now = datetime.now(timezone.utc).isoformat()
    insights: list[dict] = []

    for rec in kpi_records:
        ws = _iso(rec.get("window_start", ""))
        rtype = rec.get("type")

        if rtype == "tracking_kpi":
            add_to_cart = int(rec.get("add_to_cart") or 0)
            purchases = int(rec.get("purchases") or 0)
            sessions = int(rec.get("unique_sessions") or 0)
            if add_to_cart >= 3 and purchases == 0:
                text = (
                    f"Cửa sổ {ws}: có {add_to_cart} lượt thêm giỏ nhưng 0 đơn mua "
                    f"trong {sessions} session — cần kiểm tra checkout hoặc giá."
                )
                insights.append(_row(text, "cart_no_purchase", window_start=ws, created_at=now))
            if sessions >= 5 and purchases == 0 and add_to_cart == 0:
                text = (
                    f"Cửa sổ {ws}: {sessions} session hoạt động nhưng không có thêm giỏ "
                    "— có thể nội dung sản phẩm chưa thuyết phục."
                )
                insights.append(_row(text, "sessions_no_cart", window_start=ws, created_at=now))

        elif rtype == "product_revenue_kpi":
            views = int(rec.get("views") or 0)
            clicks = int(rec.get("clicks") or 0)
            purchases = int(rec.get("purchases") or 0)
            revenue = float(rec.get("revenue") or 0)
            product_id = rec.get("product_id") or "unknown"
            if views >= 10 and purchases == 0:
                text = (
                    f"Sản phẩm {product_id}: {views} lượt xem, {clicks} click, "
                    f"0 đơn mua trong cửa sổ {ws} — high-view low-purchase."
                )
                insights.append(
                    _row(text, "product_high_view_low_purchase", product_id=product_id, window_start=ws, created_at=now)
                )
            elif clicks >= 5 and purchases == 0:
                text = (
                    f"Sản phẩm {product_id}: {clicks} click nhưng 0 mua — "
                    "có thể giá hoặc mô tả chưa khớp kỳ vọng."
                )
                insights.append(
                    _row(text, "product_high_click_low_purchase", product_id=product_id, window_start=ws, created_at=now)
                )
            elif purchases >= 2 and revenue > 0:
                text = (
                    f"Sản phẩm {product_id}: {purchases} đơn, doanh thu {revenue:,.0f} ₫ "
                    f"trong cửa sổ {ws}."
                )
                insights.append(
                    _row(text, "product_performing", product_id=product_id, window_start=ws, created_at=now)
                )

        elif rtype == "banner_kpi":
            impressions = int(rec.get("impressions") or 0)
            clicks = int(rec.get("clicks") or 0)
            banner_id = rec.get("banner_id") or "unknown"
            ctr = float(rec.get("ctr") or 0)
            if impressions >= 20 and clicks == 0:
                text = (
                    f"Banner {banner_id}: {impressions} impression, 0 click "
                    f"(CTR {ctr:.2%}) — cần đổi creative hoặc vị trí."
                )
                insights.append(
                    _row(text, "banner_low_ctr", banner_id=banner_id, window_start=ws, created_at=now)
                )
            elif impressions >= 10 and ctr >= 0.05:
                text = f"Banner {banner_id}: CTR tốt ({ctr:.2%}) với {impressions} impression trong {ws}."
                insights.append(
                    _row(text, "banner_strong_ctr", banner_id=banner_id, window_start=ws, created_at=now)
                )

    return insights


def _row(text: str, insight_type: str, **extra) -> dict:
    return {
        "text": text,
        "insight_type": insight_type,
        "vector": embed_text(text),
        **extra,
    }


def generate(kpi_records: list[dict]) -> None:
    """Detect patterns in flushed KPI records; log and upsert to Qdrant."""
    insights = _build_insights(kpi_records)
    for item in insights:
        logger.info("insight: %s", item["text"])

    client = _client()
    if not client:
        return
    written = client.upsert_insights(insights)
    if written:
        logger.info("qdrant: upserted %d insight(s)", written)
