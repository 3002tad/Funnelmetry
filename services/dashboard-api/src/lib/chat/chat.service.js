import { config } from "../../config.js";
import { QdrantStore } from "../qdrant.js";
import { checkOllamaHealth } from "./ollama.js";
import { composeAnalystReport } from "./analyst-report.js";
import { formatAnswer } from "./respond.js";
import { polishGroundedAnswer } from "./polish.js";
import { guardOutput } from "./output.guard.js";
import { classifyScope, REWRITE_NOTE } from "./scope.guard.js";
import { buildQdrantFilters, rerankInsights } from "./rag-filters.js";
import { buildPlanAsync } from "./planner.js";
import { loadDataByPlan } from "./data-loader.js";
import { buildActionCards, formatActionsMarkdown } from "./action.engine.js";
import { getSessionMemory, updateSessionMemory } from "./memory.store.js";
import { detectIntent } from "./intent.js";
import { detectStaticIntent, STATIC_INTENT_NAMES } from "./static-intents.js";
import {
  appendChatMessage,
  deleteChatSession,
  ensureChatSession,
  getChatMessages,
  listChatSessions,
  newSessionId,
} from "./chat-history.js";

const qdrant = new QdrantStore(config.qdrant.url, config.qdrant.collection);

const RAG_SEARCH_LIMIT = 12;
const RAG_PROMPT_LIMIT = 5;
// Full analyst brief + ~500 tokens often exceeds 30s on CPU WSL; stay under UI (~75s) / nginx (~90s).
const POLISH_TIMEOUT_CAP_MS = 55_000;

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
  const timeout = POLISH_TIMEOUT_CAP_MS;
  const polishOpts = {
    ...ollamaOpts,
    timeout,
    temperature: config.chat.polishTemperature,
    numPredict: Math.min(config.chat.polishNumPredict, config.ollama.numPredict),
  };
  try {
    const polished = await polishGroundedAnswer(brief, message, polishOpts);
    if (!polished || polished.length <= 40) {
      console.warn("chat: Ollama polish too short or empty");
      return null;
    }
    return polished;
  } catch (err) {
    console.warn(`Ollama analyst polish failed (timeout=${timeout}ms):`, err.message);
    return null;
  }
}

async function fetchRagHits(message, plan) {
  if (!plan.needs_rag || !config.qdrant.url) return [];
  try {
    const ragIntent =
      plan.intent === "compound" && plan.sub_intents?.length
        ? plan.sub_intents.find((s) => s.intent === "insights" || s.intent === "product_anomaly")?.intent ||
          plan.sub_intents[0].intent
        : plan.intent;
    const filter = buildQdrantFilters(ragIntent, plan.minutes);
    const raw = await qdrant.searchByText(message, {
      limit: RAG_SEARCH_LIMIT,
      filter,
    });
    return rerankInsights(raw, ragIntent).slice(0, RAG_PROMPT_LIMIT);
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
    period_minutes: plan.calendar_date ? null : plan.minutes,
    period_date: plan.calendar_date || null,
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
    const payload = {
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
    await persistChatTurn(options.user_id, options.session_id, message, payload);
    return payload;
  }

  const memory = getSessionMemory(options.session_id);
  const staticHit = detectStaticIntent(message, memory, detectIntent(message) === "general");
  if (staticHit) {
    updateSessionMemory(options.session_id, { last_message: message.slice(0, 200) });
    const payload = {
      answer: staticHit.reply,
      intent: staticHit.intent,
      period_minutes: null,
      model_used: "static",
      sources: [],
      data_from: "none",
      rag_used: false,
      scope_decision: scope.decision,
      scope_reason: scope.reason,
      output_guard: "pass",
      rewritten: false,
      actions: [],
      tools_used: [],
      from_memory: false,
      latency_ms: Date.now() - started,
    };
    await persistChatTurn(options.user_id, options.session_id, message, payload);
    return payload;
  }

  const ollamaOpts = {
    model: config.ollama.model,
    baseUrl: config.ollama.url,
    timeout: config.ollama.timeout,
    temperature: config.ollama.temperature,
    numPredict: config.ollama.numPredict,
    plannerTimeout: config.chat.plannerTimeoutMs,
  };
  const plan = await buildPlanAsync(message, {
    scope,
    memory,
    ollamaOpts,
    enableLlmPlanner: config.chat.llmPlanner,
    calendarDate: options.date,
    minutes: options.minutes,
  });
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

  const reportCtx = {
    intent: plan.intent,
    minutes: plan.minutes,
    userMessage: message,
    data,
    ragHits,
    actions,
    sub_intents: plan.sub_intents,
  };
  const brief = composeAnalystReport(reportCtx);
  const displayIntent =
    plan.intent === "compound"
      ? "compound"
      : plan.tools.length >= 3 && plan.intent === "general" && !plan.tools.includes("fetchTopProducts")
        ? "optimize"
        : plan.intent;

  let answer;
  let model_used = "analyst-template";

  const fallback = () =>
    formatAnswer(displayIntent, {
      minutes: plan.minutes,
      data,
      ragHits,
      rewritten,
      actions,
      sub_intents: plan.sub_intents,
    });

  if (!config.ollama.url) {
    answer = fallback();
    model_used = "analyst-template";
  } else if (brief) {
    const polished = await tryPolishAnswer(brief, message, ollamaOpts);
    if (polished) {
      answer = polished;
      if (actions?.length && !answer.includes("Action cards")) {
        answer += formatActionsMarkdown(actions);
      }
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
    last_intent: plan.intent === "compound"
      ? plan.sub_intents?.[0]?.intent || memory?.last_intent
      : STATIC_INTENT_NAMES.has(plan.intent)
        ? memory?.last_intent
        : plan.intent,
    last_minutes: plan.minutes,
    last_product_sort: plan.product_sort,
    last_product_id: plan.entities?.product_id || null,
    last_product_name: plan.entities?.product_name || null,
    last_banner_id: plan.entities?.banner_id || null,
    last_banner_name: plan.entities?.banner_name || null,
    last_message: message.slice(0, 200),
  });

  const response = buildChatResponse({
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

  await persistChatTurn(options.user_id, options.session_id, message, response);
  return response;
}

async function persistChatTurn(userId, sessionId, userMessage, response) {
  if (!userId || !sessionId || !userMessage || !response?.answer) return;
  try {
    await ensureChatSession(sessionId, userId, userMessage.slice(0, 80));
    await appendChatMessage(sessionId, userId, { role: "user", content: userMessage });
    await appendChatMessage(sessionId, userId, {
      role: "assistant",
      content: response.answer,
      meta: {
        intent: response.intent,
        model: response.model_used,
        rag: response.rag_used,
      },
    });
  } catch (err) {
    console.warn("chat: history persist failed:", err.message);
  }
}

export async function createChatSessionForUser(userId) {
  const session_id = newSessionId();
  await ensureChatSession(session_id, userId);
  return { session_id };
}

export async function listUserChatSessions(userId) {
  return listChatSessions(userId);
}

export async function loadUserChatMessages(sessionId, userId) {
  const rows = await getChatMessages(sessionId, userId);
  if (rows === null) return { found: false, messages: [] };
  return {
    found: true,
    messages: rows.map((r) => ({
      role: r.role,
      content: r.content,
      meta: r.meta || undefined,
      created_at: r.created_at,
    })),
  };
}

export async function removeUserChatSession(sessionId, userId) {
  const ok = await deleteChatSession(sessionId, userId);
  return { deleted: ok };
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
