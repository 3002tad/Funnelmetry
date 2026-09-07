function requiredString(env, name) {
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

function stringList(raw) {
  return String(raw ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
}

function credentialRegistry(env, name) {
  const raw = requiredString(env, name)
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(`${name} must be valid JSON`)
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${name} must be a JSON object`)
  }
  for (const [keyId, credential] of Object.entries(parsed)) {
    if (!keyId || !credential || typeof credential !== "object" || Array.isArray(credential)) {
      throw new Error(`${name} contains an invalid credential`)
    }
    if (typeof credential.source_id !== "string" || !credential.source_id.trim()) {
      throw new Error(`${name}.${keyId}.source_id is required`)
    }
    if (typeof credential.secret !== "string" || !credential.secret) {
      throw new Error(`${name}.${keyId}.secret is required`)
    }
  }
  return Object.freeze(parsed)
}

function coordinationConfig(env) {
  const mode = env.INPUT_GATEWAY_COORDINATION_MODE?.trim() || "single_replica"
  if (mode !== "single_replica" && mode !== "postgres") {
    throw new Error("INPUT_GATEWAY_COORDINATION_MODE must be single_replica or postgres")
  }
  if (mode === "single_replica") return Object.freeze({ mode })
  return Object.freeze({
    mode,
    databaseUrl: requiredString(env, "INPUT_GATEWAY_DATABASE_URL"),
    leaseMs: positiveInteger(env, "INPUT_GATEWAY_CLAIM_LEASE_MS", 30_000),
  })
}

export function loadConfig(env = process.env) {
  const recoveryValue = env.INPUT_GATEWAY_RECOVER_FENCED_CLAIMS?.trim() || 'false'
  if (!['true', 'false'].includes(recoveryValue)) throw new Error('INPUT_GATEWAY_RECOVER_FENCED_CLAIMS must be true or false')
  if (recoveryValue === 'true' && env.INPUT_GATEWAY_COORDINATION_MODE?.trim() !== 'postgres') {
    throw new Error('fenced claim recovery requires postgres coordination')
  }
  const instanceId = requiredString(env, "INPUT_GATEWAY_INSTANCE_ID")
  if (!/^[A-Za-z0-9._-]+$/.test(instanceId)) {
    throw new Error("INPUT_GATEWAY_INSTANCE_ID contains unsupported characters")
  }

  return Object.freeze({
    host: env.INPUT_GATEWAY_HOST?.trim() || "0.0.0.0",
    port: positiveInteger(env, "INPUT_GATEWAY_PORT", 31000),
    maxBodyBytes: positiveInteger(env, "INPUT_GATEWAY_MAX_BODY_BYTES", 128 * 1024),
    maxPayloadBytes: positiveInteger(env, "INPUT_GATEWAY_MAX_PAYLOAD_BYTES", 64 * 1024),
    maxClockSkewMs: positiveInteger(env, "INPUT_GATEWAY_MAX_CLOCK_SKEW_MS", 5 * 60 * 1000),
    shutdownTimeoutMs: positiveInteger(env, "INPUT_GATEWAY_SHUTDOWN_TIMEOUT_MS", 10_000),
    corsOrigins: Object.freeze(stringList(env.INPUT_GATEWAY_CORS_ORIGINS)),
    browserKeys: credentialRegistry(env, "INPUT_GATEWAY_BROWSER_KEYS_JSON"),
    backendKeys: credentialRegistry(env, "INPUT_GATEWAY_BACKEND_KEYS_JSON"),
    coordination: coordinationConfig(env),
    kafka: Object.freeze({
      recoverFencedClaims: recoveryValue === 'true',
      brokers: Object.freeze(stringList(requiredString(env, "KAFKA_BOOTSTRAP_SERVERS"))),
      clientId: env.INPUT_GATEWAY_KAFKA_CLIENT_ID?.trim() || "funnelmetry-input-gateway",
      instanceId,
      rawTopic: requiredString(env, "KAFKA_TOPIC_RAW"),
      receiptTopic: requiredString(env, "KAFKA_TOPIC_INGRESS_RECEIPTS"),
      transactionTimeoutMs: positiveInteger(env, "INPUT_GATEWAY_KAFKA_TRANSACTION_TIMEOUT_MS", 30_000),
      replayTimeoutMs: positiveInteger(env, "INPUT_GATEWAY_RECEIPT_REPLAY_TIMEOUT_MS", 60_000),
    }),
  })
}
