import { readFile } from "node:fs/promises"
import { parseManifestYaml } from "./yaml.mjs"

const eventTypes = new Set([
  "behavior.product_viewed",
  "cart.add_clicked",
  "checkout.started",
])

function requiredString(value, name) {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${name} is required`)
  return value.trim()
}

function optionalBoolean(value, name) {
  if (value === undefined) return false
  if (typeof value !== "boolean") throw new Error(`${name} must be boolean`)
  return value
}

function optionalPositiveInteger(value, name, fallback) {
  if (value === undefined) return fallback
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`)
  return value
}

function secretReference(value, name) {
  const reference = requiredString(value, name)
  if (!/^[A-Z][A-Z0-9_]*$/.test(reference)) {
    throw new Error(`${name} must be an environment/secret reference, not a secret value`)
  }
  return reference
}

export function validateManifest(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Manifest root must be a mapping")
  if (raw.apiVersion !== "funnelmetry.io/v1") throw new Error("apiVersion must be funnelmetry.io/v1")
  if (raw.kind !== "InputIntegration") throw new Error("kind must be InputIntegration")

  const host = raw.host ?? {}
  if (host.type !== "medusa-v2-dtc-starter") throw new Error("host.type must be medusa-v2-dtc-starter")
  const medusaVersion = requiredString(host.medusa_version, "host.medusa_version")

  const source = raw.source ?? {}
  const sourceId = requiredString(source.id, "source.id")
  if (!/^[a-z0-9][a-z0-9-]{2,62}$/.test(sourceId)) throw new Error("source.id must be lowercase kebab-case")

  const ingest = raw.ingest ?? {}
  const ingestUrl = requiredString(ingest.url, "ingest.url")
  let parsedUrl
  try { parsedUrl = new URL(ingestUrl) } catch { throw new Error("ingest.url must be an absolute HTTP(S) URL") }
  if (!["http:", "https:"].includes(parsedUrl.protocol)) throw new Error("ingest.url must use HTTP(S)")

  const auth = raw.auth ?? {}
  const sourceKeyId = requiredString(auth.source_key_id, "auth.source_key_id")
  const frontend = raw.frontend ?? {}
  const backend = raw.backend ?? {}
  const reliability = raw.reliability ?? {}
  const retry = reliability.retry ?? {}
  const frontendEnabled = optionalBoolean(frontend.enabled, "frontend.enabled")
  const backendEnabled = optionalBoolean(backend.enabled, "backend.enabled")
  if (!frontendEnabled && !backendEnabled) throw new Error("Enable frontend, backend, or both")

  const normalized = {
    apiVersion: raw.apiVersion,
    kind: raw.kind,
    host: { type: host.type, medusaVersion },
    source: { id: sourceId },
    ingest: { url: parsedUrl.toString().replace(/\/$/, "") },
    auth: { sourceKeyId },
    frontend: { enabled: frontendEnabled, events: [] },
    backend: { enabled: backendEnabled, binding: null },
    reliability: {
      failureMode: reliability.failure_mode ?? "fail_open",
      timeoutMs: optionalPositiveInteger(reliability.timeout_ms, "reliability.timeout_ms", 800),
      maxQueueSize: optionalPositiveInteger(reliability.max_queue_size, "reliability.max_queue_size", 200),
      retry: {
        maxAttempts: optionalPositiveInteger(retry.max_attempts, "reliability.retry.max_attempts", 3),
      },
    },
  }
  if (normalized.reliability.failureMode !== "fail_open") {
    throw new Error("reliability.failure_mode must be fail_open")
  }

  if (frontendEnabled) {
    normalized.auth.browserWriteKeyRef = secretReference(auth.browser_write_key_ref, "auth.browser_write_key_ref")
    const events = frontend.events
    if (!Array.isArray(events) || events.length === 0) throw new Error("frontend.events must be a non-empty list")
    for (const event of events) {
      if (!eventTypes.has(event)) throw new Error(`Unsupported frontend event '${event}'`)
    }
    normalized.frontend.events = [...new Set(events)]
  }

  if (backendEnabled) {
    normalized.auth.backendSigningKeyRef = secretReference(auth.backend_signing_key_ref, "auth.backend_signing_key_ref")
    if (backend.binding !== "medusa.order_placed") throw new Error("backend.binding must be medusa.order_placed")
    normalized.backend.binding = backend.binding
  }

  return normalized
}

export async function loadManifest(filePath) {
  const raw = parseManifestYaml(await readFile(filePath, "utf8"))
  return validateManifest(raw)
}
