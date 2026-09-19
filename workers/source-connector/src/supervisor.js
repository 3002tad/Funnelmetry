import { setTimeout as delay } from 'node:timers/promises'

export function isRetryable(error) {
  return ['FEED_UNAVAILABLE', 'INVALID_FEED_RESPONSE', 'FEED_HTTP_408', 'FEED_HTTP_429',
    'CURSOR_STORE_UNAVAILABLE', 'CURSOR_OWNER_LOST', 'CONNECTOR_ALREADY_OWNED', 'KAFKA_HANDOFF_FAILED',
    'DEPENDENCY_UNAVAILABLE'].includes(error.code) || /^FEED_HTTP_5\d\d$/.test(error.code ?? '')
}

export async function supervise({ openSession, signal, state, log, sleep = delay }) {
  let failures = 0
  while (!signal.aborted) {
    let session
    try {
      state.status = 'CONNECTING'
      session = await openSession()
      while (!signal.aborted) {
        const result = await session.pollOnce()
        state.status = 'READY'
        state.last_success_at = new Date().toISOString()
        state.cursor = result.cursor
        state.error = null
        failures = 0
        if (!result.count) await sleep(250, undefined, { signal })
      }
    } catch (error) {
      if (signal.aborted) break
      state.status = isRetryable(error) ? 'DEGRADED' : 'BLOCKED'
      state.error = error.code || 'UNEXPECTED_FAILURE'
      log({ status: state.status, code: state.error })
      if (state.status === 'BLOCKED') {
        // Fail closed, remain inspectable; no container restart loop on bad credentials/feed.
        await session?.close()
        session = null
        while (!signal.aborted) {
          try { await sleep(1000, undefined, { signal }) } catch { break }
        }
        break
      }
    } finally {
      await session?.close()
    }
    if (!signal.aborted) {
      const backoff = Math.min(30000, 1000 * 2 ** Math.min(failures++, 5))
      try { await sleep(backoff, undefined, { signal }) } catch { break }
    }
  }
  state.status = 'STOPPED'
}
