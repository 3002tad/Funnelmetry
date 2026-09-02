import test from "node:test"
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"
import pg from "pg"
import { createV2AnalyticsRepository } from "../src/lib/v2-analytics-repository.js"

const databaseUrl = process.env.TEST_DATABASE_URL

test("reads V2 overview, funnel and privacy-safe journey projections from PostgreSQL", { skip: !databaseUrl }, async () => {
  const pool = new pg.Pool({ connectionString: databaseUrl })
  const runId = randomUUID()
  const sourceId = `integration-${runId}`
  const profileId = `commerce-${runId}`
  const canonicalEventId = `can-${runId}`
  const journeyId = `journey-${runId}`
  const funnelInstanceId = `funnel-${runId}`
  try {
    for (const migration of [
      "001_canonical_ledger.sql", "002_journey_projection.sql", "003_funnel_projection.sql",
      "004_kpi_projection.sql", "005_ingress_telemetry.sql", "006_funnel_maturity.sql",
      "007_maturity_finalization.sql", "008_late_conversion.sql",
    ]) {
      await pool.query(await readFile(new URL(`../../../infra/postgres/v2/${migration}`, import.meta.url), "utf8"))
    }
    await pool.query(
      `INSERT INTO funnel_profiles (
         funnel_profile_id, profile_version, display_name, subject_scope, entry_event_type,
         profile_document, published_at
       ) VALUES ($1,'1.0.0','Commerce','JOURNEY','behavior.product_viewed','{}'::jsonb,'2026-08-01Z')`,
      [profileId],
    )
    await pool.query(
      `INSERT INTO funnel_profile_steps (
         funnel_profile_id, profile_version, step_index, step_id, event_type, event_class
       ) VALUES ($1,'1.0.0',0,'view','behavior.product_viewed','BEHAVIOR_INTENT')`,
      [profileId],
    )
    await pool.query(
      `INSERT INTO funnel_profile_activations (source_id, funnel_profile_id, profile_version, enabled_at)
       VALUES ($1,$2,'1.0.0','2026-08-01Z')`,
      [sourceId, profileId],
    )
    const canonicalDocument = {
      canonical_event_id: canonicalEventId, source_id: sourceId, source_event_id: `source:${runId}`,
      event_type: "behavior.product_viewed", event_class: "BEHAVIOR_INTENT",
      canonical_schema_version: "canonical-event.v1", mapping_version: "test-v1",
      occurred_at: "2026-08-29T01:00:00.000Z", ingested_at: "2026-08-29T01:00:00.000Z",
      normalized_at: "2026-08-29T01:00:00.000Z", data: {},
      quality: { time_basis: "source_occurred", authoritative_event_time: true },
      source_reference: { raw_record_id: `raw-${runId}`, content_hash: "a".repeat(64), byte_size: 10 },
    }
    await pool.query(
      `INSERT INTO canonical_events (
         canonical_event_id, source_id, source_event_id, event_type, event_class,
         canonical_schema_version, mapping_version, occurred_at, ingested_at, normalized_at,
         data, quality, raw_record_id, raw_content_hash, raw_byte_size, canonical_document
       ) VALUES (
         $1,$2,$3,'behavior.product_viewed','BEHAVIOR_INTENT',
         'canonical-event.v1','test-v1','2026-08-29T01:00:00Z','2026-08-29T01:00:00Z',
         '2026-08-29T01:00:00Z','{}'::jsonb,$4::jsonb,$5,$6,10,$7::jsonb
       )`,
      [
        canonicalEventId,
        sourceId,
        `source:${runId}`,
        JSON.stringify(canonicalDocument.quality),
        `raw-${runId}`,
        "a".repeat(64),
        JSON.stringify(canonicalDocument),
      ],
    )
    const receiptDocument = {
      status: "accepted", source_id: sourceId, event_id: `source:${runId}`,
      ingestion_id: `ing-${runId}`, ingestion_attempt_id: `attempt-${runId}`,
      received_at: "2026-08-29T00:59:59.000Z",
    }
    const outcomeDocument = {
      source_id: sourceId, source_event_id: `source:${runId}`, status: "normalized",
      canonical_event_id: canonicalEventId, mapping_version: "test-v1",
      processed_at: "2026-08-29T01:00:00.000Z", raw_record_id: `raw-${runId}`,
    }
    await pool.query(
      `INSERT INTO ingress_accepted_receipts (
         source_id, event_id, ingestion_id, ingestion_attempt_id, received_at, receipt_document
       ) VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
      [sourceId, `source:${runId}`, `ing-${runId}`, `attempt-${runId}`,
        receiptDocument.received_at, JSON.stringify(receiptDocument)],
    )
    await pool.query(
      `INSERT INTO canonicalization_outcomes (
         source_id, source_event_id, mapping_version, status, canonical_event_id,
         processed_at, raw_record_id, outcome_document
       ) VALUES ($1,$2,'test-v1','normalized',$3,$4,$5,$6::jsonb)`,
      [sourceId, `source:${runId}`, canonicalEventId, outcomeDocument.processed_at,
        `raw-${runId}`, JSON.stringify(outcomeDocument)],
    )
    await pool.query(
      `INSERT INTO journeys (journey_id, source_id, first_event_at, last_event_at, event_count)
       VALUES ($1,$2,'2026-08-29T01:00:00Z','2026-08-29T01:00:00Z',1)`,
      [journeyId, sourceId],
    )
    await pool.query(
      `INSERT INTO journey_events (
         canonical_event_id, journey_id, event_type, occurred_at, link_method, link_confidence, linked_at
       ) VALUES ($1,$2,'behavior.product_viewed','2026-08-29T01:00:00Z','NEW_JOURNEY','ISOLATED','2026-08-29T01:00:01Z')`,
      [canonicalEventId, journeyId],
    )
    await pool.query(
      `INSERT INTO funnel_instances (
         funnel_instance_id, source_id, journey_id, funnel_profile_id, profile_version,
         entry_event_id, entry_at, outcome_status, quality_status, converted_at
       ) VALUES (
         $1,$2,$3,$4,'1.0.0',$5,
         '2026-08-29T01:00:00Z','CONVERTED','PROVISIONAL','2026-08-29T01:00:00Z'
       )`,
      [funnelInstanceId, sourceId, journeyId, profileId, canonicalEventId],
    )
    await pool.query(
      `INSERT INTO funnel_instance_steps (
         funnel_instance_id, step_index, step_id, event_type, representative_event_id,
         first_reached_at, last_reached_at, occurrence_count, sequence_status
       ) VALUES (
         $1,0,'view','behavior.product_viewed',$2,
         '2026-08-29T01:00:00Z','2026-08-29T01:00:00Z',1,'IN_ORDER'
       )`,
      [funnelInstanceId, canonicalEventId],
    )
    await pool.query(
      `INSERT INTO funnel_kpi_instance_facts (
         funnel_instance_id, source_id, journey_id, funnel_profile_id, profile_version,
         entry_at, outcome_status, quality_status, converted_at, reached_step_count,
         total_step_count, branch_count, latest_trigger_event_id, projection_hash, projected_at
       ) VALUES (
         $1,$2,$3,$4,'1.0.0','2026-08-29T01:00:00Z',
         'CONVERTED','PROVISIONAL','2026-08-29T01:00:00Z',1,1,0,$5,$6,'2026-08-29T01:00:02Z'
       )`,
      [funnelInstanceId, sourceId, journeyId, profileId, canonicalEventId, "b".repeat(64)],
    )
    await pool.query(
      `INSERT INTO funnel_kpi_step_facts (
         funnel_instance_id, step_index, step_id, event_type, first_reached_at, last_reached_at, occurrence_count
       ) VALUES ($1,0,'view','behavior.product_viewed','2026-08-29T01:00:00Z','2026-08-29T01:00:00Z',1)`,
      [funnelInstanceId],
    )

    const repository = createV2AnalyticsRepository({ query: async (sql, params) => (await pool.query(sql, params)).rows })
    const scope = { sourceId, from: "2026-08-01T00:00:00.000Z", to: null }
    const overview = await repository.getOverview(scope)
    assert.equal(overview.profiles[0].observed_end_to_end_rate, 1)
    assert.equal(overview.profiles[0].provisional, 1)
    const funnel = await repository.getFunnel(scope, { profileId, version: "1.0.0" })
    assert.equal(funnel.steps[0].observed_reach_rate, 1)
    const journeys = await repository.listJourneys({ sourceId, limit: 10 })
    assert.equal(journeys[0].funnel_instances[0].outcome_status, "CONVERTED")
    const journey = await repository.getJourney(sourceId, journeyId)
    assert.equal(journey.events[0].event_type, "behavior.product_viewed")
    assert.equal("data" in journey.events[0], false)
    const events = await repository.listEvents(scope, { eventClass: "BEHAVIOR_INTENT", eventType: null, limit: 10 })
    assert.equal(events[0].canonical_event_id, canonicalEventId)
    assert.equal(events[0].authoritative_event_time, true)
    assert.equal("canonical_document" in events[0], false)
    const health = await repository.getDataHealth(scope)
    assert.equal(health.canonical.events, 1)
    assert.equal(health.canonical.authoritative_event_time_rate, 1)
    assert.equal(health.canonicalization.accepted_events, 1)
    assert.equal(health.canonicalization.terminal_outcome_rate, 1)
    assert.equal(health.canonicalization.normalized, 1)
    assert.equal(health.projection_quality.provisional, 1)
    assert.ok(health.unavailable_metrics.includes("event_loss_rate"))
  } finally {
    await pool.end()
  }
})
