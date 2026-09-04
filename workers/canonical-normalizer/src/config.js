function required(env, name) {
  const value = env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

function list(value) {
  return value.split(",").map((item) => item.trim()).filter(Boolean)
}

function positiveInteger(env, name, fallback) {
  const raw = env[name]
  if (raw === undefined || raw === "") return fallback
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`)
  return value
}

export function loadConfig(env = process.env) {
  const instanceId = required(env, "CANONICAL_NORMALIZER_INSTANCE_ID")
  if (!/^[A-Za-z0-9._-]+$/.test(instanceId)) {
    throw new Error("CANONICAL_NORMALIZER_INSTANCE_ID contains unsupported characters")
  }
  return Object.freeze({
    brokers: Object.freeze(list(required(env, "KAFKA_BOOTSTRAP_SERVERS"))),
    clientId: env.CANONICAL_NORMALIZER_KAFKA_CLIENT_ID?.trim() || "funnelmetry-canonical-normalizer",
    consumerGroupId: env.CANONICAL_NORMALIZER_CONSUMER_GROUP_ID?.trim() || "funnelmetry-canonical-normalizer-v1",
    instanceId,
    rawTopic: required(env, "KAFKA_TOPIC_RAW"),
    canonicalTopic: required(env, "KAFKA_TOPIC_CANONICAL"),
    outcomeTopic: required(env, "KAFKA_TOPIC_CANONICALIZATION_OUTCOMES"),
    quarantineTopic: required(env, "KAFKA_TOPIC_QUARANTINE"),
    mappingConfigPath: env.CANONICAL_NORMALIZER_MAPPING_CONFIG_PATH?.trim() || null,
    transactionTimeoutMs: positiveInteger(env, "CANONICAL_NORMALIZER_TRANSACTION_TIMEOUT_MS", 30_000),
    shutdownTimeoutMs: positiveInteger(env, "CANONICAL_NORMALIZER_SHUTDOWN_TIMEOUT_MS", 10_000),
  })
}
