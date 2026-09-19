import { ConnectorError, validateCursor } from './connector.js'

// Keep a dedicated pg connection for the session-scoped advisory lock.
// Runtime must stop polling on connection failure and reacquire a NEW store.
export async function openPostgresCursorStore({ pool, connectorId, initialCursor }) {
  validateCursor(initialCursor)
  if (typeof connectorId !== 'string' || !connectorId.trim()) throw new ConnectorError('INVALID_CONNECTOR_ID')
  const client = await pool.connect()
  let active = true
  const onError = () => { active = false }
  client.on('error', onError)
  const assertActive = () => { if (!active) throw new ConnectorError('CURSOR_OWNER_LOST') }
  async function query(sql, values) {
    assertActive()
    try { return await client.query(sql, values) } catch {
      active = false
      throw new ConnectorError('CURSOR_STORE_UNAVAILABLE')
    }
  }
  const lockKey = `source-connector:${connectorId}`
  try {
    const lock = await query('SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS acquired', [lockKey])
    if (!lock.rows[0]?.acquired) throw new ConnectorError('CONNECTOR_ALREADY_OWNED')
    await query(`INSERT INTO source_connector_cursors (connector_id, event_feed_id, after_seq)
      VALUES ($1, $2, $3) ON CONFLICT (connector_id) DO NOTHING`,
    [connectorId, initialCursor.event_feed_id, initialCursor.after_seq])
    const store = {
      async assertOwned() {
        // A dead session must not publish another batch after long polling.
        await query('SELECT 1', [])
      },
      async load() {
        const result = await query('SELECT event_feed_id, after_seq FROM source_connector_cursors WHERE connector_id = $1', [connectorId])
        const row = result.rows[0]
        if (!row) throw new ConnectorError('CURSOR_MISSING')
        if (row.event_feed_id !== initialCursor.event_feed_id) throw new ConnectorError('FEED_ID_MISMATCH')
        return validateCursor({ event_feed_id: row.event_feed_id, after_seq: Number(row.after_seq) })
      },
      async advance(expected, next) {
        assertActive()
        validateCursor(expected); validateCursor(next)
        if (expected.event_feed_id !== initialCursor.event_feed_id || next.event_feed_id !== expected.event_feed_id
          || next.after_seq <= expected.after_seq) throw new ConnectorError('INVALID_CURSOR_ADVANCE')
        const result = await query(`UPDATE source_connector_cursors SET after_seq = $4, updated_at = now()
          WHERE connector_id = $1 AND event_feed_id = $2 AND after_seq = $3`,
        [connectorId, expected.event_feed_id, expected.after_seq, next.after_seq])
        if (result.rowCount !== 1) {
          active = false
          throw new ConnectorError('CURSOR_CONFLICT')
        }
      },
      close() {
        if (closed) return
        closed = true
        active = false
        // Destroy, rather than pool, the session holding an advisory lock.
        client.release(true)
      },
    }
    let closed = false
    await store.load()
    return store
  } catch (error) {
    active = false
    client.release(true)
    throw error
  }
}
