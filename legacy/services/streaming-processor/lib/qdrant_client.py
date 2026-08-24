"""Minimal Qdrant REST client for insight vectors."""
from __future__ import annotations

import json
import logging
import urllib.error
import urllib.request
import uuid

from lib.embed import EMBED_DIM

logger = logging.getLogger(__name__)


class QdrantClient:
    def __init__(self, base_url: str, collection: str) -> None:
        self._base = base_url.rstrip("/")
        self._collection = collection
        self._ready = False

    def ensure_collection(self) -> bool:
        if self._ready:
            return True
        url = f"{self._base}/collections/{self._collection}"
        try:
            with urllib.request.urlopen(url, timeout=3) as resp:
                if resp.status == 200:
                    self._ready = True
                    return True
        except urllib.error.HTTPError as exc:
            if exc.code != 404:
                logger.warning("qdrant collection check failed: %s", exc)
                return False
        except OSError as exc:
            logger.warning("qdrant unreachable: %s", exc)
            return False

        body = json.dumps(
            {
                "vectors": {
                    "size": EMBED_DIM,
                    "distance": "Cosine",
                }
            }
        ).encode("utf-8")
        req = urllib.request.Request(
            url,
            data=body,
            method="PUT",
            headers={"Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(req, timeout=5) as resp:
                self._ready = resp.status in (200, 201)
                if self._ready:
                    logger.info("qdrant collection %s ready", self._collection)
                return self._ready
        except OSError as exc:
            logger.warning("qdrant create collection failed: %s", exc)
            return False

    def upsert_insights(self, insights: list[dict]) -> int:
        if not insights:
            return 0
        if not self.ensure_collection():
            return 0

        points = []
        for item in insights:
            text = item.get("text", "")
            points.append(
                {
                    "id": str(uuid.uuid4()),
                    "vector": item.get("vector") or [],
                    "payload": {
                        "text": text,
                        "insight_type": item.get("insight_type", "general"),
                        "product_id": item.get("product_id"),
                        "banner_id": item.get("banner_id"),
                        "window_start": item.get("window_start"),
                        "created_at": item.get("created_at"),
                    },
                }
            )

        url = f"{self._base}/collections/{self._collection}/points?wait=true"
        body = json.dumps({"points": points}).encode("utf-8")
        req = urllib.request.Request(
            url,
            data=body,
            method="PUT",
            headers={"Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                if resp.status in (200, 201):
                    return len(points)
        except OSError as exc:
            logger.error("qdrant upsert failed: %s", exc)
        return 0
