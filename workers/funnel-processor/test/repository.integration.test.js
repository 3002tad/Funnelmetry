import { randomUUID } from "node:crypto"
import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import pg from "pg"
import { createFunnelProfileRepository, createFunnelRepository } from "../src/repository.js"
import { canonicalEvent, commerceProfile } from "./fixtures.js"

const databaseUrl = process.env.TEST_DATABASE_URL

test("projects a late commerce sequence and preserves a post-conversion negative branch", { skip: !databaseUrl }, async () => {
  const schema = `funnel_${randomUUID().replaceAll("-", "")}`
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
    const profileRepository = createFunnelProfileRepository({ pool })
    const persistedProfile = { ...commerceProfile, transition_timeouts_seconds: { cart: 300 } }
    await profileRepository.publish({
      sourceId: "source-one",
      profile: persistedProfile,
      publishedAt: "2026-08-29T00:00:00.000Z",
    })
    await profileRepository.publish({
      sourceId: "source-one",
      profile: persistedProfile,
      publishedAt: "2026-08-29T00:00:01.000Z",
    })
    await assert.rejects(
      () => profileRepository.publish({ sourceId: "source-one", profile: { ...commerceProfile, display_name: "Changed in place" } }),
      /different semantics/,
    )
    const activations = await pool.query("SELECT * FROM funnel_profile_activations")
    assert.equal(activations.rowCount, 1)
    const timeouts = await pool.query("SELECT next_step_id, timeout_seconds FROM funnel_profile_transition_timeouts")
    assert.deepEqual(timeouts.rows, [{ next_step_id: "cart", timeout_seconds: "300" }])
    await pool.query(
      `INSERT INTO journeys (journey_id, source_id, first_event_at, last_event_at)
       VALUES ('journey_1', 'source-one', '2026-08-29T01:00:01Z', '2026-08-29T01:00:05Z')`,
    )
    const repository = createFunnelRepository({ pool, now: () => "2026-08-29T02:00:00.000Z" })
    const events = [
      canonicalEvent({ canonical_event_id: "can_1", source_event_id: "source:evt-1", occurred_at: "2026-08-29T01:00:01.000Z" }),
      canonicalEvent({ canonical_event_id: "can_2", source_event_id: "source:evt-2", event_type: "cart.item_added", event_class: "BUSINESS_FACT", occurred_at: "2026-08-29T01:00:02.000Z" }),
      canonicalEvent({ canonical_event_id: "can_4", source_event_id: "source:evt-4", event_type: "order.accepted", event_class: "BUSINESS_FACT", occurred_at: "2026-08-29T01:00:04.000Z" }),
      canonicalEvent({ canonical_event_id: "can_3", source_event_id: "source:evt-3", event_type: "checkout.started", event_class: "BEHAVIOR_INTENT", occurred_at: "2026-08-29T01:00:03.000Z" }),
      canonicalEvent({ canonical_event_id: "can_5", source_event_id: "source:evt-5", event_type: "order.cancelled", event_class: "BUSINESS_FACT", occurred_at: "2026-08-29T01:00:05.000Z" }),
    ]

    for (const event of events) {
      await pool.query(
        `INSERT INTO canonical_events (
           canonical_event_id, source_id, source_event_id, event_type, event_class,
           canonical_schema_version, mapping_version, occurred_at, ingested_at, normalized_at,
           relations, identity, data, quality, raw_record_id, raw_content_hash, raw_byte_size,
           canonical_document
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13::jsonb,$14::jsonb,$15,$16,$17,$18::jsonb)`,
        [event.canonical_event_id, event.source_id, event.source_event_id, event.event_type, event.event_class,
          event.canonical_schema_version, event.mapping_version, event.occurred_at, event.ingested_at,
          event.normalized_at, JSON.stringify(event.relations ?? null), JSON.stringify(event.identity ?? null),
          JSON.stringify(event.data), JSON.stringify(event.quality), event.source_reference.raw_record_id,
          event.source_reference.content_hash, event.source_reference.byte_size, JSON.stringify(event)],
      )
      await pool.query(
        `INSERT INTO journey_events (
           canonical_event_id, journey_id, event_type, occurred_at, link_method, link_confidence, linked_at
         ) VALUES ($1, 'journey_1', $2, $3, 'TEST', 'STRONG', $3)`,
        [event.canonical_event_id, event.event_type, event.occurred_at],
      )
      await repository.project({ journeyId: "journey_1", canonicalEvent: event })
    }

    const instance = await pool.query("SELECT * FROM funnel_instances")
    assert.equal(instance.rowCount, 1)
    assert.equal(instance.rows[0].outcome_status, "CONVERTED")
    assert.equal(new Date(instance.rows[0].converted_at).toISOString(), "2026-08-29T01:00:04.000Z")
    assert.equal(instance.rows[0].conversion_deadline, null)
    const steps = await pool.query("SELECT step_id FROM funnel_instance_steps ORDER BY step_index")
    assert.deepEqual(steps.rows.map((row) => row.step_id), ["view", "cart", "checkout", "order"])
    const branches = await pool.query("SELECT event_type FROM funnel_instance_branches")
    assert.deepEqual(branches.rows.map((row) => row.event_type), ["order.cancelled"])
  } finally {
    await pool.end()
    await admin.query(`DROP SCHEMA ${schema} CASCADE`)
    await admin.end()
  }
})

test("records a strong-key late conversion without rewriting the finalized funnel or KPI", { skip: !databaseUrl }, async () => {
  const schema = `funnel_late_${randomUUID().replaceAll("-", "")}`
  const admin = new pg.Pool({ connectionString: databaseUrl })
  await admin.query(`CREATE SCHEMA ${schema}`)
  const pool = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` })
  try {
    for (const migration of [
      "001_canonical_ledger.sql", "002_journey_projection.sql", "003_funnel_projection.sql",
      "004_kpi_projection.sql", "006_funnel_maturity.sql", "007_maturity_finalization.sql",
      "008_late_conversion.sql",
    ]) {
      await pool.query(await readFile(new URL(`../../../infra/postgres/v2/${migration}`, import.meta.url), "utf8"))
    }

    const profile = {
      ...commerceProfile,
      conversion_horizon_seconds: 60,
      late_arrival_grace_seconds: 10,
    }
    await createFunnelProfileRepository({ pool }).publish({
      sourceId: "source-one",
      profile,
      publishedAt: "2026-08-29T00:00:00.000Z",
    })
    await pool.query(
      `INSERT INTO journeys (journey_id, source_id, first_event_at, last_event_at)
       VALUES ('journey_late', 'source-one', '2026-08-29T01:00:00Z', '2026-08-29T01:01:01Z')`,
    )
    const repository = createFunnelRepository({ pool, now: () => "2026-08-29T01:01:12.000Z" })
    const initialEvents = [
      canonicalEvent({ canonical_event_id: "late_view", source_event_id: "source:late-view" }),
      canonicalEvent({
        canonical_event_id: "late_cart", source_event_id: "source:late-cart",
        event_type: "cart.item_added", event_class: "BUSINESS_FACT",
        occurred_at: "2026-08-29T01:00:10.000Z",
      }),
      canonicalEvent({
        canonical_event_id: "late_checkout", source_event_id: "source:late-checkout",
        event_type: "checkout.started", event_class: "BEHAVIOR_INTENT",
        occurred_at: "2026-08-29T01:00:20.000Z",
      }),
    ]

    for (const [index, event] of initialEvents.entries()) {
      await pool.query(
        `INSERT INTO canonical_events (
           canonical_event_id, source_id, source_event_id, event_type, event_class,
           canonical_schema_version, mapping_version, occurred_at, ingested_at, normalized_at,
           relations, identity, data, quality, raw_record_id, raw_content_hash, raw_byte_size,
           canonical_document
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13::jsonb,$14::jsonb,$15,$16,$17,$18::jsonb)`,
        [event.canonical_event_id, event.source_id, event.source_event_id, event.event_type, event.event_class,
          event.canonical_schema_version, event.mapping_version, event.occurred_at, event.ingested_at,
          event.normalized_at, JSON.stringify(event.relations ?? null), JSON.stringify(event.identity ?? null),
          JSON.stringify(event.data), JSON.stringify(event.quality), `${event.source_reference.raw_record_id}_${index}`,
          event.source_reference.content_hash, event.source_reference.byte_size, JSON.stringify(event)],
      )
      await pool.query(
        `INSERT INTO journey_events (
           canonical_event_id, journey_id, event_type, occurred_at, link_method, link_confidence,
           matched_entity_type, matched_entity_key, linked_at
         ) VALUES ($1, 'journey_late', $2, $3, $4, $5, $6, $7, $3)`,
        [event.canonical_event_id, event.event_type, event.occurred_at,
          index === 0 ? "NEW_JOURNEY" : "BUSINESS_ENTITY", index === 0 ? "ISOLATED" : "STRONG",
          index === 0 ? null : (index === 1 ? "CART" : "CHECKOUT"),
          index === 0 ? null : `business_${index}`],
      )
      await repository.project({ journeyId: "journey_late", canonicalEvent: event })
    }

    const instanceResult = await pool.query("SELECT * FROM funnel_instances")
    assert.equal(instanceResult.rowCount, 1)
    const instance = instanceResult.rows[0]
    assert.equal(instance.outcome_status, "IN_PROGRESS")
    const officialHash = "b".repeat(64)
    await pool.query(
      `INSERT INTO funnel_kpi_instance_facts (
         funnel_instance_id, source_id, journey_id, funnel_profile_id, profile_version,
         entry_at, conversion_deadline, outcome_status, quality_status, converted_at,
         reached_step_count, total_step_count, branch_count, latest_trigger_event_id,
         latest_projection_kind, latest_projection_id, projection_hash, projection_revision, projected_at
       ) VALUES ($1,'source-one','journey_late','commerce','1.0.0',$2,$3,'DROPPED','PROVISIONAL',NULL,
                 3,4,0,'late_checkout','MATURITY_FINALIZATION','finalization_late',$4,2,$5)`,
      [instance.funnel_instance_id, instance.entry_at, instance.conversion_deadline,
        officialHash, "2026-08-29T01:01:11.000Z"],
    )
    await pool.query(
      `INSERT INTO funnel_maturity_evaluations (
         evaluation_id, funnel_instance_id, source_id, evaluation_revision, maturity_state,
         maturity_reason, eligibility_status, eligibility_reason, outcome_status_snapshot,
         quality_status_snapshot, authoritative_entry_time, evaluated_at, conversion_deadline,
         finalization_at, next_step_id, suspected_dropoff_at, evidence_hash, evaluation_document
       ) VALUES ('evaluation_late',$1,'source-one',1,'MATURED','HORIZON_GRACE_ELAPSED','ELIGIBLE',NULL,
                 'IN_PROGRESS','PROVISIONAL',TRUE,$2,$3,$4,NULL,NULL,$5,'{}'::jsonb)`,
      [instance.funnel_instance_id, "2026-08-29T01:01:11.000Z", instance.conversion_deadline,
        "2026-08-29T01:01:10.000Z", "c".repeat(64)],
    )
    await pool.query(
      "UPDATE funnel_instances SET outcome_status = 'DROPPED', updated_at = $2 WHERE funnel_instance_id = $1",
      [instance.funnel_instance_id, "2026-08-29T01:01:11.000Z"],
    )
    await pool.query(
      `INSERT INTO funnel_maturity_finalizations (
         finalization_id, evaluation_id, funnel_instance_id, source_id, journey_id,
         previous_outcome_status, finalized_outcome_status, kpi_projection_revision,
         kpi_projection_hash, finalized_at, finalization_document
       ) VALUES ('finalization_late','evaluation_late',$1,'source-one','journey_late',
                 'IN_PROGRESS','DROPPED',2,$2,$3,'{}'::jsonb)`,
      [instance.funnel_instance_id, officialHash, "2026-08-29T01:01:11.000Z"],
    )

    const order = canonicalEvent({
      canonical_event_id: "late_order",
      source_event_id: "source:late-order",
      event_type: "order.accepted",
      event_class: "BUSINESS_FACT",
      occurred_at: "2026-08-29T01:01:01.000Z",
      produced_at: "2026-08-29T01:01:02.000Z",
      ingested_at: "2026-08-29T01:01:12.000Z",
      normalized_at: "2026-08-29T01:01:13.000Z",
    })
    await pool.query(
      `INSERT INTO canonical_events (
         canonical_event_id, source_id, source_event_id, event_type, event_class,
         canonical_schema_version, mapping_version, occurred_at, produced_at, ingested_at, normalized_at,
         relations, identity, data, quality, raw_record_id, raw_content_hash, raw_byte_size,
         canonical_document
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14::jsonb,$15::jsonb,$16,$17,$18,$19::jsonb)`,
      [order.canonical_event_id, order.source_id, order.source_event_id, order.event_type, order.event_class,
        order.canonical_schema_version, order.mapping_version, order.occurred_at, order.produced_at,
        order.ingested_at, order.normalized_at, JSON.stringify(order.relations), JSON.stringify(order.identity),
        JSON.stringify(order.data), JSON.stringify(order.quality), "raw_late_order",
        order.source_reference.content_hash, order.source_reference.byte_size, JSON.stringify(order)],
    )
    await pool.query(
      `INSERT INTO journey_events (
         canonical_event_id, journey_id, event_type, occurred_at, link_method, link_confidence,
         matched_entity_type, matched_entity_key, linked_at
       ) VALUES ('late_order','journey_late','order.accepted',$1,'BUSINESS_ENTITY','STRONG',
                 'ORDER','order_1',$2)`,
      [order.occurred_at, order.ingested_at],
    )

    const result = await repository.project({ journeyId: "journey_late", canonicalEvent: order })
    assert.deepEqual(result.updates, [])
    assert.equal(result.late_conversions.length, 1)
    assert.equal(result.late_conversions[0].arrival_class, "AFTER_HORIZON")
    assert.equal(result.late_conversions[0].matched_entity_type, "ORDER")
    assert.equal("matched_entity_key" in result.late_conversions[0], false)

    const unchanged = await pool.query(
      `SELECT i.outcome_status, i.converted_at, k.outcome_status AS kpi_outcome_status,
              k.projection_revision, k.projection_hash, k.latest_projection_id,
              (SELECT COUNT(*)::int FROM funnel_instance_steps s
                WHERE s.funnel_instance_id = i.funnel_instance_id) AS reached_steps
         FROM funnel_instances i JOIN funnel_kpi_instance_facts k USING (funnel_instance_id)`,
    )
    assert.deepEqual(unchanged.rows[0], {
      outcome_status: "DROPPED",
      converted_at: null,
      kpi_outcome_status: "DROPPED",
      projection_revision: "2",
      projection_hash: officialHash,
      latest_projection_id: "finalization_late",
      reached_steps: 3,
    })
    const evidence = await pool.query("SELECT * FROM funnel_late_conversions")
    assert.equal(evidence.rowCount, 1)
    assert.equal(evidence.rows[0].conversion_event_id, "late_order")
    await assert.rejects(
      () => pool.query("UPDATE funnel_late_conversions SET detected_at = NOW()"),
      /append-only/,
    )

    const duplicate = await repository.project({ journeyId: "journey_late", canonicalEvent: order })
    assert.equal(duplicate.status, "duplicate")
    assert.equal((await pool.query("SELECT * FROM funnel_late_conversions")).rowCount, 1)
  } finally {
    await pool.end()
    await admin.query(`DROP SCHEMA ${schema} CASCADE`)
    await admin.end()
  }
})
