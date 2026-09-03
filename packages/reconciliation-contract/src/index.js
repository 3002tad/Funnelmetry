import { createHash } from "node:crypto"

export const RECONCILIATION_MANIFEST_SPEC_VERSION = "reconciliation-manifest.v1"

export const RECONCILIATION_MODES = Object.freeze([
  "RECORD_LEVEL",
  "AGGREGATE_ONLY",
])

export const RECONCILIATION_WINDOW_STATES = Object.freeze([
  "PROVISIONAL",
  "RECONCILING",
  "RECONCILED",
  "DEGRADED",
])

export const RECONCILIATION_DISCREPANCY_KINDS = Object.freeze([
  "MISSING",
  "PHANTOM",
  "STATE_MISMATCH",
  "AMOUNT_MISMATCH",
])

export const RECONCILIATION_LIMITATION_REASONS = Object.freeze([
  "SNAPSHOT_NOT_CLOSED",
  "SNAPSHOT_INCOMPLETE",
  "AGGREGATE_ONLY",
])

const sourceIdPattern = /^[a-z0-9][a-z0-9-]{2,62}$/
const sha256Pattern = /^[a-f0-9]{64}$/
const currencyPattern = /^[A-Z]{3}$/
const decimalPattern = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/

function plainObject(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${field} must be an object`)
  }
  return value
}

function requiredString(value, field) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} must be a non-empty string`)
  return value.trim()
}

function timestamp(value, field) {
  const result = requiredString(value, field)
  if (Number.isNaN(Date.parse(result))) throw new Error(`${field} must be an ISO-8601 timestamp`)
  return new Date(result).toISOString()
}

function nonNegativeInteger(value, field) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${field} must be a non-negative integer`)
  return value
}

function boolean(value, field) {
  if (typeof value !== "boolean") throw new Error(`${field} must be a boolean`)
  return value
}

function decimal(value, field) {
  const result = requiredString(value, field)
  if (!decimalPattern.test(result)) throw new Error(`${field} must be a decimal string`)
  return result
}

function currency(value, field) {
  const result = requiredString(value, field)
  if (!currencyPattern.test(result)) throw new Error(`${field} must be an ISO-4217 currency code`)
  return result
}

function jsonValue(value, field, seen = new WeakSet()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`${field} must not contain a non-finite number`)
    return value
  }
  if (Array.isArray(value)) return value.map((item, index) => jsonValue(item, `${field}[${index}]`, seen))
  if (!value || typeof value !== "object") throw new Error(`${field} must contain JSON-compatible values`)
  if (seen.has(value)) throw new Error(`${field} must not contain circular data`)
  seen.add(value)
  const result = {}
  for (const key of Object.keys(value).sort()) result[key] = jsonValue(value[key], `${field}.${key}`, seen)
  seen.delete(value)
  return result
}

function optionalHash(value, field) {
  if (value === undefined) return undefined
  const hash = plainObject(value, field)
  if (hash.algorithm !== "sha256") throw new Error(`${field}.algorithm must be sha256`)
  const digest = requiredString(hash.value, `${field}.value`)
  if (!sha256Pattern.test(digest)) throw new Error(`${field}.value must be a lowercase SHA-256 hex digest`)
  if (!Array.isArray(hash.field_set) || hash.field_set.length === 0) {
    throw new Error(`${field}.field_set must be a non-empty array`)
  }
  const fieldSet = [...new Set(hash.field_set.map((item, index) => requiredString(item, `${field}.field_set[${index}]`)))].sort()
  if (fieldSet.length !== hash.field_set.length) throw new Error(`${field}.field_set must not contain duplicates`)
  return { algorithm: "sha256", value: digest, field_set: fieldSet }
}

function normalizeMoney(value, field) {
  const money = plainObject(value, field)
  return {
    currency: currency(money.currency, `${field}.currency`),
    amount: decimal(money.amount, `${field}.amount`),
  }
}

function normalizeRecord(value, index) {
  const field = `records[${index}]`
  const record = plainObject(value, field)
  const version = record.version === undefined ? undefined : requiredString(String(record.version), `${field}.version`)
  const updatedAt = record.updated_at === undefined ? undefined : timestamp(record.updated_at, `${field}.updated_at`)
  if (version === undefined && updatedAt === undefined) {
    throw new Error(`${field} must provide version or updated_at`)
  }
  const money = record.money === undefined ? undefined : normalizeMoney(record.money, `${field}.money`)
  const result = {
    entity_id: requiredString(record.entity_id, `${field}.entity_id`),
    current_status: requiredString(record.current_status, `${field}.current_status`),
    tombstone: record.tombstone === undefined ? false : boolean(record.tombstone, `${field}.tombstone`),
  }
  if (version !== undefined) result.version = version
  if (updatedAt !== undefined) result.updated_at = updatedAt
  if (record.occurred_at !== undefined) result.occurred_at = timestamp(record.occurred_at, `${field}.occurred_at`)
  if (record.committed_at !== undefined) result.committed_at = timestamp(record.committed_at, `${field}.committed_at`)
  if (money !== undefined) result.money = money
  const recordHash = optionalHash(record.record_hash, `${field}.record_hash`)
  if (recordHash !== undefined) result.record_hash = recordHash
  return result
}

function normalizeControlTotals(value) {
  const totals = plainObject(value, "control_totals")
  if (!Array.isArray(totals.amounts)) throw new Error("control_totals.amounts must be an array")
  const amounts = totals.amounts.map((item, index) => normalizeMoney(item, `control_totals.amounts[${index}]`))
    .sort((left, right) => left.currency.localeCompare(right.currency))
  if (new Set(amounts.map((item) => item.currency)).size !== amounts.length) {
    throw new Error("control_totals.amounts must contain at most one total per currency")
  }
  const result = {
    record_count: nonNegativeInteger(totals.record_count, "control_totals.record_count"),
    amounts,
  }
  const controlHash = optionalHash(totals.control_hash, "control_totals.control_hash")
  if (controlHash !== undefined) result.control_hash = controlHash
  return result
}

export function validateReconciliationManifest(input) {
  const value = plainObject(input, "ReconciliationManifest")
  if (value.reconciliation_schema_version !== RECONCILIATION_MANIFEST_SPEC_VERSION) {
    throw new Error(`reconciliation_schema_version must be ${RECONCILIATION_MANIFEST_SPEC_VERSION}`)
  }
  const sourceId = requiredString(value.source_id, "source_id")
  if (!sourceIdPattern.test(sourceId)) throw new Error("source_id must be lowercase kebab-case")
  const mode = requiredString(value.mode, "mode")
  if (!RECONCILIATION_MODES.includes(mode)) throw new Error("mode is unsupported")
  const coverage = plainObject(value.coverage, "coverage")
  const startAt = timestamp(coverage.start_at, "coverage.start_at")
  const endAt = timestamp(coverage.end_at, "coverage.end_at")
  if (Date.parse(startAt) >= Date.parse(endAt)) throw new Error("coverage.start_at must be before coverage.end_at")
  const asOf = timestamp(value.as_of, "as_of")
  if (Date.parse(endAt) > Date.parse(asOf)) throw new Error("coverage.end_at must not be after as_of")
  const closed = boolean(value.closed, "closed")
  const complete = boolean(value.complete, "complete")
  const closedAt = value.closed_at === undefined || value.closed_at === null
    ? null
    : timestamp(value.closed_at, "closed_at")
  if (closed !== (closedAt !== null)) throw new Error("closed_at must be present exactly when closed is true")
  const watermark = plainObject(value.watermark, "watermark")
  const watermarkAt = timestamp(watermark.at, "watermark.at")
  if (Date.parse(watermarkAt) > Date.parse(asOf)) throw new Error("watermark.at must not be after as_of")
  const records = value.records === undefined ? [] : value.records
  if (!Array.isArray(records)) throw new Error("records must be an array")
  if (mode === "AGGREGATE_ONLY" && records.length > 0) {
    throw new Error("aggregate-only manifest must not contain record-level data")
  }
  const normalizedRecords = records.map(normalizeRecord).sort((left, right) => left.entity_id.localeCompare(right.entity_id))
  if (new Set(normalizedRecords.map((record) => record.entity_id)).size !== normalizedRecords.length) {
    throw new Error("records must contain unique entity_id values")
  }
  const controlTotals = normalizeControlTotals(value.control_totals)
  if (mode === "RECORD_LEVEL" && controlTotals.record_count !== normalizedRecords.length) {
    throw new Error("control_totals.record_count must equal records.length for record-level manifests")
  }
  const result = {
    reconciliation_schema_version: RECONCILIATION_MANIFEST_SPEC_VERSION,
    snapshot_id: requiredString(value.snapshot_id, "snapshot_id"),
    source_id: sourceId,
    entity_type: requiredString(value.entity_type, "entity_type"),
    mode,
    as_of: asOf,
    coverage: {
      start_at: startAt,
      end_at: endAt,
      timezone: requiredString(coverage.timezone, "coverage.timezone"),
      scope: jsonValue(plainObject(coverage.scope, "coverage.scope"), "coverage.scope"),
    },
    closed,
    complete,
    closed_at: closedAt,
    watermark: {
      at: watermarkAt,
      grace_period_seconds: nonNegativeInteger(watermark.grace_period_seconds, "watermark.grace_period_seconds"),
    },
    source_schema_version: requiredString(value.source_schema_version, "source_schema_version"),
    semantic_version: requiredString(value.semantic_version, "semantic_version"),
    records: normalizedRecords,
    control_totals: controlTotals,
  }
  return Object.freeze(result)
}

export function assessReconciliationCapability(input) {
  const manifest = validateReconciliationManifest(input)
  let windowState = "RECONCILING"
  let limitationReason = null
  if (!manifest.closed) {
    windowState = "PROVISIONAL"
    limitationReason = "SNAPSHOT_NOT_CLOSED"
  } else if (!manifest.complete) {
    windowState = "DEGRADED"
    limitationReason = "SNAPSHOT_INCOMPLETE"
  } else if (manifest.mode === "AGGREGATE_ONLY") {
    windowState = "DEGRADED"
    limitationReason = "AGGREGATE_ONLY"
  }
  const recordLevelComparison = windowState === "RECONCILING"
  return Object.freeze({
    window_state: windowState,
    limitation_reason: limitationReason,
    aggregate_comparison_allowed: manifest.closed,
    record_level_comparison_allowed: recordLevelComparison,
    record_level_repair_allowed: recordLevelComparison,
  })
}

export function hashReconciliationManifest(input) {
  const manifest = validateReconciliationManifest(input)
  return createHash("sha256").update(JSON.stringify(manifest)).digest("hex")
}

function normalizeAnalyticsProjection(input) {
  const value = plainObject(input, "analytics_projection")
  const sourceId = requiredString(value.source_id, "analytics_projection.source_id")
  if (!sourceIdPattern.test(sourceId)) throw new Error("analytics_projection.source_id must be lowercase kebab-case")
  const coverage = plainObject(value.coverage, "analytics_projection.coverage")
  const records = value.records
  if (!Array.isArray(records)) throw new Error("analytics_projection.records must be an array")
  const normalizedRecords = records.map((record, index) => normalizeRecord(record, index))
    .sort((left, right) => left.entity_id.localeCompare(right.entity_id))
  if (new Set(normalizedRecords.map((record) => record.entity_id)).size !== normalizedRecords.length) {
    throw new Error("analytics_projection.records must contain unique entity_id values")
  }
  const controlTotals = normalizeControlTotals(value.control_totals)
  if (controlTotals.record_count !== normalizedRecords.length) {
    throw new Error("analytics_projection.control_totals.record_count must equal records.length")
  }
  return Object.freeze({
    source_id: sourceId,
    entity_type: requiredString(value.entity_type, "analytics_projection.entity_type"),
    as_of: timestamp(value.as_of, "analytics_projection.as_of"),
    coverage: {
      start_at: timestamp(coverage.start_at, "analytics_projection.coverage.start_at"),
      end_at: timestamp(coverage.end_at, "analytics_projection.coverage.end_at"),
      timezone: requiredString(coverage.timezone, "analytics_projection.coverage.timezone"),
      scope: jsonValue(
        plainObject(coverage.scope, "analytics_projection.coverage.scope"),
        "analytics_projection.coverage.scope",
      ),
    },
    records: normalizedRecords,
    control_totals: controlTotals,
  })
}

function rate(numerator, denominator) {
  return denominator === 0 ? null : numerator / denominator
}

function decimalParts(value) {
  const [integer, fraction = ""] = value.replace(/^-/, "").split(".")
  return {
    negative: value.startsWith("-"),
    coefficient: BigInt(`${integer}${fraction}`),
    scale: fraction.length,
  }
}

function alignDecimal(leftValue, rightValue) {
  const left = decimalParts(leftValue)
  const right = decimalParts(rightValue)
  const scale = Math.max(left.scale, right.scale)
  const signed = (part) => (part.negative ? -part.coefficient : part.coefficient)
    * (10n ** BigInt(scale - part.scale))
  return { left: signed(left), right: signed(right), scale }
}

function decimalString(coefficient, scale) {
  const negative = coefficient < 0n
  const absolute = (negative ? -coefficient : coefficient).toString().padStart(scale + 1, "0")
  if (scale === 0) return `${negative ? "-" : ""}${absolute}`
  const integer = absolute.slice(0, -scale)
  const fraction = absolute.slice(-scale).replace(/0+$/, "")
  return `${negative ? "-" : ""}${integer}${fraction ? `.${fraction}` : ""}`
}

function decimalEqual(left, right) {
  const aligned = alignDecimal(left, right)
  return aligned.left === aligned.right
}

function absoluteDecimalDifference(left, right) {
  const aligned = alignDecimal(left, right)
  const difference = aligned.left - aligned.right
  return decimalString(difference < 0n ? -difference : difference, aligned.scale)
}

function decimalRate(numerator, denominator, precision = 12) {
  const aligned = alignDecimal(numerator, denominator)
  const absoluteNumerator = aligned.left < 0n ? -aligned.left : aligned.left
  const absoluteDenominator = aligned.right < 0n ? -aligned.right : aligned.right
  if (absoluteDenominator === 0n) return null
  const scaled = (absoluteNumerator * (10n ** BigInt(precision))) / absoluteDenominator
  return decimalString(scaled, precision)
}

function moneyEqual(left, right) {
  if (!left || !right) return left === right
  return left.currency === right.currency && decimalEqual(left.amount, right.amount)
}

function amountMap(totals) {
  return new Map(totals.amounts.map((money) => [money.currency, money.amount]))
}

export function compareReconciliationEvidence({ manifest: manifestInput, analytics_projection: analyticsInput } = {}) {
  const manifest = validateReconciliationManifest(manifestInput)
  const capability = assessReconciliationCapability(manifest)
  if (!capability.aggregate_comparison_allowed) throw new Error("snapshot must be closed before comparison")
  const analytics = normalizeAnalyticsProjection(analyticsInput)
  if (analytics.source_id !== manifest.source_id) throw new Error("analytics projection source_id does not match snapshot")
  if (analytics.entity_type !== manifest.entity_type) throw new Error("analytics projection entity_type does not match snapshot")
  if (Date.parse(analytics.as_of) < Date.parse(manifest.as_of)) {
    throw new Error("analytics projection as_of must not be before snapshot as_of")
  }
  if (JSON.stringify(analytics.coverage) !== JSON.stringify(manifest.coverage)) {
    throw new Error("analytics projection coverage does not match snapshot")
  }

  const sourceCount = manifest.control_totals.record_count
  const analyticsCount = analytics.control_totals.record_count
  const sourceAmounts = amountMap(manifest.control_totals)
  const analyticsAmounts = amountMap(analytics.control_totals)
  const currencies = [...new Set([...sourceAmounts.keys(), ...analyticsAmounts.keys()])].sort()
  const revenueDeviation = currencies.map((currencyCode) => {
    const sourceAmount = sourceAmounts.get(currencyCode) ?? "0"
    const analyticsAmount = analyticsAmounts.get(currencyCode) ?? "0"
    const absoluteDeviation = absoluteDecimalDifference(sourceAmount, analyticsAmount)
    return {
      currency: currencyCode,
      source_amount: sourceAmount,
      analytics_amount: analyticsAmount,
      absolute_deviation: absoluteDeviation,
      deviation_rate: decimalRate(absoluteDeviation, sourceAmount),
      denominator_empty: decimalEqual(sourceAmount, "0"),
    }
  })
  const controlTotalMismatch = sourceCount !== analyticsCount
    || revenueDeviation.some((item) => !decimalEqual(item.absolute_deviation, "0"))

  const discrepancies = []
  let missingCount = null
  let phantomCount = null
  let stateMismatchCount = null
  let amountMismatchCount = null
  if (capability.record_level_comparison_allowed) {
    const sourceRecords = new Map(manifest.records.map((record) => [record.entity_id, record]))
    const analyticsRecords = new Map(analytics.records.map((record) => [record.entity_id, record]))
    for (const [entityId, sourceRecord] of sourceRecords) {
      const analyticsRecord = analyticsRecords.get(entityId)
      if (!analyticsRecord) {
        discrepancies.push({ kind: "MISSING", entity_id: entityId, source_record: sourceRecord, analytics_record: null })
        continue
      }
      if (sourceRecord.current_status !== analyticsRecord.current_status
        || sourceRecord.tombstone !== analyticsRecord.tombstone) {
        discrepancies.push({
          kind: "STATE_MISMATCH", entity_id: entityId,
          source_record: sourceRecord, analytics_record: analyticsRecord,
        })
      }
      if (!moneyEqual(sourceRecord.money, analyticsRecord.money)) {
        discrepancies.push({
          kind: "AMOUNT_MISMATCH", entity_id: entityId,
          source_record: sourceRecord, analytics_record: analyticsRecord,
        })
      }
    }
    for (const [entityId, analyticsRecord] of analyticsRecords) {
      if (!sourceRecords.has(entityId)) {
        discrepancies.push({ kind: "PHANTOM", entity_id: entityId, source_record: null, analytics_record: analyticsRecord })
      }
    }
    missingCount = discrepancies.filter((item) => item.kind === "MISSING").length
    phantomCount = discrepancies.filter((item) => item.kind === "PHANTOM").length
    stateMismatchCount = discrepancies.filter((item) => item.kind === "STATE_MISMATCH").length
    amountMismatchCount = discrepancies.filter((item) => item.kind === "AMOUNT_MISMATCH").length
  }

  const recordMismatch = discrepancies.length > 0
  const windowState = capability.window_state === "DEGRADED"
    ? "DEGRADED"
    : recordMismatch || controlTotalMismatch ? "RECONCILING" : "RECONCILED"
  const comparison = {
    source_id: manifest.source_id,
    snapshot_id: manifest.snapshot_id,
    entity_type: manifest.entity_type,
    source_as_of: manifest.as_of,
    analytics_as_of: analytics.as_of,
    window_state: windowState,
    limitation_reason: capability.limitation_reason,
    record_level_metrics_available: capability.record_level_comparison_allowed,
    source_count: sourceCount,
    analytics_count: analyticsCount,
    source_denominator_empty: sourceCount === 0,
    analytics_denominator_empty: analyticsCount === 0,
    control_total_mismatch: controlTotalMismatch,
    missing_count: missingCount,
    phantom_count: phantomCount,
    state_mismatch_count: stateMismatchCount,
    amount_mismatch_count: amountMismatchCount,
    missing_rate: missingCount === null ? null : rate(missingCount, sourceCount),
    phantom_rate: phantomCount === null ? null : rate(phantomCount, analyticsCount),
    state_mismatch_rate: stateMismatchCount === null ? null : rate(stateMismatchCount, sourceCount),
    amount_mismatch_rate: amountMismatchCount === null ? null : rate(amountMismatchCount, sourceCount),
    revenue_deviation: revenueDeviation,
    analytics_projection: analytics,
    discrepancies,
  }
  return Object.freeze({
    ...comparison,
    evidence_hash: createHash("sha256").update(JSON.stringify(comparison)).digest("hex"),
  })
}
