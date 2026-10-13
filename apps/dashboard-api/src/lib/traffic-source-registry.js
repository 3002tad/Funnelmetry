import { createHash } from 'node:crypto'
import { hasPermission } from './roles.js'

const labelPattern = /^[a-z][a-z0-9._-]{0,63}$/
const sourcePattern = /^[a-z0-9][a-z0-9-]{2,62}$/

export const TRAFFIC_SOURCE_LABELS_SQL = `SELECT canonical_label,
  COUNT(*)::text AS raw_variant_count, MAX(updated_at) AS updated_at
  FROM traffic_source_registry_v1
  WHERE source_id = $1 AND ($2::text IS NULL OR canonical_label > $2)
  GROUP BY canonical_label ORDER BY canonical_label ASC LIMIT 26`

export function parseRegistrySource(value) {
  if (typeof value !== 'string' || !sourcePattern.test(value)) throw Error('invalid_source_id')
  return value
}

export function parseRegistryLabel(value) {
  if (typeof value !== 'string' || !labelPattern.test(value)) throw Error('invalid_canonical_label')
  return value
}

export function parseRawSource(value) {
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > 512 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw Error('invalid_raw_utm_source')
  }
  // Browser SDK preserves the exact decoded string. Do not trim/lowercase it.
  return value
}

export function rawSourceHash(value) {
  return createHash('sha256').update(parseRawSource(value), 'utf8').digest('hex')
}

export function parseMappingMutation(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)
    || Object.keys(body).some(key => !['source_id', 'raw_utm_source', 'canonical_label', 'expected_version'].includes(key))) {
    throw Error('invalid_traffic_mapping')
  }
  const sourceId = parseRegistrySource(body.source_id)
  const hash = rawSourceHash(body.raw_utm_source)
  const label = parseRegistryLabel(body.canonical_label)
  const version = body.expected_version
  if (version !== null && (!Number.isInteger(version) || version < 1 || version >= 2147483647)) {
    throw Error('invalid_traffic_mapping')
  }
  return { sourceId, hash, label, expectedVersion: version }
}

export function registryError(status, code) {
  return Object.assign(new Error(code), { status })
}

// Insert or compare-and-swap a current mapping and append its audit row in one
// transaction. No historical raw event or prior audit entry is rewritten.
export async function saveTrafficMapping(input, actor, run) {
  return run(async execute => {
    const [current] = await execute(`SELECT role, is_active, session_version FROM dashboard_users
      WHERE id = $1 FOR UPDATE`, [actor.id])
    if (!current?.is_active || current.session_version !== actor.session_version) {
      throw registryError(401, 'session_expired')
    }
    if (!hasPermission(current.role, 'traffic.mapping.write')) throw registryError(403, 'forbidden')

    let saved, action
    if (input.expectedVersion === null) {
      ;[saved] = await execute(`INSERT INTO traffic_source_registry_v1
        (source_id, raw_utm_source_hash, canonical_label, created_by, updated_by)
        VALUES ($1,$2,$3,$4,$4) ON CONFLICT DO NOTHING
        RETURNING canonical_label, version, updated_at`,
      [input.sourceId, input.hash, input.label, actor.id])
      action = 'ASSIGNED'
      if (!saved) {
        const [existing] = await execute(`SELECT canonical_label, version, updated_at FROM traffic_source_registry_v1
          WHERE source_id=$1 AND raw_utm_source_hash=$2`, [input.sourceId, input.hash])
        if (existing?.canonical_label === input.label && existing.version === 1) return { ...existing, changed: false }
        throw registryError(409, 'mapping_exists')
      }
    } else {
      ;[saved] = await execute(`UPDATE traffic_source_registry_v1
        SET canonical_label=$3, version=version+1, updated_by=$4, updated_at=NOW()
        WHERE source_id=$1 AND raw_utm_source_hash=$2 AND version=$5 AND canonical_label<>$3
        RETURNING canonical_label, version, updated_at`,
      [input.sourceId, input.hash, input.label, actor.id, input.expectedVersion])
      action = 'REASSIGNED'
      if (!saved) {
        const [existing] = await execute(`SELECT canonical_label, version, updated_at FROM traffic_source_registry_v1
          WHERE source_id=$1 AND raw_utm_source_hash=$2`, [input.sourceId, input.hash])
        if (!existing) throw registryError(404, 'mapping_not_found')
        if (existing.version === input.expectedVersion && existing.canonical_label === input.label) {
          return { ...existing, changed: false }
        }
        throw registryError(409, 'mapping_changed')
      }
    }
    await execute(`INSERT INTO traffic_source_registry_audit_v1
      (source_id, raw_utm_source_hash, version, canonical_label, actor_id, action)
      VALUES ($1,$2,$3,$4,$5,$6)`,
    [input.sourceId, input.hash, saved.version, saved.canonical_label, actor.id, action])
    return { ...saved, changed: true }
  })
}
