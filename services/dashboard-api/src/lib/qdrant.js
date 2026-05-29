import { embedText, EMBED_DIM } from "./chat/embed.js";

export { EMBED_DIM };

export class QdrantStore {
  constructor(baseUrl, collection) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.collection = collection;
    this.ready = false;
  }

  async ensureCollection() {
    if (this.ready) return true;
    const url = `${this.baseUrl}/collections/${this.collection}`;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
      if (res.ok) {
        this.ready = true;
        return true;
      }
      if (res.status !== 404) return false;
    } catch {
      return false;
    }

    const create = await fetch(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        vectors: { size: EMBED_DIM, distance: "Cosine" },
      }),
      signal: AbortSignal.timeout(5000),
    });
    this.ready = create.ok;
    return this.ready;
  }

  /**
   * @param {string} text
   * @param {{ limit?: number, filter?: object }} [options]
   */
  async searchByText(text, options = {}) {
    const limit = typeof options === "number" ? options : options.limit ?? 5;
    const filter = typeof options === "number" ? null : options.filter ?? null;

    if (!this.baseUrl) return [];
    if (!(await this.ensureCollection())) return [];

    const body = {
      vector: embedText(text),
      limit,
      with_payload: true,
    };
    if (filter) body.filter = filter;

    const res = await fetch(
      `${this.baseUrl}/collections/${this.collection}/points/search`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(5000),
      }
    );
    if (!res.ok) return [];
    const data = await res.json();
    return (data.result || []).map((hit) => ({
      score: hit.score,
      text: hit.payload?.text,
      insight_type: hit.payload?.insight_type,
      product_id: hit.payload?.product_id,
      banner_id: hit.payload?.banner_id,
      window_start: hit.payload?.window_start,
      created_at: hit.payload?.created_at,
    }));
  }

  async recentInsights(limit = 12) {
    if (!this.baseUrl) return [];
    if (!(await this.ensureCollection())) return [];

    const res = await fetch(
      `${this.baseUrl}/collections/${this.collection}/points/scroll`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit: 50, with_payload: true }),
        signal: AbortSignal.timeout(5000),
      }
    );
    if (!res.ok) return [];
    const data = await res.json();
    const points = (data.result?.points || [])
      .map((p) => ({
        text: p.payload?.text,
        insight_type: p.payload?.insight_type,
        product_id: p.payload?.product_id,
        created_at: p.payload?.created_at || "",
      }))
      .filter((p) => p.text)
      .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""))
      .slice(0, limit);
    return points;
  }

  async health() {
    if (!this.baseUrl) return { status: "disabled", url: null };
    try {
      const res = await fetch(`${this.baseUrl}/readyz`, { signal: AbortSignal.timeout(3000) });
      return {
        status: res.ok ? "ok" : "degraded",
        url: this.baseUrl,
        collection: this.collection,
      };
    } catch (err) {
      return { status: "down", url: this.baseUrl, error: err.message };
    }
  }
}
