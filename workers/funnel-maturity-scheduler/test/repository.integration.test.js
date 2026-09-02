import { randomUUID } from "node:crypto"
import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import pg from "pg"
import { buildKpiSnapshot, hashKpiSnapshot } from "@funnelmetry/kpi-snapshot-contract"
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
      "004_kpi_projection.sql", "006_funnel_maturity.sql", "007_maturity_finalization.sql",
      "008_late_conversion.sql", "009_matured_conversion.sql",
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
    async function seedConvertedFunnel(suffix, conversionQuality = quality) {
      const entryId = `can-${suffix}-entry`
      const conversionId = `can-${suffix}-conversion`
      for (const [eventId, eventType, eventClass, occurredAt, eventQuality] of [
        [entryId, "behavior.product_viewed", "BEHAVIOR_INTENT", "2026-09-02T00:00:00Z", quality],
        [conversionId, "cart.item_added", "BUSINESS_FACT", "2026-09-02T00:10:00Z", conversionQuality],
      ]) {
        await pool.query(
          `INSERT INTO canonical_events (
             canonical_event_id, source_id, source_event_id, event_type, event_class,
             canonical_schema_version, mapping_version, occurred_at, ingested_at, normalized_at,
             data, quality, raw_record_id, raw_content_hash, raw_byte_size, canonical_document
           ) VALUES ($1,'source-one',$2,$3,$4,'canonical-event.v1','test-v1',$5,$5,$5,
                     '{}'::jsonb,$6::jsonb,$7,$8,10,$9::jsonb)`,
          [eventId, `source:${eventId}`, eventType, eventClass, occurredAt,
            JSON.stringify(eventQuality), `raw-${eventId}`, "d".repeat(64),
            JSON.stringify({ canonical_event_id: eventId, quality: eventQuality })],
        )
      }
      await pool.query(
        `INSERT INTO journeys (journey_id, source_id, first_event_at, last_event_at, event_count)
         VALUES ($1,'source-one','2026-09-02T00:00:00Z','2026-09-02T00:10:00Z',2)`,
        [`journey-${suffix}`],
      )
      await pool.query(
        `INSERT INTO funnel_instances (
           funnel_instance_id, source_id, journey_id, funnel_profile_id, profile_version,
           entry_event_id, entry_at, conversion_deadline, outcome_status, converted_at
         ) VALUES ($1,'source-one',$2,'commerce','1.0.0',$3,'2026-09-02T00:00:00Z',
                   '2026-09-02T01:00:00Z','CONVERTED','2026-09-02T00:10:00Z')`,
        [`funnel-${suffix}`, `journey-${suffix}`, entryId],
      )
      await pool.query(
        `INSERT INTO funnel_instance_steps (
           funnel_instance_id, step_index, step_id, event_type, representative_event_id,
           first_reached_at, last_reached_at, occurrence_count, sequence_status
         ) VALUES
           ($1,0,'view','behavior.product_viewed',$2,'2026-09-02T00:00:00Z','2026-09-02T00:00:00Z',1,'IN_ORDER'),
           ($1,1,'cart','cart.item_added',$3,'2026-09-02T00:10:00Z','2026-09-02T00:10:00Z',1,'IN_ORDER')`,
        [`funnel-${suffix}`, entryId, conversionId],
      )
    }
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
    const initiallyDue = await repository.listDueCandidates({
      observed_at: "2026-09-02T00:05:00.000Z", limit: 10,
    })
    assert.deepEqual(initiallyDue, [{
      funnel_instance_id: "funnel-1", source_id: "source-one",
      target_state: "SUSPECTED_DROPOFF", next_step_id: "cart",
      due_at: "2026-09-02T00:05:00.000Z",
    }])
    const suspectedRequest = {
      evaluation_id: "evaluation-suspected", funnel_instance_id: "funnel-1",
      source_id: "source-one", evaluated_at: "2026-09-02T00:05:00.000Z",
    }
    const suspected = await repository.recordEvaluation(suspectedRequest)
    assert.equal(suspected.status, "recorded")
    assert.equal(suspected.evaluation_revision, 1)
    assert.equal(suspected.maturity_state, "SUSPECTED_DROPOFF")
    assert.equal(suspected.eligibility_status, "ELIGIBLE")
    assert.deepEqual(await repository.listDueCandidates({
      observed_at: "2026-09-02T00:06:00.000Z", limit: 10,
    }), [])
    assert.equal((await repository.recordEvaluation(suspectedRequest)).status, "duplicate")
    await assert.rejects(
      () => repository.recordEvaluation({ ...suspectedRequest, evaluated_at: "2026-09-02T00:06:00Z" }),
      /different immutable input/,
    )

    const maturedCandidates = await repository.listDueCandidates({
      observed_at: "2026-09-02T01:10:00.001Z", limit: 10,
    })
    assert.equal(maturedCandidates[0].target_state, "MATURED")
    assert.equal(maturedCandidates[0].due_at, "2026-09-02T01:10:00.000Z")
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

    assert.equal((await repository.listPendingFinalizations({ limit: 10 }))[0].evaluation_id, "evaluation-matured")
    await assert.rejects(
      () => repository.finalizeDropoff({
        finalization_id: "finalization-before-kpi", evaluation_id: "evaluation-matured",
        finalized_at: "2026-09-02T01:10:01.000Z",
      }),
      /KPI projection has not caught up/,
    )
    assert.equal((await pool.query(
      "SELECT outcome_status FROM funnel_instances WHERE funnel_instance_id = 'funnel-1'",
    )).rows[0].outcome_status, "IN_PROGRESS")
    const kpiSnapshot = buildKpiSnapshot({
      funnel_instance_id: "funnel-1", source_id: "source-one", journey_id: "journey-1",
      funnel_profile_id: "commerce", profile_version: "1.0.0",
      entry_at: "2026-09-02T00:00:00Z", conversion_deadline: "2026-09-02T01:00:00Z",
      outcome_status: "IN_PROGRESS", quality_status: "PROVISIONAL", converted_at: null,
      total_step_count: 2,
    }, [{
      step_index: 0, step_id: "view", event_type: "behavior.product_viewed",
      first_reached_at: "2026-09-02T00:00:00Z", last_reached_at: "2026-09-02T00:00:00Z",
      occurrence_count: 1,
    }], [])
    await pool.query(
      `INSERT INTO funnel_kpi_instance_facts (
         funnel_instance_id, source_id, journey_id, funnel_profile_id, profile_version,
         entry_at, conversion_deadline, outcome_status, quality_status, converted_at,
         reached_step_count, total_step_count, branch_count, latest_trigger_event_id,
         latest_projection_kind, latest_projection_id, projection_hash, projected_at
       ) VALUES ('funnel-1','source-one','journey-1','commerce','1.0.0',
         '2026-09-02T00:00:00Z','2026-09-02T01:00:00Z','IN_PROGRESS','PROVISIONAL',NULL,
         1,2,0,'can-entry','CANONICAL_EVENT','can-entry',$1,'2026-09-02T01:00:00Z')`,
      [hashKpiSnapshot(kpiSnapshot)],
    )
    const finalized = await repository.finalizeDropoff({
      finalization_id: "finalization-1", evaluation_id: "evaluation-matured",
      finalized_at: "2026-09-02T01:10:01.000Z",
    })
    assert.equal(finalized.status, "finalized")
    assert.equal(finalized.outcome_status, "DROPPED")
    assert.equal(finalized.kpi_projection_revision, 2)
    assert.equal((await repository.finalizeDropoff({
      finalization_id: "finalization-1", evaluation_id: "evaluation-matured",
      finalized_at: "2026-09-02T01:10:01.000Z",
    })).status, "duplicate")
    assert.deepEqual(await repository.listPendingFinalizations({ limit: 10 }), [])
    const finalizedState = await pool.query(
      `SELECT instance.outcome_status, fact.outcome_status AS kpi_outcome_status,
              fact.projection_revision, fact.latest_projection_kind
         FROM funnel_instances instance
         JOIN funnel_kpi_instance_facts fact USING (funnel_instance_id)`,
    )
    assert.deepEqual(finalizedState.rows[0], {
      outcome_status: "DROPPED", kpi_outcome_status: "DROPPED",
      projection_revision: "2", latest_projection_kind: "MATURITY_FINALIZATION",
    })
    await assert.rejects(
      () => pool.query("DELETE FROM funnel_maturity_finalizations WHERE finalization_id = 'finalization-1'"),
      /append-only/,
    )

    const closed = await repository.recordEvaluation({
      evaluation_id: "evaluation-closed", funnel_instance_id: "funnel-1",
      source_id: "source-one", evaluated_at: "2026-09-02T01:11:00.000Z",
    })
    assert.equal(closed.maturity_state, "MATURED")
    assert.equal(closed.eligibility_status, "INELIGIBLE")
    assert.equal(closed.eligibility_reason, "OUTCOME_NOT_ELIGIBLE")

    await seedConvertedFunnel("converted")
    await seedConvertedFunnel("fallback", {
      time_basis: "ingress_fallback", authoritative_event_time: false,
    })
    const convertedCandidates = await repository.listDueCandidates({
      observed_at: "2026-09-02T01:10:00.001Z", limit: 10,
    })
    assert.deepEqual(convertedCandidates.map((candidate) => candidate.funnel_instance_id), [
      "funnel-converted", "funnel-fallback",
    ])
    assert.ok(convertedCandidates.every((candidate) => candidate.target_state === "MATURED"))

    const convertedMaturity = await repository.recordEvaluation({
      evaluation_id: "evaluation-converted", funnel_instance_id: "funnel-converted",
      source_id: "source-one", evaluated_at: "2026-09-02T01:10:00.001Z",
    })
    assert.equal(convertedMaturity.maturity_state, "MATURED")
    assert.equal(convertedMaturity.eligibility_status, "ELIGIBLE")
    assert.equal(convertedMaturity.authoritative_entry_time, true)
    assert.equal(convertedMaturity.authoritative_conversion_time, true)

    const fallbackMaturity = await repository.recordEvaluation({
      evaluation_id: "evaluation-fallback", funnel_instance_id: "funnel-fallback",
      source_id: "source-one", evaluated_at: "2026-09-02T01:10:00.001Z",
    })
    assert.equal(fallbackMaturity.maturity_state, "MATURED")
    assert.equal(fallbackMaturity.eligibility_status, "INELIGIBLE")
    assert.equal(fallbackMaturity.eligibility_reason, "NON_AUTHORITATIVE_CONVERSION_TIME")
    assert.equal(fallbackMaturity.authoritative_conversion_time, false)
    assert.deepEqual(await repository.listDueCandidates({
      observed_at: "2026-09-02T01:11:00.000Z", limit: 10,
    }), [])
  } finally {
    await pool.end()
    await admin.query(`DROP SCHEMA ${schema} CASCADE`)
    await admin.end()
  }
})
