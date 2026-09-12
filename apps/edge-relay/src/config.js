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

function booleanValue(env, name, fallback) {
  const raw = env[name]
  if (raw === undefined || raw === "") return fallback
  if (raw === "true") return true
  if (raw === "false") return false
  throw new Error(`${name} must be true or false`)
}

function parseKeyRegistry(env, name, { required = true } = {}) {
  const raw = env[name]
  if ((raw === undefined || raw.trim() === "") && !required) return Object.freeze({})
  const value = requiredString(env, name)
  let parsed
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new Error(`${name} must be valid JSON`)
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(`${name} must be a JSON object`)

  const sourceIds = new Set()
  for (const [keyId, credential] of Object.entries(parsed)) {
    if (!keyId || !credential || typeof credential !== "object" || Array.isArray(credential)) {
      throw new Error(`${name} contains an invalid credential`)
    }
    if (typeof credential.source_id !== "string" || !credential.source_id.trim()) {
      throw new Error(`${name}.${keyId}.source_id is required`)
    }
    if (typeof credential.secret !== "string" || credential.secret === "") {
      throw new Error(`${name}.${keyId}.secret is required`)
    }
    if (sourceIds.has(credential.source_id)) throw new Error(`${name} must contain one credential per source_id`)
    sourceIds.add(credential.source_id)
    if (credential.allowed_origins !== undefined && (!Array.isArray(credential.allowed_origins) || credential.allowed_origins.some((origin) => typeof origin !== "string" || !origin))) {
      throw new Error(`${name}.${keyId}.allowed_origins must be an array of origins`)
    }
  }
  return Object.freeze(parsed)
}

function normalizeUpstreamUrl(env, enabled) {
  const raw = env.RELAY_UPSTREAM_INGRESS_URL?.trim()
  if (!enabled) return raw || null
  if (!raw) throw new Error("RELAY_UPSTREAM_INGRESS_URL is required when RELAY_UPSTREAM_ENABLED=true")
  const url = new URL(raw)
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("RELAY_UPSTREAM_INGRESS_URL must use HTTP(S)")
  return url.toString().replace(/\/$/, "")
}

export function loadConfig(env = process.env) {
  const upstreamEnabled = booleanValue(env, "RELAY_UPSTREAM_ENABLED", false)
  const browserKeys = parseKeyRegistry(env, "RELAY_BROWSER_KEYS_JSON")
  const upstreamBrowserKeys = parseKeyRegistry(env, "RELAY_UPSTREAM_BROWSER_KEYS_JSON", { required: upstreamEnabled })
  if (upstreamEnabled) {
    const configuredSources = new Set(Object.values(upstreamBrowserKeys).map((credential) => credential.source_id))
    for (const credential of Object.values(browserKeys)) {
      if (!configuredSources.has(credential.source_id)) {
        throw new Error(`RELAY_UPSTREAM_BROWSER_KEYS_JSON has no credential for source '${credential.source_id}'`)
      }
    }
  }

  return Object.freeze({
    host: env.RELAY_HOST?.trim() || "0.0.0.0",
    port: positiveInteger(env, "RELAY_PORT", 32000),
    instanceId: env.RELAY_INSTANCE_ID?.trim() || "edge-relay-1",
    databasePath: env.RELAY_DATABASE_PATH?.trim() || "./data/funnelmetry-edge-relay.sqlite",
    maxBodyBytes: positiveInteger(env, "RELAY_MAX_BODY_BYTES", 128 * 1024),
    maxPayloadBytes: positiveInteger(env, "RELAY_MAX_PAYLOAD_BYTES", 64 * 1024),
    maxSpoolEvents: positiveInteger(env, "RELAY_MAX_SPOOL_EVENTS", 100000),
    maxSpoolBytes: positiveInteger(env, "RELAY_MAX_SPOOL_BYTES", 1024 * 1024 * 1024),
    minFreeDiskBytes: positiveInteger(env, "RELAY_MIN_FREE_DISK_BYTES", 256 * 1024 * 1024),
    leaseMs: positiveInteger(env, "RELAY_DELIVERY_LEASE_MS", 30000),
    deliveryIntervalMs: positiveInteger(env, "RELAY_DELIVERY_INTERVAL_MS", 1000),
    deliveryBatchSize: positiveInteger(env, "RELAY_DELIVERY_BATCH_SIZE", 20),
    retryMinMs: positiveInteger(env, "RELAY_RETRY_MIN_MS", 1000),
    retryMaxMs: positiveInteger(env, "RELAY_RETRY_MAX_MS", 60000),
    requestTimeoutMs: positiveInteger(env, "RELAY_UPSTREAM_REQUEST_TIMEOUT_MS", 3000),
    adminToken: env.RELAY_ADMIN_TOKEN?.trim() || null,
    browserKeys,
    upstreamBrowserKeys,
    upstream: Object.freeze({ enabled: upstreamEnabled, ingressUrl: normalizeUpstreamUrl(env, upstreamEnabled) }),
  })
}
