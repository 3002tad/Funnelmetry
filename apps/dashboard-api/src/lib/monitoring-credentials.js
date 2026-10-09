import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'

const tokenPattern = /^fmmon_([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.([A-Za-z0-9_-]{43})$/
export const credentialIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
export const hashMonitoringToken = token => createHash('sha256').update(token).digest('hex')
export function newMonitoringToken() {
  const id = randomUUID()
  const token = `fmmon_${id}.${randomBytes(32).toString('base64url')}`
  return { id, token, hash: hashMonitoringToken(token) }
}

// Fixed capability: metrics.read only. No user identity/JWT claims accepted here.
export async function verifyMonitoringToken(header, execute) {
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return false
  const token = header.slice(7)
  const match = tokenPattern.exec(token)
  if (!match) return false
  const [row] = await execute(`SELECT c.secret_hash FROM monitoring_credentials c
    JOIN dashboard_users u ON u.id=c.created_by
    WHERE c.id=$1 AND c.revoked_at IS NULL AND c.expires_at > clock_timestamp()
      AND u.is_active=true AND u.role='super_admin'`, [match[1]])
  if (!row || !/^[0-9a-f]{64}$/.test(row.secret_hash)) return false
  return timingSafeEqual(Buffer.from(row.secret_hash, 'hex'), Buffer.from(hashMonitoringToken(token), 'hex'))
}

export function parseMonitoringIssue(body, maxSeconds) {
  if (!body || Array.isArray(body) || Object.keys(body).some(k => !['label', 'ttl_seconds'].includes(k)) ||
      typeof body.label !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9 ._-]{0,79}$/.test(body.label) ||
      !Number.isSafeInteger(body.ttl_seconds) || body.ttl_seconds < 60 || body.ttl_seconds > maxSeconds) {
    throw Error('invalid_monitoring_credential')
  }
  return body
}
