import { timingSafeEqual } from "node:crypto"

export class IngressAuthError extends Error {
  constructor(reasonCode) {
    super(reasonCode)
    this.name = "IngressAuthError"
    this.reasonCode = reasonCode
  }
}

function readHeader(headers, name) {
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
  if (!keyId || typeof keyId !== "string") throw new IngressAuthError("source_key_id_missing")
  const credential = registry?.[keyId]
  if (!credential || typeof credential !== "object") throw new IngressAuthError("source_key_unknown")
  if (credential.source_id !== event.source_id) throw new IngressAuthError("source_key_mismatch")
  if (typeof credential.secret !== "string" || credential.secret === "") {
    throw new IngressAuthError("source_key_misconfigured")
  }
  return credential
}

function authenticateBrowser({ event, headers, browserKeys }) {
  const keyId = readHeader(headers, "x-funnelmetry-source-key-id")
  const credential = resolveCredential(browserKeys, keyId, event)
  const writeKey = readHeader(headers, "x-funnelmetry-write-key")
  if (!safeEqual(writeKey, credential.secret)) throw new IngressAuthError("write_key_invalid")
  return { key_id: keyId, method: "browser_write_key" }
}

export function authenticateIngress({
  event,
  headers,
  browserKeys = {},
}) {
  if (event.producer === "browser_sdk") {
    return authenticateBrowser({ event, headers, browserKeys })
  }
  throw new IngressAuthError("producer_auth_unsupported")
}

export function getIngressHeader(headers, name) {
  return readHeader(headers, name)
}
