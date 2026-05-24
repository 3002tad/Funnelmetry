import { createHash } from "node:crypto";

/** Deterministic 384-d embedding — mirrors streaming-processor lib/embed.py */
export const EMBED_DIM = 384;

export function embedText(text, dim = EMBED_DIM) {
  const vec = new Array(dim).fill(0);
  const normalized = (text || "").toLowerCase().trim().replace(/\s+/g, " ");
  if (!normalized) return vec;

  const tokens = normalized.match(/\w+/gu) || [];
  for (const token of [...tokens, normalized]) {
    const digest = createHash("sha256").update(token, "utf8").digest();
    for (let i = 0; i + 3 < digest.length; i += 4) {
      const idx = digest.readUInt32BE(i) % dim;
      vec[idx] += 1;
    }
  }
  const norm = Math.sqrt(vec.reduce((s, x) => s + x * x, 0)) || 1;
  return vec.map((x) => x / norm);
}
