import test from "node:test"
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"
import pg from "pg"
import { createKpiRepository } from "../src/repository.js"

const databaseUrl = process.env.TEST_DATABASE_URL

async function insertCanonical(pool, { id, sourceEventId, eventType, eventClass, occurredAt }) {
  const document = {
    canonical_event_id: id, source_id: "source-one", source_event_id: sourceEventId,
    event_type: eventType, event_class: eventClass, canonical_schema_version: "canonical-event.v1",
    mapping_version: "test-v1", occurred_at: occurredAt, ingested_at: occurredAt,
    normalized_at: occurredAt, data: {},
    quality: { time_basis: "source_occurred", authoritative_event_time: true },
    source_reference: { raw_record_id: `raw_${id}`, content_hash: "a".repeat(64), byte_size: 10 },
  }
  await pool.query(
    `INSERT INTO canonical_events (
       canonical_event_id, source_id, source_event_id, event_type, event_class,
       canonical_schema_version, mapping_version, occurred_at, ingested_at, normalized_at,
       data, quality, raw_record_id, raw_content_hash, raw_byte_size, canonical_document
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8,$8,$9::jsonb,$10::jsonb,$11,$12,$13,$14::jsonb)`,
    [id, "source-one", sourceEventId, eventType, eventClass, "canonical-event.v1", "test-v1", occurredAt,
      JSON.stringify({}), JSON.stringify(document.quality), document.source_reference.raw_record_id,
      document.source_reference.content_hash, document.source_reference.byte_size, JSON.stringify(document)],
  )
}

test("materializes idempotent KPI facts and denominator-safe observed views", { skip: !databaseUrl }, async () => {
  const schema = `kpi_${randomUUID().replaceAll("-", "")}`
  const admin = new pg.Pool({ connectionString: databaseUrl })
  await admin.query(`CREATE SCHEMA ${schema}`)
  const pool = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` })
  try {
    for (const migration of [
      "001_canonical_ledger.sql", "002_journey_projection.sql", "003_funnel_projection.sql",
      "004_kpi_projection.sql", "006_funnel_maturity.sql", "007_maturity_finalization.sql",
    ]) {
      await pool.query(await readFile(new URL(`../../../infra/postgres/v2/${migration}`, import.meta.url), "utf8"))
    }
    await pool.query(
      `INSERT INTO funnel_profiles (
         funnel_profile_id, profile_version, display_name, subject_scope, entry_event_type,
         profile_document, published_at
       ) VALUES ('commerce', '1.0.0', 'Commerce', 'JOURNEY', 'behavior.product_viewed', '{}'::jsonb, NOW())`,
    )
    await pool.query(
      `INSERT INTO funnel_profile_steps (
         funnel_profile_id, profile_version, step_index, step_id, event_type, event_class
       ) VALUES
         ('commerce','1.0.0',0,'view','behavior.product_viewed','BEHAVIOR_INTENT'),
         ('commerce','1.0.0',1,'order','order.accepted','BUSINESS_FACT')`,
    )
    await insertCanonical(pool, {
      id: "can_1", sourceEventId: "source:evt-1", eventType: "behavior.product_viewed",
      eventClass: "BEHAVIOR_INTENT", occurredAt: "2026-08-29T01:00:01.000Z",
    })
    await insertCanonical(pool, {
      id: "can_2", sourceEventId: "source:evt-2", eventType: "order.accepted",
      eventClass: "BUSINESS_FACT", occurredAt: "2026-08-29T01:00:02.000Z",
    })
    await insertCanonical(pool, {
      id: "can_3", sourceEventId: "source:evt-3", eventType: "order.cancelled",
      eventClass: "BUSINESS_FACT", occurredAt: "2026-08-29T01:00:03.000Z",
    })
    await pool.query(
      `INSERT INTO journeys (journey_id, source_id, first_event_at, last_event_at)
       VALUES ('journey_1','source-one','2026-08-29T01:00:01Z','2026-08-29T01:00:02Z')`,
    )
    await pool.query(
      `INSERT INTO funnel_instances (
         funnel_instance_id, source_id, journey_id, funnel_profile_id, profile_version,
         entry_event_id, entry_at, outcome_status, quality_status
       ) VALUES (
         'funnel_1','source-one','journey_1','commerce','1.0.0','can_1',
         '2026-08-29T01:00:01Z','IN_PROGRESS','PROVISIONAL'
       )`,
    )
    await pool.query(
      `INSERT INTO funnel_instance_steps (
         funnel_instance_id, step_index, step_id, event_type, representative_event_id,
         first_reached_at, last_reached_at, occurrence_count, sequence_status
       ) VALUES (
         'funnel_1',0,'view','behavior.product_viewed','can_1',
         '2026-08-29T01:00:01Z','2026-08-29T01:00:01Z',1,'IN_ORDER'
       )`,
    )

    const repository = createKpiRepository({ pool, now: () => "2026-08-29T02:00:00.000Z" })
    const first = await repository.project({
      triggerEventId: "can_1", sourceId: "source-one", journeyId: "journey_1", instanceIds: ["funnel_1"],
    })
    assert.equal(first.changed_instances[0].projection_revision, 1)
    const duplicate = await repository.project({
      triggerEventId: "can_1", sourceId: "source-one", journeyId: "journey_1", instanceIds: ["funnel_1"],
    })
    assert.equal(duplicate.status, "duplicate")

    await pool.query(
      `UPDATE funnel_instances SET outcome_status = 'CONVERTED', converted_at = '2026-08-29T01:00:02Z'
        WHERE funnel_instance_id = 'funnel_1'`,
    )
    await pool.query(
      `INSERT INTO funnel_instance_steps (
         funnel_instance_id, step_index, step_id, event_type, representative_event_id,
         first_reached_at, last_reached_at, occurrence_count, sequence_status
       ) VALUES (
         'funnel_1',1,'order','order.accepted','can_2',
         '2026-08-29T01:00:02Z','2026-08-29T01:00:02Z',1,'IN_ORDER'
       )`,
    )
    const converted = await repository.project({
      triggerEventId: "can_2", sourceId: "source-one", journeyId: "journey_1", instanceIds: ["funnel_1"],
    })
    assert.equal(converted.changed_instances[0].projection_revision, 2)
    const unchanged = await repository.project({
      triggerEventId: "can_3", sourceId: "source-one", journeyId: "journey_1", instanceIds: ["funnel_1"],
    })
    assert.deepEqual(unchanged.changed_instances, [])

    const profileTotals = await pool.query("SELECT * FROM funnel_kpi_profile_observed_totals")
    assert.equal(profileTotals.rows[0].entrants, "1")
    assert.equal(profileTotals.rows[0].observed_converted, "1")
    assert.equal(Number(profileTotals.rows[0].observed_end_to_end_rate), 1)
    assert.equal(profileTotals.rows[0].provisional, "1")
    const stepTotals = await pool.query("SELECT step_id, entrants, reached FROM funnel_kpi_step_observed_totals ORDER BY step_index")
    assert.deepEqual(stepTotals.rows, [
      { step_id: "view", entrants: "1", reached: "1" },
      { step_id: "order", entrants: "1", reached: "1" },
    ])
    const applications = await pool.query("SELECT COUNT(*)::INTEGER AS count FROM kpi_projection_applications")
    assert.equal(applications.rows[0].count, 3)
    const fact = await pool.query(
      "SELECT projection_revision, latest_projection_kind, latest_projection_id FROM funnel_kpi_instance_facts",
    )
    assert.equal(fact.rows[0].projection_revision, "2")
    assert.equal(fact.rows[0].latest_projection_kind, "CANONICAL_EVENT")
    assert.equal(fact.rows[0].latest_projection_id, "can_2")
  } finally {
    await pool.end()
    await admin.query(`DROP SCHEMA ${schema} CASCADE`)
    await admin.end()
  }
})
