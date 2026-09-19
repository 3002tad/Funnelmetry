import { ConnectorError, validateCursor } from './connector.js'

export function createFeedClient({ url, token, waitSeconds = 25, timeoutMs = 35000,
  maxResponseBytes = 8 * 1024 * 1024, fetchImpl = fetch }) {
  const endpoint = new URL(url)
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.hash || endpoint.search) {
    throw new ConnectorError('INVALID_FEED_URL')
  }
  if (typeof token !== 'string' || !token.trim() || /[\r\n]/.test(token)) throw new ConnectorError('INVALID_FEED_TOKEN')
  if (!Number.isSafeInteger(waitSeconds) || waitSeconds < 0 || waitSeconds > 30
    || !Number.isSafeInteger(timeoutMs) || timeoutMs <= waitSeconds * 1000
    || !Number.isSafeInteger(maxResponseBytes) || maxResponseBytes <= 0) throw new ConnectorError('INVALID_FEED_LIMITS')
  return {
    async read(cursor) {
      validateCursor(cursor)
      if (!Number.isSafeInteger(cursor.limit) || cursor.limit < 1) throw new ConnectorError('INVALID_LIMIT')
      const requestUrl = new URL(endpoint)
      requestUrl.searchParams.set('after_seq', String(cursor.after_seq))
      requestUrl.searchParams.set('limit', String(cursor.limit))
      requestUrl.searchParams.set('wait', String(waitSeconds))
      let response
      try {
        response = await fetchImpl(requestUrl, {
          headers: { authorization: `Bearer ${token}`, accept: 'application/json', 'cache-control': 'no-cache' },
          redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
        })
      } catch { throw new ConnectorError('FEED_UNAVAILABLE') }
      if (!response.ok) {
        await response.body?.cancel()
        // Never expose arbitrary remote bodies, URLs or credentials in an error.
        throw new ConnectorError(`FEED_HTTP_${response.status}`)
      }
      const reader = response.body?.getReader()
      if (!reader) throw new ConnectorError('INVALID_FEED_RESPONSE')
      const chunks = []
      let size = 0
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          size += value.byteLength
          if (size > maxResponseBytes) throw new ConnectorError('FEED_TOO_LARGE')
          chunks.push(Buffer.from(value))
        }
        return JSON.parse(Buffer.concat(chunks).toString('utf8'))
      } catch (error) {
        if (error instanceof ConnectorError) throw error
        throw new ConnectorError('INVALID_FEED_RESPONSE')
      } finally {
        await reader.cancel().catch(() => {})
        reader.releaseLock()
      }
    },
  }
}
