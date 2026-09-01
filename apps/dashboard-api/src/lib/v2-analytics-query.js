const SOURCE_ID_RE = /^[a-z0-9][a-z0-9-]{2,62}$/
const PROFILE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{1,127}$/
const VERSION_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
const EVENT_TYPE_RE = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/
const EVENT_CLASSES = new Set(["BEHAVIOR_INTENT", "CLIENT_OBSERVATION", "BUSINESS_FACT"])

function optionalTimestamp(value, field) {
  if (value === undefined || value === null || value === "") return null
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) throw new Error(`${field} must be an ISO-8601 timestamp`)
  return new Date(value).toISOString()
}

export function parseV2AnalyticsQuery(query = {}) {
  const sourceId = typeof query.source_id === "string" ? query.source_id.trim() : ""
  if (!SOURCE_ID_RE.test(sourceId)) throw new Error("source_id must be lowercase kebab-case")
  const from = optionalTimestamp(query.from, "from")
  const to = optionalTimestamp(query.to, "to")
  if (from && to && Date.parse(from) >= Date.parse(to)) throw new Error("from must be earlier than to")
  return Object.freeze({ sourceId, from, to })
}

export function parseProfileIdentity(profileIdInput, versionInput) {
  const profileId = typeof profileIdInput === "string" ? profileIdInput.trim() : ""
  if (!PROFILE_ID_RE.test(profileId)) throw new Error("funnel profile id is invalid")
  const version = typeof versionInput === "string" && versionInput.trim() ? versionInput.trim() : null
  if (version && !VERSION_RE.test(version)) throw new Error("profile_version is invalid")
  return Object.freeze({ profileId, version })
}

export function parseListLimit(value, fallback = 25, maximum = 100) {
  if (value === undefined || value === null || value === "") return fallback
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error("limit must be a positive integer")
  return Math.min(parsed, maximum)
}

export function parseJourneyId(value) {
  const journeyId = typeof value === "string" ? value.trim() : ""
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{2,191}$/.test(journeyId)) throw new Error("journey_id is invalid")
  return journeyId
}

export function parseEventFilters(query = {}) {
  const eventClass = typeof query.event_class === "string" && query.event_class.trim()
    ? query.event_class.trim().toUpperCase()
    : null
  if (eventClass && !EVENT_CLASSES.has(eventClass)) throw new Error("event_class is invalid")
  const eventType = typeof query.event_type === "string" && query.event_type.trim()
    ? query.event_type.trim()
    : null
  if (eventType && !EVENT_TYPE_RE.test(eventType)) throw new Error("event_type is invalid")
  return Object.freeze({ eventClass, eventType, limit: parseListLimit(query.limit, 50, 200) })
}
