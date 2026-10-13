function required(env, name) {
  const value = env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

function positiveInteger(env, name, fallback) {
  const value = env[name] === undefined || env[name] === '' ? fallback : Number(env[name])
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`)
  return value
}

export function loadConfig(env = process.env) {
  const instanceId = required(env, 'TRAFFIC_SOURCE_INSTANCE_ID')
  if (!/^[A-Za-z0-9._-]+$/.test(instanceId)) throw new Error('TRAFFIC_SOURCE_INSTANCE_ID is invalid')
  return Object.freeze({
    kafka: Object.freeze({
      brokers: Object.freeze(required(env, 'KAFKA_BOOTSTRAP_SERVERS').split(',').map(value => value.trim()).filter(Boolean)),
      clientId: env.TRAFFIC_SOURCE_KAFKA_CLIENT_ID?.trim() || 'funnelmetry-traffic-source',
      consumerGroupId: env.TRAFFIC_SOURCE_CONSUMER_GROUP_ID?.trim() || 'funnelmetry-traffic-source-raw-v1',
      instanceId,
      rawTopic: required(env, 'KAFKA_TOPIC_RAW'),
    }),
    postgres: Object.freeze({
      host: required(env, 'POSTGRES_HOST'),
      port: positiveInteger(env, 'POSTGRES_PORT', 5432),
      database: required(env, 'POSTGRES_DB'),
      user: required(env, 'POSTGRES_USER'),
      password: required(env, 'POSTGRES_PASSWORD'),
      max: positiveInteger(env, 'TRAFFIC_SOURCE_POSTGRES_POOL_SIZE', 5),
    }),
    shutdownTimeoutMs: positiveInteger(env, 'TRAFFIC_SOURCE_SHUTDOWN_TIMEOUT_MS', 10_000),
  })
}
