/**
 * Ollama client — gọi local LLM để sinh câu trả lời tự nhiên.
 * Số liệu đã được query từ PostgreSQL và truyền vào prompt (không để model tự tính).
 */

export async function generateWithOllama(prompt, { model, baseUrl, timeout = 60000 } = {}) {
  const url = `${baseUrl}/api/generate`;
  const body = JSON.stringify({
    model,
    prompt,
    stream: false,
    options: {
      temperature: 0.3,
      top_p: 0.9,
      num_predict: 512,
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
    throw new Error(`Ollama ${res.status}: ${text.slice(0, 120)}`);
  }

  const data = await res.json();
  return (data.response || "").trim();
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
