function aiTarget(baseUrl: string): URL {
  const target = new URL(baseUrl)
  if (target.protocol !== "https:" || target.username || target.password || target.pathname !== "/" || target.search || target.hash) {
    throw new Error("invalid_ai_url")
  }
  return target
}

/** Submit a top-level navigation so Cloudflare Access can process its cookie. */
export function establishAiSession(baseUrl: string, token: string): void {
  const target = aiTarget(baseUrl)
  const name = `funnelmetry-ai-${crypto.randomUUID()}`
  const popup = window.open("about:blank", name)
  if (!popup) throw new Error("popup_blocked")
  const form = document.createElement("form")
  form.method = "POST"
  form.action = new URL("/api/auth/funnelmetry/session", target).href
  form.target = name
  form.style.display = "none"
  const input = document.createElement("input")
  input.type = "hidden"
  input.name = "token"
  input.value = token
  form.appendChild(input)
  document.body.appendChild(form)
  try {
    form.submit()
    popup.opener = null
  } catch (error) {
    popup.close()
    throw error
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
