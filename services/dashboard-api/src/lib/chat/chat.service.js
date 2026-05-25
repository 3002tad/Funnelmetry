import { config } from "../../config.js";
import { QdrantStore } from "../qdrant.js";
import { detectIntent, extractMinutes } from "./intent.js";
import { checkOllamaHealth, generateWithOllama } from "./ollama.js";
import { buildPrompt } from "./prompt.js";
import {
  fetchBanners,
  fetchFunnel,
  fetchOverview,
  fetchProductAnomalies,
  fetchTopProducts,
} from "./queries.js";
import { formatAnswer } from "./respond.js";

const qdrant = new QdrantStore(config.qdrant.url, config.qdrant.collection);

async function loadData(intent, minutes) {
  switch (intent) {
    case "overview":
    case "sessions":
    case "revenue":
    case "general":
      return { kpi: await fetchOverview(minutes) };

    case "top_products":
      return { products: await fetchTopProducts(minutes) };

    case "product_anomaly":
      return { anomalies: await fetchProductAnomalies(minutes) };

    case "funnel": {
      const funnel = await fetchFunnel(minutes);
      return { funnel, ...funnel };
    }

    case "banner":
      return { banners: await fetchBanners(minutes) };

    case "optimize": {
      const [anomalies, funnelData, kpi] = await Promise.all([
        fetchProductAnomalies(minutes),
        fetchFunnel(minutes),
        fetchOverview(minutes),
      ]);
      return { anomalies, funnel: funnelData, ...funnelData, kpi };
    }

    default:
      return { kpi: await fetchOverview(minutes) };
  }
}

export async function handleChatMessage(message, options = {}) {
  const minutes = options.minutes ?? extractMinutes(message, 60);
  const intent = detectIntent(message);

  const needsRag = ["product_anomaly", "optimize", "general", "banner"].includes(intent);
  let ragHits = [];
  if (needsRag && config.qdrant.url) {
    try {
      ragHits = await qdrant.searchByText(message, 4);
    } catch (err) {
      console.warn("chat RAG search failed:", err.message);
    }
  }

  const data = await loadData(intent, minutes);

  // Try Ollama first — fallback to template if unavailable
  let answer;
  let model_used = "template";
  if (config.ollama.url) {
    try {
      const prompt = buildPrompt(intent, { minutes, data, ragHits });
      answer = await generateWithOllama(prompt, {
        model: config.ollama.model,
        baseUrl: config.ollama.url,
        timeout: config.ollama.timeout,
      });
      model_used = config.ollama.model;
    } catch (err) {
      console.warn("Ollama unavailable, falling back to template:", err.message);
    }
  }

  if (!answer) {
    answer = formatAnswer(intent, { minutes, data, ragHits });
  }

  return {
    answer,
    intent,
    period_minutes: minutes,
    model_used,
    sources: ragHits.map((h) => ({
      text: h.text,
      score: h.score,
      insight_type: h.insight_type,
    })),
    data_from: "postgresql",
    rag_used: ragHits.length > 0,
  };
}

export async function listRecentInsights(limit = 12) {
  if (!config.qdrant.url) return { insights: [], qdrant: "disabled" };
  const insights = await qdrant.recentInsights(limit);
  return { insights, qdrant: "ok" };
}

export function getQdrantStore() {
  return qdrant;
}

export async function getOllamaHealth() {
  if (!config.ollama.url) return { status: "disabled", url: null };
  return checkOllamaHealth(config.ollama.url);
}
