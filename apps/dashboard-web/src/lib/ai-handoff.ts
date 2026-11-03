function aiTarget(baseUrl: string): URL {
  const target = new URL(baseUrl)
  if (target.protocol !== "https:" || target.username || target.password || target.pathname !== "/" || target.search || target.hash) {
    throw new Error("invalid_ai_url")
  }
  return target
}

/** Establish a DB-GPT session without placing the Pipeline token in a URL. */
export async function establishAiSession(baseUrl: string, token: string): Promise<string> {
  const target = aiTarget(baseUrl)
  const response = await fetch(new URL("/api/auth/funnelmetry/session", target), {
    method: "POST",
    credentials: "include",
    redirect: "error",
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!response.ok) throw new Error("ai_session_unavailable")
  return target.origin
}

/** Best effort: server-side session revocation remains independently required. */
export async function clearAiSession(baseUrl: string): Promise<void> {
  const target = aiTarget(baseUrl)
  const response = await fetch(new URL("/api/auth/funnelmetry/session", target), {
    method: "DELETE", credentials: "include", redirect: "error", keepalive: true,
  })
  if (!response.ok) throw new Error("ai_session_clear_failed")
}
