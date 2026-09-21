import { readFile } from "node:fs/promises"
import { parseManifestYaml } from "./yaml.mjs"

const browserBindings = new Set([
  "behavior.page_viewed",
  "behavior.scroll_depth_reached",
  "promotion.banner_impression",
  "promotion.banner_clicked",
  "behavior.filter_applied",
  "behavior.product_viewed",
  "checkout.started",
])
const storefrontServerBindings = new Set([
  "behavior.search_submitted",
  "cart.item_added",
])
const medusaBackendBindings = new Set(["medusa.order_placed"])

function requiredString(value, name) {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${name} is required`)
  return value.trim()
}

function optionalPositiveInteger(value, name, fallback) {
  if (value === undefined) return fallback
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`)
  return value
}

function bindingList(value, name, supported) {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${name} must be a non-empty list`)
  const result = []
  for (const binding of value) {
    if (typeof binding !== "string" || !supported.has(binding)) {
      throw new Error(`Unsupported ${name} binding '${binding}'`)
    }
    if (result.includes(binding)) throw new Error(`${name} contains duplicate binding '${binding}'`)
    result.push(binding)
  }
  return result
}

function requireCompleteProfile(actual, required, name) {
  const missing = [...required].filter((binding) => !actual.includes(binding))
  if (missing.length > 0) throw new Error(`${name} is missing required binding(s): ${missing.join(", ")}`)
}

function secretReference(value, name) {
  const reference = requiredString(value, name)
  if (!/^[A-Z][A-Z0-9_]*$/.test(reference)) {
    throw new Error(`${name} must be an environment/secret reference, not a secret value`)
  }
  return reference
}

function ingressUrl(value, name) {
  const raw = requiredString(value, name)
  let parsed
  try { parsed = new URL(raw) } catch { throw new Error(`${name} must be an absolute HTTP(S) URL`) }
  if (!["http:", "https:"].includes(parsed.protocol)) throw new Error(`${name} must use HTTP(S)`)
  return parsed.toString().replace(/\/$/, "")
}

export function validateManifest(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Manifest root must be a mapping")
  if (raw.apiVersion !== "funnelmetry.io/v2") throw new Error("apiVersion must be funnelmetry.io/v2")
  if (raw.kind !== "InputIntegration") throw new Error("kind must be InputIntegration")

  const host = raw.host ?? {}
  if (host.type !== "medusa-v2-dtc-starter") throw new Error("host.type must be medusa-v2-dtc-starter")
  const medusaVersion = requiredString(host.medusa_version, "host.medusa_version")

  const source = raw.source ?? {}
  const sourceId = requiredString(source.id, "source.id")
  if (!/^[a-z0-9][a-z0-9-]{2,62}$/.test(sourceId)) throw new Error("source.id must be lowercase kebab-case")

  if (raw.frontend !== undefined || raw.backend !== undefined) {
    throw new Error("frontend/backend are V1 fields; declare every integration under bindings")
  }
  const auth = raw.auth ?? {}
  const sourceKeyId = requiredString(auth.source_key_id, "auth.source_key_id")
  const bindings = raw.bindings ?? {}
  const browser = bindingList(bindings.browser, "bindings.browser", browserBindings)
  const storefrontServer = bindingList(bindings.storefront_server, "bindings.storefront_server", storefrontServerBindings)
  const medusaBackend = bindingList(bindings.medusa_backend, "bindings.medusa_backend", medusaBackendBindings)
  requireCompleteProfile(storefrontServer, storefrontServerBindings, "bindings.storefront_server")
  requireCompleteProfile(medusaBackend, medusaBackendBindings, "bindings.medusa_backend")
  const reliability = raw.reliability ?? {}
  const retry = reliability.retry ?? {}
  const circuitBreaker = reliability.circuit_breaker ?? {}

  const normalized = {
    apiVersion: raw.apiVersion,
    kind: raw.kind,
    host: { type: host.type, medusaVersion },
    source: { id: sourceId },
    ingest: {
      browserUrl: ingressUrl(raw.ingest?.browser_url, "ingest.browser_url"),
      backendUrl: ingressUrl(raw.ingest?.backend_url, "ingest.backend_url"),
    },
    auth: {
      sourceKeyId,
      browserWriteKeyRef: secretReference(auth.browser_write_key_ref, "auth.browser_write_key_ref"),
      backendSigningKeyRef: secretReference(auth.backend_signing_key_ref, "auth.backend_signing_key_ref"),
    },
    bindings: { browser, storefrontServer, medusaBackend },
    // Internal compatibility for the current generator. The public manifest
    // source of truth is the explicit bindings block above.
    frontend: { enabled: true, events: browser },
    backend: { enabled: true, binding: medusaBackend[0] },
    reliability: {
      failureMode: reliability.failure_mode ?? "fail_open",
      timeoutMs: optionalPositiveInteger(reliability.timeout_ms, "reliability.timeout_ms", 800),
      maxQueueSize: optionalPositiveInteger(reliability.max_queue_size, "reliability.max_queue_size", 200),
      retry: {
        maxAttempts: optionalPositiveInteger(retry.max_attempts, "reliability.retry.max_attempts", 3),
      },
      circuitBreaker: {
        failureThreshold: optionalPositiveInteger(
          circuitBreaker.failure_threshold,
          "reliability.circuit_breaker.failure_threshold",
          3,
        ),
        cooldownMs: optionalPositiveInteger(
          circuitBreaker.cooldown_ms,
          "reliability.circuit_breaker.cooldown_ms",
          30000,
        ),
      },
    },
  }
  if (normalized.reliability.failureMode !== "fail_open") {
    throw new Error("reliability.failure_mode must be fail_open")
  }

  return normalized
}

export async function loadManifest(filePath) {
  const raw = parseManifestYaml(await readFile(filePath, "utf8"))
  return validateManifest(raw)
}
