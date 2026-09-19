import { ConnectorError } from './connector.js'

export function loadConfig(env = process.env) {
  const required = name => {
    if (!env[name]?.trim()) throw new ConnectorError(`MISSING_${name}`)
    return env[name].trim()
  }
  const integer = (name, fallback, min, max) => {
    const text = env[name] ?? String(fallback)
    const value = Number(text)
    if (!/^\d+$/.test(text) || !Number.isSafeInteger(value) || value < min || value > max) throw new ConnectorError(`INVALID_${name}`)
    return value
  }
  // No implicit restore fallback: a new Kafka cluster needs a safe-checkpoint procedure.
  if (required('SOURCE_CONNECTOR_MODE') !== 'NORMAL') throw new ConnectorError('RESTORE_MODE_NOT_IMPLEMENTED')
  const id = required('SOURCE_CONNECTOR_ID')
  if (!/^[a-z0-9-]{1,100}$/.test(id)) throw new ConnectorError('INVALID_CONNECTOR_ID')
  return {
    id, url: required('SOURCE_EVENT_FEED_URL'), token: required('SOURCE_EVENT_FEED_TOKEN'),
    initialCursor: { event_feed_id: required('SOURCE_EVENT_FEED_ID'), after_seq: integer('SOURCE_INITIAL_AFTER_SEQ', undefined, 0, Number.MAX_SAFE_INTEGER) },
    databaseUrl: required('SOURCE_CONNECTOR_DATABASE_URL'),
    brokers: required('KAFKA_BOOTSTRAP_SERVERS').split(',').map(s => s.trim()),
    rawTopic: env.KAFKA_TOPIC_RAW || 'funnelmetry.raw.v1',
    receiptTopic: env.KAFKA_TOPIC_INGRESS_RECEIPTS || 'funnelmetry.ingress.receipts.v1',
    waitSeconds: integer('SOURCE_FEED_WAIT_SECONDS', 25, 0, 30),
    timeoutMs: integer('SOURCE_FEED_TIMEOUT_MS', 35000, 1000, 120000),
    limit: integer('SOURCE_FEED_BATCH_SIZE', 100, 1, 1000),
    port: integer('SOURCE_CONNECTOR_HEALTH_PORT', 32100, 1, 65535),
  }
}
