const sha256 = /^[a-f0-9]{64}$/
const states = new Set(['PRESENT', 'ABSENT', 'INVALID'])

export class TrafficSourceConflictError extends Error {
  constructor() {
    super('traffic_source_identity_conflict')
    this.name = 'TrafficSourceConflictError'
  }
}

function validateObservation(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ['source_id', 'source_event_id', 'source_event_type', 'source_schema_version', 'raw_record_id']
      .some(key => typeof value[key] !== 'string' || !value[key])
    || !sha256.test(value.raw_content_hash)
    || typeof value.received_at !== 'string' || !Number.isFinite(Date.parse(value.received_at))
    || !states.has(value.utm_source_state)
    || (value.utm_source_state === 'PRESENT' ? !sha256.test(value.utm_source_hash) : value.utm_source_hash !== null)
    || typeof value.synthetic !== 'boolean') throw new Error('invalid_traffic_observation')
  return value
}

export function createTrafficSourceRepository({ pool } = {}) {
  if (!pool || typeof pool.connect !== 'function') throw new Error('PostgreSQL pool is required')
  return Object.freeze({
    async persist(input) {
      const observation = validateObservation(input)
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const inserted = await client.query(`INSERT INTO traffic_source_raw_events_v1
          (source_id, source_event_id, source_event_type, source_schema_version,
           raw_record_id, raw_content_hash, received_at, utm_source_state, utm_source_hash, synthetic)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
          ON CONFLICT DO NOTHING RETURNING recorded_at`,
        [observation.source_id, observation.source_event_id, observation.source_event_type,
          observation.source_schema_version, observation.raw_record_id, observation.raw_content_hash,
          observation.received_at, observation.utm_source_state, observation.utm_source_hash,
          observation.synthetic])
        if (inserted.rowCount === 1) {
          await client.query('COMMIT')
          return { status: 'inserted' }
        }
        const existing = await client.query(`SELECT
          (source_event_type = $3 AND source_schema_version = $4 AND raw_content_hash = $5
           AND utm_source_state = $6 AND utm_source_hash IS NOT DISTINCT FROM $7
           AND synthetic = $8) AS identical
          FROM traffic_source_raw_events_v1 WHERE source_id = $1 AND source_event_id = $2`,
        [observation.source_id, observation.source_event_id, observation.source_event_type,
          observation.source_schema_version, observation.raw_content_hash, observation.utm_source_state,
          observation.utm_source_hash, observation.synthetic])
        if (existing.rowCount !== 1 || existing.rows[0].identical !== true) throw new TrafficSourceConflictError()
        await client.query('COMMIT')
        return { status: 'duplicate' }
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {})
        throw error
      } finally {
        client.release()
      }
    },
  })
}
