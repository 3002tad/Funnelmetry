import { timingSafeEqual } from "node:crypto"
import { RelayError } from "./errors.js"

export function getHeader(headers, name) {
  if (headers && typeof headers.get === "function") return headers.get(name)
  const target = name.toLowerCase()
  for (const [key, value] of Object.entries(headers ?? {})) {
    if (key.toLowerCase() === target) return Array.isArray(value) ? value[0] : value
  }
  return undefined
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left ?? ""))
  const b = Buffer.from(String(right ?? ""))
  return a.length === b.length && timingSafeEqual(a, b)
}

function resolveCredential(registry, keyId, event) {
  if (!keyId || typeof keyId !== "string") throw new RelayError("source_key_id_missing")
  const credential = registry[keyId]
  if (!credential) throw new RelayError("source_key_unknown")
  if (credential.source_id !== event.source_id) throw new RelayError("source_key_mismatch")
  return { keyId, credential }
}

function authenticateBrowser({ headers, event, browserKeys }) {
  const keyId = getHeader(headers, "x-funnelmetry-source-key-id")
  const resolved = resolveCredential(browserKeys, keyId, event)
  if (!safeEqual(getHeader(headers, "x-funnelmetry-write-key"), resolved.credential.secret)) {
    throw new RelayError("write_key_invalid")
  }
  return { credential: resolved.credential, keyId: resolved.keyId, authentication: { key_id: resolved.keyId, method: "browser_write_key" } }
}

export function authenticateIngress({ event, headers, browserKeys }) {
  if (event.producer === "browser_sdk") return authenticateBrowser({ headers, event, browserKeys })
  throw new RelayError("producer_auth_unsupported")
}

export function authenticateEventFeed({ headers, eventFeedTokens }) {
  const authorization = getHeader(headers, "authorization")
  if (typeof authorization !== "string" || !authorization.startsWith("Bearer ")) throw new RelayError("event_feed_unauthorized")
  const token = authorization.slice("Bearer ".length)
  for (const [tokenId, candidate] of Object.entries(eventFeedTokens)) {
    if (safeEqual(token, candidate)) return { token_id: tokenId }
  }
  throw new RelayError("event_feed_unauthorized")
}

export function isAllowedOrigin(origin, credential) {
  if (!origin) return true
  return credential.allowed_origins?.includes(origin) === true
}
