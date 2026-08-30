function required(env, name) {
  const value = env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

function positiveInteger(env, name, fallback) {
  const raw = env[name]
  if (raw === undefined || raw === "") return fallback
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`)
  return value
}

export function loadConfig(env = process.env) {
  const instanceId = required(env, "KPI_PROJECTOR_INSTANCE_ID")
  if (!/^[A-Za-z0-9._-]+$/.test(instanceId)) throw new Error("KPI_PROJECTOR_INSTANCE_ID contains unsupported characters")
  return Object.freeze({
    kafka: Object.freeze({
      brokers: Object.freeze(required(env, "KAFKA_BOOTSTRAP_SERVERS").split(",").map((value) => value.trim()).filter(Boolean)),
      clientId: env.KPI_PROJECTOR_KAFKA_CLIENT_ID?.trim() || "funnelmetry-kpi-projector",
      consumerGroupId: env.KPI_PROJECTOR_CONSUMER_GROUP_ID?.trim() || "funnelmetry-kpi-projector-v1",
      instanceId,
      funnelUpdatedTopic: required(env, "KAFKA_TOPIC_FUNNEL_UPDATED"),
      kpiUpdatedTopic: required(env, "KAFKA_TOPIC_KPI_UPDATED"),
      transactionTimeoutMs: positiveInteger(env, "KPI_PROJECTOR_TRANSACTION_TIMEOUT_MS", 30_000),
    }),
    postgres: Object.freeze({
      host: required(env, "POSTGRES_HOST"),
      port: positiveInteger(env, "POSTGRES_PORT", 5432),
      database: required(env, "POSTGRES_DB"),
      user: required(env, "POSTGRES_USER"),
      password: required(env, "POSTGRES_PASSWORD"),
      max: positiveInteger(env, "KPI_PROJECTOR_POSTGRES_POOL_SIZE", 5),
    }),
    shutdownTimeoutMs: positiveInteger(env, "KPI_PROJECTOR_SHUTDOWN_TIMEOUT_MS", 10_000),
  })
}
