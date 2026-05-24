"""Deterministic text embedding (384-d) — same algorithm as dashboard-api lib/chat/embed.js."""
from __future__ import annotations

import hashlib
import math
import re

EMBED_DIM = 384


def embed_text(text: str, dim: int = EMBED_DIM) -> list[float]:
    vec = [0.0] * dim
    normalized = re.sub(r"\s+", " ", (text or "").lower().strip())
    if not normalized:
        return vec
    tokens = re.findall(r"\w+", normalized, flags=re.UNICODE)
    for token in tokens + [normalized]:
        digest = hashlib.sha256(token.encode("utf-8")).digest()
        for i in range(0, len(digest) - 3, 4):
            idx = int.from_bytes(digest[i : i + 4], "big") % dim
            vec[idx] += 1.0
    norm = math.sqrt(sum(x * x for x in vec)) or 1.0
    return [x / norm for x in vec]
