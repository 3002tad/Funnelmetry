import { config } from "../../config.js";
import { QdrantStore } from "../qdrant.js";
import { checkOllamaHealth } from "./ollama.js";
import { composeAnalystReport } from "./analyst-report.js";
import { formatAnswer } from "./respond.js";
import { polishGroundedAnswer } from "./polish.js";
import { guardOutput } from "./output.guard.js";
import { classifyScope, REWRITE_NOTE } from "./scope.guard.js";
import { buildQdrantFilters, rerankInsights } from "./rag-filters.js";
import { buildPlan } from "./planner.js";
import { loadDataByPlan } from "./data-loader.js";
import { buildActionCards } from "./action.engine.js";
import { getSessionMemory, updateSessionMemory } from "./memory.store.js";

const qdrant = new QdrantStore(config.qdrant.url, config.qdrant.collection);

const RAG_SEARCH_LIMIT = 12;
const RAG_PROMPT_LIMIT = 5;
const POLISH_TIMEOUT_CAP_MS = 28_000;

function modelAvailable(health, model) {
  if (!model || !health?.models?.length) return false;
  const want = model.split(":")[0];
  return health.models.some((m) => m === model || m.startsWith(`${want}:`) || m.startsWith(want));
}

async function tryPolishAnswer(brief, message, ollamaOpts) {
  if (!brief || !ollamaOpts.baseUrl) return null;
  const health = await checkOllamaHealth(ollamaOpts.baseUrl);
  if (health.status !== "ok" || !modelAvailable(health, ollamaOpts.model)) {
    console.warn(
      "chat: skip Ollama polish —",
      health.status !== "ok" ? health.error || "ollama down" : `model ${ollamaOpts.model} not pulled`
    );
    return null;
  }
  const timeout = Math.min(ollamaOpts.timeout ?? 60_000, POLISH_TIMEOUT_CAP_MS);
  try {
    const polished = await polishGroundedAnswer(brief, message, { ...ollamaOpts, timeout });
    return polished && polished.length > 40 ? polished : null;
  } catch (err) {
    console.warn("Ollama analyst polish failed:", err.message);
    return null;
  }
}

async function fetchRagHits(message, plan) {
  if (!plan.needs_rag || !config.qdrant.url) return [];
  try {
    const filter = buildQdrantFilters(plan.intent, plan.minutes);
    const raw = await qdrant.searchByText(message, {
      limit: RAG_SEARCH_LIMIT,
      filter,
    });
    return rerankInsights(raw, plan.intent).slice(0, RAG_PROMPT_LIMIT);
  } catch (err) {
    console.warn("chat RAG search failed:", err.message);
    return [];
  }
}

function buildChatResponse({
  answer,
  plan,
  model_used,
  ragHits,
  scope,
  output_guard,
  rewritten,
  actions,
  latency_ms,
}) {
  return {
    answer,
    intent: plan.intent,
    period_minutes: plan.minutes,
    model_used,
    sources: ragHits.map((h) => ({
      text: h.text,
      score: h.score,
      insight_type: h.insight_type,
    })),
    data_from: "postgresql",
    rag_used: ragHits.length > 0,
    scope_decision: scope.decision,
    scope_reason: scope.reason,
    output_guard,
    rewritten: Boolean(rewritten),
    actions,
    tools_used: plan.tools,
    from_memory: plan.from_memory,
    latency_ms,
  };
}

export async function handleChatMessage(message, options = {}) {
  const started = Date.now();
  const scope = classifyScope(message);
  if (scope.decision === "deny") {
    return {
      answer: scope.safeAnswer,
      intent: "blocked_sensitive",
      period_minutes: null,
      model_used: "policy_guard",
      sources: [],
      data_from: "none",
      rag_used: false,
      scope_decision: scope.decision,
      scope_reason: scope.reason,
      output_guard: "pass",
      rewritten: false,
      actions: [],
      tools_used: [],
      latency_ms: Date.now() - started,
    };
  }

  const memory = getSessionMemory(options.session_id);
  const plan = buildPlan(message, { scope, memory });
  const rewritten = scope.decision === "rewrite";

  const [data, ragHits] = await Promise.all([
    loadDataByPlan(plan),
    fetchRagHits(message, plan),
  ]);

  const actions = buildActionCards({
    intent: plan.intent,
    data,
    ragHits,
    minutes: plan.minutes,
  });

  const ollamaOpts = {
    model: config.ollama.model,
    baseUrl: config.ollama.url,
    timeout: config.ollama.timeout,
    temperature: config.ollama.temperature,
    numPredict: config.ollama.numPredict,
  };

  const reportCtx = {
    intent: plan.intent,
    minutes: plan.minutes,
    userMessage: message,
    data,
    ragHits,
    actions,
  };
  const brief = composeAnalystReport(reportCtx);
  const displayIntent =
    plan.tools.length >= 3 && plan.intent === "general" ? "optimize" : plan.intent;

  let answer;
  let model_used = "analyst-template";

  const fallback = () =>
    formatAnswer(displayIntent, {
      minutes: plan.minutes,
      data,
      ragHits,
      rewritten,
      actions,
    });

  if (!config.ollama.url) {
    answer = fallback();
    model_used = "analyst-template";
  } else if (brief) {
    const polished = await tryPolishAnswer(brief, message, ollamaOpts);
    if (polished) {
      answer = polished;
      model_used = `${config.ollama.model} (analyst)`;
    }
  }

  if (!answer || answer.length < 30) {
    answer = fallback();
    model_used = config.ollama.url ? "template-fallback" : "analyst-template";
  }

  if (rewritten) {
    answer = `${REWRITE_NOTE}\n\n${answer}`;
  }

  const { text: safeAnswer, status: output_guard } = guardOutput(answer);

  updateSessionMemory(options.session_id, {
    last_intent: plan.intent,
    last_minutes: plan.minutes,
    last_message: message.slice(0, 200),
  });

  return buildChatResponse({
    answer: safeAnswer,
    plan,
    model_used,
    ragHits,
    scope,
    output_guard,
    rewritten,
    actions,
    latency_ms: Date.now() - started,
  });
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
