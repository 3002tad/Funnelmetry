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
const cdcShadowTables = [
  "public.order:id,deleted_at",
  "public.order_cart:id,order_id,cart_id",
  "public.cart:id,completed_at",
]
const cdcCatalogTables = [
  "public.product:id,title,handle,status,collection_id,updated_at,deleted_at",
  "public.product_variant:id,product_id,title,sku,manage_inventory,allow_backorder,updated_at,deleted_at",
  "public.product_category:id,name,parent_category_id,is_active,is_internal,updated_at,deleted_at",
  "public.product_category_product:product_id,product_category_id",
]

function cdcIdentifier(value, name) {
  const result = requiredString(value, name)
  if (!/^[a-z][a-z0-9_]{2,62}$/.test(result)) throw new Error(`${name} must be a PostgreSQL/Kafka-safe identifier`)
  return result
}

function cdcShadowProfile(value) {
  if (value === undefined) return null
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("cdc_shadow must be a mapping")
  const supportedKeys = new Set([
    "mode", "profile", "source_db_url_ref", "source_owner", "pipeline_owner",
    "snapshot_mode", "publication", "slot", "topic_prefix", "fact_topic",
    "table_columns", "rollback_target",
  ])
  const unknownKeys = Object.keys(value).filter(key => !supportedKeys.has(key))
  if (unknownKeys.length) throw new Error(`Unsupported cdc_shadow field(s): ${unknownKeys.join(", ")}`)
  if (value.profile !== "reference.medusa.order_recorded_state.v1") {
    throw new Error("cdc_shadow.profile must be reference.medusa.order_recorded_state.v1")
  }
  if (value.mode !== "shadow_only" || value.snapshot_mode !== "no_data" ||
      value.rollback_target !== "native_order_placed") {
    throw new Error("cdc_shadow requires shadow_only, no_data, and native_order_placed rollback target")
  }
  if (!Array.isArray(value.table_columns) || value.table_columns.length !== cdcShadowTables.length ||
      new Set(value.table_columns).size !== cdcShadowTables.length ||
      cdcShadowTables.some(table => !value.table_columns.includes(table))) {
    throw new Error("cdc_shadow.table_columns must be the exact reference order-state allowlist")
  }
  const factTopic = requiredString(value.fact_topic, "cdc_shadow.fact_topic")
  if (factTopic !== "cdc_shadow_reference.order_recorded_state.v1" ||
      value.topic_prefix !== "cdc_shadow_medusa" ||
      value.publication !== "funnelmetry_cdc_shadow" ||
      value.slot !== "funnelmetry_cdc_shadow") {
    throw new Error("cdc_shadow topic, publication, and slot must match the pinned reference shadow runtime")
  }
  return {
    mode: value.mode,
    profile: value.profile,
    sourceDbUrlRef: secretReference(value.source_db_url_ref, "cdc_shadow.source_db_url_ref"),
    sourceOwner: requiredString(value.source_owner, "cdc_shadow.source_owner"),
    pipelineOwner: requiredString(value.pipeline_owner, "cdc_shadow.pipeline_owner"),
    snapshotMode: value.snapshot_mode,
    publication: cdcIdentifier(value.publication, "cdc_shadow.publication"),
    slot: cdcIdentifier(value.slot, "cdc_shadow.slot"),
    topicPrefix: cdcIdentifier(value.topic_prefix, "cdc_shadow.topic_prefix"),
    factTopic,
    tableColumns: cdcShadowTables,
    rollbackTarget: value.rollback_target,
  }
}

function cdcCatalogProfile(value) {
  if (value === undefined) return null
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("cdc_catalog_shadow must be a mapping")
  const supported = new Set(["mode", "profile", "source_db_url_ref", "source_owner",
    "pipeline_owner", "snapshot_mode", "publication", "slot", "topic_prefix", "table_columns"])
  const unknown = Object.keys(value).filter(key => !supported.has(key))
  if (unknown.length) throw new Error(`Unsupported cdc_catalog_shadow field(s): ${unknown.join(", ")}`)
  if (value.mode !== "shadow_only" || value.profile !== "reference.medusa.catalog_master_data.v1" ||
      value.snapshot_mode !== "initial") {
    throw new Error("cdc_catalog_shadow requires separate catalog_master_data.v1, shadow_only and initial snapshot")
  }
  if (value.publication !== "funnelmetry_cdc_catalog_shadow" ||
      value.slot !== "funnelmetry_cdc_catalog_shadow" ||
      value.topic_prefix !== "cdc_shadow_medusa_catalog") {
    throw new Error("cdc_catalog_shadow needs its own pinned publication, slot and topic prefix")
  }
  if (!Array.isArray(value.table_columns) || value.table_columns.length !== cdcCatalogTables.length ||
      new Set(value.table_columns).size !== cdcCatalogTables.length ||
      cdcCatalogTables.some(table => !value.table_columns.includes(table))) {
    throw new Error("cdc_catalog_shadow.table_columns must match the exact catalog stage-1 allowlist")
  }
  return {
    mode: value.mode,
    profile: value.profile,
    sourceDbUrlRef: secretReference(value.source_db_url_ref, "cdc_catalog_shadow.source_db_url_ref"),
    sourceOwner: requiredString(value.source_owner, "cdc_catalog_shadow.source_owner"),
    pipelineOwner: requiredString(value.pipeline_owner, "cdc_catalog_shadow.pipeline_owner"),
    snapshotMode: value.snapshot_mode,
    publication: cdcIdentifier(value.publication, "cdc_catalog_shadow.publication"),
    slot: cdcIdentifier(value.slot, "cdc_catalog_shadow.slot"),
    topicPrefix: cdcIdentifier(value.topic_prefix, "cdc_catalog_shadow.topic_prefix"),
    tableColumns: cdcCatalogTables,
  }
}

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
    cdcShadow: cdcShadowProfile(raw.cdc_shadow),
    cdcCatalogShadow: cdcCatalogProfile(raw.cdc_catalog_shadow),
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
