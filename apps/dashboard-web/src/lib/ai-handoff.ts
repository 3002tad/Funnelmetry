function aiTarget(baseUrl: string): URL {
  const target = new URL(baseUrl)
  if (target.protocol !== "https:" || target.username || target.password || target.pathname !== "/" || target.search || target.hash) {
    throw new Error("invalid_ai_url")
  }
  return target
}

/** Submit a browser navigation without putting the Pipeline token in a URL. */
export function establishAiSession(baseUrl: string, token: string, frameName: string): void {
  const target = aiTarget(baseUrl)
  const form = document.createElement("form")
  form.method = "POST"
  form.action = new URL("/api/auth/funnelmetry/session", target).href
  form.target = frameName
  form.style.display = "none"
  const input = document.createElement("input")
  input.type = "hidden"
  input.name = "token"
  input.value = token
  form.appendChild(input)
  document.body.appendChild(form)
  try {
    form.submit()
  } finally {
    form.remove()
  }
}

/** Best effort: server-side session revocation remains independently required. */
export async function clearAiSession(baseUrl: string): Promise<void> {
  const target = aiTarget(baseUrl)
  const response = await fetch(new URL("/api/auth/funnelmetry/session", target), {
    method: "DELETE", credentials: "include", redirect: "error", keepalive: true,
  })
  if (!response.ok) throw new Error("ai_session_clear_failed")
}
