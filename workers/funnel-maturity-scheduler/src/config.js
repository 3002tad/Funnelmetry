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

function booleanValue(env, name, fallback) {
  const raw = env[name]
  if (raw === undefined || raw === "") return fallback
  if (raw === "true") return true
  if (raw === "false") return false
  throw new Error(`${name} must be true or false`)
}

export function loadConfig(env = process.env) {
  const instanceId = required(env, "MATURITY_SCHEDULER_INSTANCE_ID")
  if (!/^[A-Za-z0-9._-]+$/.test(instanceId)) {
    throw new Error("MATURITY_SCHEDULER_INSTANCE_ID contains unsupported characters")
  }
  const poolSize = positiveInteger(env, "MATURITY_SCHEDULER_POSTGRES_POOL_SIZE", 3)
  if (poolSize < 2) {
    throw new Error("MATURITY_SCHEDULER_POSTGRES_POOL_SIZE must be at least 2")
  }
  return Object.freeze({
    instanceId,
    pollIntervalMs: positiveInteger(env, "MATURITY_SCHEDULER_POLL_INTERVAL_MS", 5_000),
    batchSize: positiveInteger(env, "MATURITY_SCHEDULER_BATCH_SIZE", 100),
    finalizationEnabled: booleanValue(env, "MATURITY_SCHEDULER_FINALIZATION_ENABLED", false),
    shutdownTimeoutMs: positiveInteger(env, "MATURITY_SCHEDULER_SHUTDOWN_TIMEOUT_MS", 10_000),
    postgres: Object.freeze({
      host: required(env, "POSTGRES_HOST"),
      port: positiveInteger(env, "POSTGRES_PORT", 5432),
      database: required(env, "POSTGRES_DB"),
      user: required(env, "POSTGRES_USER"),
      password: required(env, "POSTGRES_PASSWORD"),
      max: poolSize,
    }),
  })
}
