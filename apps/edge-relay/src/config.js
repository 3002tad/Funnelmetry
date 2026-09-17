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

function parseCredentialRegistry(env, name) {
  let parsed
  try {
    parsed = JSON.parse(requiredString(env, name))
  } catch {
    throw new Error(`${name} must be valid JSON`)
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(`${name} must be a JSON object`)

  const sourceIds = new Set()
  for (const [keyId, credential] of Object.entries(parsed)) {
    if (!keyId || !credential || typeof credential !== "object" || Array.isArray(credential)) throw new Error(`${name} contains an invalid credential`)
    if (typeof credential.source_id !== "string" || !credential.source_id.trim()) throw new Error(`${name}.${keyId}.source_id is required`)
    if (typeof credential.secret !== "string" || credential.secret === "") throw new Error(`${name}.${keyId}.secret is required`)
    if (sourceIds.has(credential.source_id)) throw new Error(`${name} must contain one credential per source_id`)
    sourceIds.add(credential.source_id)
    if (credential.allowed_origins !== undefined && (!Array.isArray(credential.allowed_origins) || credential.allowed_origins.some((origin) => typeof origin !== "string" || !origin))) {
      throw new Error(`${name}.${keyId}.allowed_origins must be an array of origins`)
    }
  }
  return Object.freeze(parsed)
}

function parseFeedTokens(env) {
  let parsed
  try {
    parsed = JSON.parse(requiredString(env, "SOURCE_INGRESS_EVENT_FEED_TOKENS_JSON"))
  } catch {
    throw new Error("SOURCE_INGRESS_EVENT_FEED_TOKENS_JSON must be valid JSON")
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("SOURCE_INGRESS_EVENT_FEED_TOKENS_JSON must be a JSON object")
  if (Object.keys(parsed).length === 0) throw new Error("SOURCE_INGRESS_EVENT_FEED_TOKENS_JSON must map token IDs to non-empty token strings")
  for (const [tokenId, token] of Object.entries(parsed)) {
    if (!tokenId || typeof token !== "string" || !token) throw new Error("SOURCE_INGRESS_EVENT_FEED_TOKENS_JSON must map token IDs to non-empty token strings")
  }
  return Object.freeze(parsed)
}

export function loadConfig(env = process.env) {
  return Object.freeze({
    host: env.SOURCE_INGRESS_HOST?.trim() || "0.0.0.0",
    port: positiveInteger(env, "SOURCE_INGRESS_PORT", 32000),
    databasePath: env.SOURCE_INGRESS_DATABASE_PATH?.trim() || "./data/funnelmetry-source-event-log.sqlite",
    maxBodyBytes: positiveInteger(env, "SOURCE_INGRESS_MAX_BODY_BYTES", 128 * 1024),
    maxPayloadBytes: positiveInteger(env, "SOURCE_INGRESS_MAX_PAYLOAD_BYTES", 64 * 1024),
    maxEventLogEvents: positiveInteger(env, "SOURCE_INGRESS_MAX_EVENT_LOG_EVENTS", 100000),
    maxEventLogBytes: positiveInteger(env, "SOURCE_INGRESS_MAX_EVENT_LOG_BYTES", 1024 * 1024 * 1024),
    minFreeDiskBytes: positiveInteger(env, "SOURCE_INGRESS_MIN_FREE_DISK_BYTES", 256 * 1024 * 1024),
    maxClockSkewMs: positiveInteger(env, "SOURCE_INGRESS_MAX_CLOCK_SKEW_MS", 5 * 60 * 1000),
    eventFeedMaxLimit: positiveInteger(env, "SOURCE_INGRESS_EVENT_FEED_MAX_LIMIT", 100),
    eventFeedMaxWaitSeconds: positiveInteger(env, "SOURCE_INGRESS_EVENT_FEED_MAX_WAIT_SECONDS", 25),
    adminToken: env.SOURCE_INGRESS_ADMIN_TOKEN?.trim() || null,
    browserKeys: parseCredentialRegistry(env, "SOURCE_INGRESS_BROWSER_KEYS_JSON"),
    backendKeys: parseCredentialRegistry(env, "SOURCE_INGRESS_BACKEND_KEYS_JSON"),
    eventFeedTokens: parseFeedTokens(env),
  })
}
