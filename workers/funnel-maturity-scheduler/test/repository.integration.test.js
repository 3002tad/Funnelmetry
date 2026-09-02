import { randomUUID } from "node:crypto"
import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import pg from "pg"
import { createFunnelMaturityRepository } from "../src/repository.js"

const databaseUrl = process.env.TEST_DATABASE_URL

test("records idempotent, revisioned maturity evidence without closing the funnel", { skip: !databaseUrl }, async () => {
  const schema = `maturity_${randomUUID().replaceAll("-", "")}`
  const admin = new pg.Pool({ connectionString: databaseUrl })
  await admin.query(`CREATE SCHEMA ${schema}`)
  const pool = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` })
  try {
    for (const migration of [
      "001_canonical_ledger.sql", "002_journey_projection.sql", "003_funnel_projection.sql",
      "006_funnel_maturity.sql",
    ]) {
      await pool.query(await readFile(new URL(`../../../infra/postgres/v2/${migration}`, import.meta.url), "utf8"))
    }
    await pool.query(
      `INSERT INTO funnel_profiles (
         funnel_profile_id, profile_version, display_name, subject_scope, entry_event_type,
         profile_document, conversion_horizon_seconds, late_arrival_grace_seconds, published_at
       ) VALUES ('commerce','1.0.0','Commerce','JOURNEY','behavior.product_viewed',
         '{}'::jsonb,3600,600,'2026-09-02T00:00:00Z')`,
    )
    await pool.query(
      `INSERT INTO funnel_profile_steps (
         funnel_profile_id, profile_version, step_index, step_id, event_type, event_class
       ) VALUES
         ('commerce','1.0.0',0,'view','behavior.product_viewed','BEHAVIOR_INTENT'),
         ('commerce','1.0.0',1,'cart','cart.item_added','BUSINESS_FACT')`,
    )
    await assert.rejects(
      () => pool.query(
        `INSERT INTO funnel_profile_transition_timeouts (
           funnel_profile_id, profile_version, next_step_id, timeout_seconds
         ) VALUES ('commerce','1.0.0','view',300)`,
      ),
      /after the entry step/,
    )
    await pool.query(
      `INSERT INTO funnel_profile_transition_timeouts (
         funnel_profile_id, profile_version, next_step_id, timeout_seconds
       ) VALUES ('commerce','1.0.0','cart',300)`,
    )
    const quality = { time_basis: "source_occurred", authoritative_event_time: true }
    const canonical = {
      canonical_event_id: "can-entry", source_id: "source-one", source_event_id: "source:entry",
      event_type: "behavior.product_viewed", event_class: "BEHAVIOR_INTENT",
      canonical_schema_version: "canonical-event.v1", mapping_version: "test-v1",
      occurred_at: "2026-09-02T00:00:00.000Z", ingested_at: "2026-09-02T00:00:01.000Z",
      normalized_at: "2026-09-02T00:00:02.000Z", data: {}, quality,
      source_reference: { raw_record_id: "raw-entry", content_hash: "a".repeat(64), byte_size: 10 },
    }
    await pool.query(
      `INSERT INTO canonical_events (
         canonical_event_id, source_id, source_event_id, event_type, event_class,
         canonical_schema_version, mapping_version, occurred_at, ingested_at, normalized_at,
         data, quality, raw_record_id, raw_content_hash, raw_byte_size, canonical_document
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'{}'::jsonb,$11::jsonb,$12,$13,10,$14::jsonb)`,
      [canonical.canonical_event_id, canonical.source_id, canonical.source_event_id,
        canonical.event_type, canonical.event_class, canonical.canonical_schema_version,
        canonical.mapping_version, canonical.occurred_at, canonical.ingested_at,
        canonical.normalized_at, JSON.stringify(quality), canonical.source_reference.raw_record_id,
        canonical.source_reference.content_hash, JSON.stringify(canonical)],
    )
    await pool.query(
      `INSERT INTO journeys (journey_id, source_id, first_event_at, last_event_at)
       VALUES ('journey-1','source-one','2026-09-02T00:00:00Z','2026-09-02T00:00:00Z')`,
    )
    await pool.query(
      `INSERT INTO funnel_instances (
         funnel_instance_id, source_id, journey_id, funnel_profile_id, profile_version,
         entry_event_id, entry_at, conversion_deadline
       ) VALUES ('funnel-1','source-one','journey-1','commerce','1.0.0','can-entry',
         '2026-09-02T00:00:00Z','2026-09-02T01:00:00Z')`,
    )
    await pool.query(
      `INSERT INTO funnel_instance_steps (
         funnel_instance_id, step_index, step_id, event_type, representative_event_id,
         first_reached_at, last_reached_at, occurrence_count, sequence_status
       ) VALUES ('funnel-1',0,'view','behavior.product_viewed','can-entry',
         '2026-09-02T00:00:00Z','2026-09-02T00:00:00Z',1,'IN_ORDER')`,
    )

    const repository = createFunnelMaturityRepository({ pool })
    const suspectedRequest = {
      evaluation_id: "evaluation-suspected", funnel_instance_id: "funnel-1",
      source_id: "source-one", evaluated_at: "2026-09-02T00:05:00.000Z",
    }
    const suspected = await repository.recordEvaluation(suspectedRequest)
    assert.equal(suspected.status, "recorded")
    assert.equal(suspected.evaluation_revision, 1)
    assert.equal(suspected.maturity_state, "SUSPECTED_DROPOFF")
    assert.equal(suspected.eligibility_status, "ELIGIBLE")
    assert.equal((await repository.recordEvaluation(suspectedRequest)).status, "duplicate")
    await assert.rejects(
      () => repository.recordEvaluation({ ...suspectedRequest, evaluated_at: "2026-09-02T00:06:00Z" }),
      /different immutable input/,
    )

    const matured = await repository.recordEvaluation({
      evaluation_id: "evaluation-matured", funnel_instance_id: "funnel-1",
      source_id: "source-one", evaluated_at: "2026-09-02T01:10:00.001Z",
    })
    assert.equal(matured.evaluation_revision, 2)
    assert.equal(matured.maturity_state, "MATURED")
    assert.equal(matured.finalization_at, "2026-09-02T01:10:00.000Z")
    await assert.rejects(
      () => repository.recordEvaluation({
        evaluation_id: "evaluation-stale", funnel_instance_id: "funnel-1",
        source_id: "source-one", evaluated_at: "2026-09-02T00:10:00Z",
      }),
      /older than the latest/,
    )

    const latest = await pool.query("SELECT * FROM funnel_instance_latest_maturity")
    assert.equal(latest.rows[0].evaluation_id, "evaluation-matured")
    assert.equal(latest.rows[0].maturity_state, "MATURED")
    await assert.rejects(
      () => pool.query(
        "UPDATE funnel_maturity_evaluations SET maturity_state = 'PENDING' WHERE evaluation_id = 'evaluation-matured'",
      ),
      /append-only/,
    )
    const instance = await pool.query("SELECT outcome_status, quality_status FROM funnel_instances")
    assert.deepEqual(instance.rows[0], { outcome_status: "IN_PROGRESS", quality_status: "PROVISIONAL" })

    await pool.query(
      `UPDATE funnel_instances
          SET outcome_status = 'CONVERTED', converted_at = '2026-09-02T00:30:00Z'
        WHERE funnel_instance_id = 'funnel-1'`,
    )
    const converted = await repository.recordEvaluation({
      evaluation_id: "evaluation-converted", funnel_instance_id: "funnel-1",
      source_id: "source-one", evaluated_at: "2026-09-02T01:11:00.000Z",
    })
    assert.equal(converted.maturity_state, "MATURED")
    assert.equal(converted.eligibility_status, "INELIGIBLE")
    assert.equal(converted.eligibility_reason, "OUTCOME_NOT_ELIGIBLE")
  } finally {
    await pool.end()
    await admin.query(`DROP SCHEMA ${schema} CASCADE`)
    await admin.end()
  }
})
