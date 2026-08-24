/**
 * Ollama client — chat API for natural multi-turn style replies.
 * Facts come from PostgreSQL embedded in the user message (not from model memory).
 */

export async function generateChatWithOllama(messages, { model, baseUrl, timeout = 60000, temperature = 0.65, numPredict = 768 } = {}) {
  const url = `${baseUrl}/api/chat`;
  const body = JSON.stringify({
    model,
    messages,
    stream: false,
    options: {
      temperature,
      top_p: 0.9,
      num_predict: numPredict,
    },
  });

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    signal: AbortSignal.timeout(timeout),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Ollama chat ${res.status}: ${text.slice(0, 120)}`);
  }

  const data = await res.json();
  return (data.message?.content || data.response || "").trim();
}

export async function checkOllamaHealth(baseUrl) {
  try {
    const res = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return { status: "down" };
    const data = await res.json();
    const models = (data.models || []).map((m) => m.name);
    return { status: "ok", models };
  } catch (err) {
    return { status: "down", error: err.message };
  }
}
