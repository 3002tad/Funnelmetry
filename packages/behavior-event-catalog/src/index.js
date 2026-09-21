export const BEHAVIOR_EVENT_CATALOG_VERSION = "behavior-event-catalog.v2"
export const BEHAVIOR_SOURCE_SCHEMA_VERSION = "2.0"

export const BEHAVIOR_EVENT_DEFINITIONS = Object.freeze({
  "behavior.page_viewed": Object.freeze({ event_class: "CLIENT_OBSERVATION", producer: "browser" }),
  "behavior.scroll_depth_reached": Object.freeze({ event_class: "CLIENT_OBSERVATION", producer: "browser" }),
  "promotion.banner_impression": Object.freeze({ event_class: "CLIENT_OBSERVATION", producer: "browser" }),
  "promotion.banner_clicked": Object.freeze({ event_class: "BEHAVIOR_INTENT", producer: "browser" }),
  "behavior.search_submitted": Object.freeze({ event_class: "BEHAVIOR_INTENT", producer: "source_server" }),
  "behavior.filter_applied": Object.freeze({ event_class: "BEHAVIOR_INTENT", producer: "browser" }),
  "behavior.product_viewed": Object.freeze({ event_class: "BEHAVIOR_INTENT", producer: "browser" }),
  "checkout.started": Object.freeze({ event_class: "BEHAVIOR_INTENT", producer: "browser" }),
})

export const BEHAVIOR_EVENT_TYPES = Object.freeze(Object.keys(BEHAVIOR_EVENT_DEFINITIONS))
export const SCROLL_DEPTH_MILESTONES = Object.freeze([25, 50, 75, 100])

const forbiddenPayloadKeys = new Set([
  "address",
  "card_number",
  "cvv",
  "dom_text",
  "email",
  "href",
  "page_url",
  "password",
  "payment_token",
  "phone",
  "query",
  "raw_dom_text",
  "raw_query",
  "search_query",
  "target_url",
  "url",
])

const pageInstancePattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/
const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const filterKeyPattern = /^[a-z][a-z0-9_]{0,63}$/
const searchOutcomes = new Set(["succeeded", "failed"])
const normalizedSearchQueryMaxLength = 160

function plainObject(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${field} must be an object`)
  return value
}

function requiredString(value, field, { pattern = identifierPattern, maxLength = 128 } = {}) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} must be a non-empty string`)
  const normalized = value.trim()
  if (normalized.length > maxLength) throw new Error(`${field} exceeds ${maxLength} characters`)
  if (pattern && !pattern.test(normalized)) throw new Error(`${field} has unsupported characters`)
  return normalized
}

function optionalString(value, field, options) {
  return value === undefined ? undefined : requiredString(value, field, options)
}

function nonNegativeInteger(value, field) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${field} must be a non-negative integer`)
  return value
}

function finiteNumber(value, field) {
  if (!Number.isFinite(value)) throw new Error(`${field} must be a finite number`)
  return value
}

function assertKnownFields(payload, allowedFields, eventType) {
  for (const key of Object.keys(payload)) {
    const lowered = key.toLowerCase()
    if (forbiddenPayloadKeys.has(lowered)) {
      throw new Error(`${eventType} payload must not contain privacy-restricted field '${key}'`)
    }
    if (!allowedFields.has(key)) throw new Error(`${eventType} payload has unsupported field '${key}'`)
  }
}

function pageType(value) {
  return requiredString(value, "page_type", { pattern: /^[a-z][a-z0-9_]{0,63}$/ })
}

function pageInstanceId(value) {
  return requiredString(value, "page_instance_id", { pattern: pageInstancePattern })
}

function pathTemplate(value) {
  if (typeof value !== "string" || !value.startsWith("/") || value.length > 256) {
    throw new Error("path_template must be an absolute route template up to 256 characters")
  }
  if (value.includes("?") || value.includes("#")) throw new Error("path_template must not contain query or fragment")
  return value
}

function id(value, field) {
  return requiredString(value, field)
}

function optionalId(value, field) {
  return optionalString(value, field)
}

function normalizedSearchQuery(value) {
  if (typeof value !== "string") throw new Error("query_normalized must be a string")
  const normalized = value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase()
  if (!normalized) throw new Error("query_normalized must be non-empty")
  if (normalized.length > normalizedSearchQueryMaxLength) {
    throw new Error(`query_normalized exceeds ${normalizedSearchQueryMaxLength} characters`)
  }
  if (normalized !== value) {
    throw new Error("query_normalized must be normalized with NFKC, trim, collapsed whitespace, and lowercase")
  }
  if (/\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/iu.test(normalized)) {
    throw new Error("query_normalized must not contain an email address")
  }
  if (/(?:\+?\d[\s().-]*){8,}/u.test(normalized)) {
    throw new Error("query_normalized must not contain a phone or payment number")
  }
  if (/\b(?:password|passcode|otp|cvv|cvc|card(?:\s*number)?|token|secret)\b/iu.test(normalized)) {
    throw new Error("query_normalized must not contain credential or payment data")
  }
  return normalized
}

function normalizeFilterKeys(value) {
  if (!Array.isArray(value) || value.length > 20) throw new Error("filter_keys must be an array with at most 20 items")
  const normalized = value.map((key) => requiredString(key, "filter_keys[]", { pattern: filterKeyPattern, maxLength: 64 }))
  if (new Set(normalized).size !== normalized.length) throw new Error("filter_keys must not contain duplicates")
  return Object.freeze(normalized)
}

function pageViewed(payload) {
  assertKnownFields(payload, new Set(["page_type", "path_template", "page_instance_id"]), "behavior.page_viewed")
  return Object.freeze({
    page_type: pageType(payload.page_type),
    path_template: pathTemplate(payload.path_template),
    page_instance_id: pageInstanceId(payload.page_instance_id),
  })
}

function scrollDepthReached(payload) {
  assertKnownFields(payload, new Set(["page_type", "page_instance_id", "depth_percent"]), "behavior.scroll_depth_reached")
  const depthPercent = finiteNumber(payload.depth_percent, "depth_percent")
  if (!SCROLL_DEPTH_MILESTONES.includes(depthPercent)) {
    throw new Error(`depth_percent must be one of ${SCROLL_DEPTH_MILESTONES.join(", ")}`)
  }
  return Object.freeze({
    page_type: pageType(payload.page_type),
    page_instance_id: pageInstanceId(payload.page_instance_id),
    depth_percent: depthPercent,
  })
}

function bannerImpression(payload) {
  assertKnownFields(payload, new Set(["banner_id", "placement_id", "page_instance_id", "visible_percent", "visible_ms", "campaign_id"]), "promotion.banner_impression")
  const visiblePercent = finiteNumber(payload.visible_percent, "visible_percent")
  const visibleMs = nonNegativeInteger(payload.visible_ms, "visible_ms")
  if (visiblePercent < 50 || visiblePercent > 100) throw new Error("visible_percent must be between 50 and 100")
  if (visibleMs < 1_000) throw new Error("visible_ms must be at least 1000 for an impression")
  const result = {
    banner_id: id(payload.banner_id, "banner_id"),
    placement_id: id(payload.placement_id, "placement_id"),
    page_instance_id: pageInstanceId(payload.page_instance_id),
    visible_percent: visiblePercent,
    visible_ms: visibleMs,
  }
  const campaignId = optionalId(payload.campaign_id, "campaign_id")
  if (campaignId) result.campaign_id = campaignId
  return Object.freeze(result)
}

function bannerClicked(payload) {
  assertKnownFields(payload, new Set(["banner_id", "placement_id", "page_instance_id", "campaign_id", "target_id"]), "promotion.banner_clicked")
  const result = {
    banner_id: id(payload.banner_id, "banner_id"),
    placement_id: id(payload.placement_id, "placement_id"),
    page_instance_id: pageInstanceId(payload.page_instance_id),
  }
  const campaignId = optionalId(payload.campaign_id, "campaign_id")
  const targetId = optionalId(payload.target_id, "target_id")
  if (campaignId) result.campaign_id = campaignId
  if (targetId) result.target_id = targetId
  return Object.freeze(result)
}

function searchSubmitted(payload) {
  assertKnownFields(payload, new Set(["search_interaction_id", "query_normalized", "outcome", "result_count"]), "behavior.search_submitted")
  const outcome = requiredString(payload.outcome, "outcome", { pattern: null, maxLength: 16 })
  if (!searchOutcomes.has(outcome)) throw new Error("outcome is unsupported")
  const result = {
    search_interaction_id: id(payload.search_interaction_id, "search_interaction_id"),
    query_normalized: normalizedSearchQuery(payload.query_normalized),
    outcome,
  }
  if (outcome === "succeeded") {
    result.result_count = nonNegativeInteger(payload.result_count, "result_count")
  } else if (payload.result_count !== undefined) {
    throw new Error("result_count is only allowed when outcome is succeeded")
  }
  return Object.freeze(result)
}

function filterApplied(payload) {
  assertKnownFields(payload, new Set(["page_instance_id", "filter_keys", "active_filter_count"]), "behavior.filter_applied")
  const filterKeys = normalizeFilterKeys(payload.filter_keys)
  const activeFilterCount = nonNegativeInteger(payload.active_filter_count, "active_filter_count")
  if (activeFilterCount > 0 && filterKeys.length === 0) {
    throw new Error("filter_keys must identify active filters")
  }
  return Object.freeze({
    page_instance_id: pageInstanceId(payload.page_instance_id),
    filter_keys: filterKeys,
    active_filter_count: activeFilterCount,
  })
}

function productViewed(payload) {
  assertKnownFields(payload, new Set(["product_id", "page_instance_id", "variant_id"]), "behavior.product_viewed")
  const result = {
    product_id: id(payload.product_id, "product_id"),
    page_instance_id: pageInstanceId(payload.page_instance_id),
  }
  const variantId = optionalId(payload.variant_id, "variant_id")
  if (variantId) result.variant_id = variantId
  return Object.freeze(result)
}

function checkoutStarted(payload) {
  assertKnownFields(payload, new Set(["cart_id", "step", "page_instance_id"]), "checkout.started")
  const result = {
    cart_id: id(payload.cart_id, "cart_id"),
    step: requiredString(payload.step, "step", { pattern: /^[a-z][a-z0-9_]{0,63}$/, maxLength: 64 }),
  }
  const pageId = optionalString(payload.page_instance_id, "page_instance_id", { pattern: pageInstancePattern })
  if (pageId) result.page_instance_id = pageId
  return Object.freeze(result)
}

const payloadValidators = Object.freeze({
  "behavior.page_viewed": pageViewed,
  "behavior.scroll_depth_reached": scrollDepthReached,
  "promotion.banner_impression": bannerImpression,
  "promotion.banner_clicked": bannerClicked,
  "behavior.search_submitted": searchSubmitted,
  "behavior.filter_applied": filterApplied,
  "behavior.product_viewed": productViewed,
  "checkout.started": checkoutStarted,
})

export function isBehaviorEventType(eventType) {
  return typeof eventType === "string" && Object.hasOwn(BEHAVIOR_EVENT_DEFINITIONS, eventType)
}

export function getBehaviorEventDefinition(eventType) {
  if (!isBehaviorEventType(eventType)) throw new Error(`Unsupported behavior event type '${eventType}'`)
  return BEHAVIOR_EVENT_DEFINITIONS[eventType]
}

export function validateBehaviorPayload(eventType, payload) {
  if (!isBehaviorEventType(eventType)) throw new Error(`Unsupported behavior event type '${eventType}'`)
  return payloadValidators[eventType](plainObject(payload, `${eventType} payload`))
}

export function validateBehaviorEvent(eventType, payload) {
  const definition = getBehaviorEventDefinition(eventType)
  return Object.freeze({
    catalog_version: BEHAVIOR_EVENT_CATALOG_VERSION,
    event_type: eventType,
    event_class: definition.event_class,
    data: validateBehaviorPayload(eventType, payload),
  })
}
