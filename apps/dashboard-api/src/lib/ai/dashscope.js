// Standalone provider. No environment reads or outbound calls at import time.
export class DashScopeError extends Error {
  constructor(code) { super(code); this.name = 'DashScopeError'; this.code = code }
}
const fail = code => { throw new DashScopeError(code) }

export function loadDashScopeConfig(env = process.env) {
  const enabled = env.DASHBOARD_ENABLE_QWEN ?? 'false'
  if (!['true', 'false'].includes(enabled)) fail('invalid_qwen_flag')
  if (enabled === 'false') return null
  let url
  try { url = new URL(env.DASHSCOPE_BASE_URL) } catch { fail('invalid_dashscope_endpoint') }
  const singaporeHost = url.hostname === 'dashscope-intl.aliyuncs.com'
    || /^[a-z0-9-]+\.ap-southeast-1\.maas\.aliyuncs\.com$/.test(url.hostname)
  if (!singaporeHost || url.protocol !== 'https:' || url.port || url.username || url.password
    || url.search || url.hash || !/^\/compatible-mode\/v1\/?$/.test(url.pathname)) fail('invalid_dashscope_endpoint')
  const apiKey = env.DASHSCOPE_API_KEY?.trim()
  if (!apiKey || /\s/.test(apiKey)) fail('missing_or_invalid_dashscope_key')
  const timeoutMs = Number(env.DASHSCOPE_TIMEOUT_MS ?? 15000)
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 60000) fail('invalid_dashscope_timeout')
  // The user chose this model explicitly; no silent upgrade or fallback provider.
  return Object.freeze({ endpoint: `${url.origin}/compatible-mode/v1/chat/completions`, apiKey, model: 'qwen-flash', timeoutMs })
}

export function createDashScopeClient(env = process.env, fetchImpl = fetch) {
  const config = loadDashScopeConfig(env)
  let inFlight = 0
  return Object.freeze({
    enabled: config !== null,
    async complete(messages, { signal } = {}) {
      if (!config) fail('qwen_disabled')
      if (!Array.isArray(messages) || !messages.length || messages.length > 16) fail('invalid_ai_messages')
      const safeMessages = messages.map(message => {
        if (!message || !['system', 'user', 'assistant'].includes(message.role)
          || typeof message.content !== 'string' || !message.content.trim()) fail('invalid_ai_messages')
        return { role: message.role, content: message.content }
      })
      const body = JSON.stringify({ model: config.model, messages: safeMessages, stream: false,
        max_tokens: 1024, temperature: 0.2, enable_thinking: false })
      if (Buffer.byteLength(body) > 65536) fail('ai_request_too_large')
      if (signal?.aborted) fail('ai_cancelled')
      if (inFlight >= 2) fail('ai_busy')
      inFlight++
      const controller = new AbortController()
      let timedOut = false, timer, onAbort
      const cancelled = new Promise((_, reject) => {
        onAbort = () => { controller.abort(); reject(new DashScopeError('ai_cancelled')) }
        signal?.addEventListener('abort', onAbort, { once: true })
        timer = setTimeout(() => {
          timedOut = true
          controller.abort()
          reject(new DashScopeError('ai_timeout'))
        }, config.timeoutMs)
      })
      const request = async () => {
        let response, reader
        try {
          response = await fetchImpl(config.endpoint, {
            method: 'POST', redirect: 'error', signal: controller.signal,
            headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' }, body,
          })
          if (!response.ok) {
            if (response.status === 401 || response.status === 403) fail('ai_auth_failed')
            if (response.status === 429) fail('ai_rate_limited')
            fail('ai_upstream_failed')
          }
          if (!response.headers.get('content-type')?.includes('application/json')) fail('ai_invalid_response')
          if (Number(response.headers.get('content-length')) > 262144) fail('ai_response_too_large')
          reader = response.body?.getReader()
          if (!reader) fail('ai_invalid_response')
          const chunks = []
          let bytes = 0
          while (true) {
            const chunk = await reader.read()
            if (chunk.done) break
            bytes += chunk.value.byteLength
            if (bytes > 262144) fail('ai_response_too_large')
            chunks.push(Buffer.from(chunk.value))
          }
          let data
          try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { fail('ai_invalid_response') }
          const choice = data.choices?.[0]
          if (choice?.finish_reason !== 'stop' || choice.message?.tool_calls
            || typeof choice.message?.content !== 'string' || !choice.message.content.trim()) fail('ai_incomplete_response')
          return { text: choice.message.content, model: config.model, provider: 'dashscope', region: 'singapore' }
        } finally {
          // Never retain or log upstream error bodies, prompts, auth headers or raw exceptions.
          if (reader) await reader.cancel().catch(() => {})
          else await response?.body?.cancel().catch(() => {})
        }
      }
      try { return await Promise.race([request(), cancelled]) }
      catch (error) {
        if (timedOut) fail('ai_timeout')
        if (signal?.aborted) fail('ai_cancelled')
        if (error instanceof DashScopeError) throw error
        fail('ai_unavailable')
      } finally {
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
        controller.abort()
        inFlight--
      }
    },
  })
}
