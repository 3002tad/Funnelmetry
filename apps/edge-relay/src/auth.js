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

export function authenticateBrowser({ headers, event, browserKeys }) {
  const keyId = getHeader(headers, "x-funnelmetry-source-key-id")
  if (!keyId || typeof keyId !== "string") throw new RelayError("source_key_id_missing")
  const credential = browserKeys[keyId]
  if (!credential) throw new RelayError("source_key_unknown")
  if (credential.source_id !== event.source_id) throw new RelayError("source_key_mismatch")
  if (!safeEqual(getHeader(headers, "x-funnelmetry-write-key"), credential.secret)) {
    throw new RelayError("write_key_invalid")
  }
  return { keyId, credential }
}

export function isAllowedOrigin(origin, credential) {
  if (!origin) return true
  return credential.allowed_origins?.includes(origin) === true
}
