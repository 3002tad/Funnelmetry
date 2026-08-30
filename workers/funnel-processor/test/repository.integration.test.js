import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import pg from "pg"
import { createFunnelProfileRepository, createFunnelRepository } from "../src/repository.js"
import { canonicalEvent, commerceProfile } from "./fixtures.js"

const databaseUrl = process.env.TEST_DATABASE_URL

test("projects a late commerce sequence and preserves a post-conversion negative branch", { skip: !databaseUrl }, async () => {
  const pool = new pg.Pool({ connectionString: databaseUrl })
  try {
    for (const migration of ["001_canonical_ledger.sql", "002_journey_projection.sql", "003_funnel_projection.sql"]) {
      await pool.query(await readFile(new URL(`../../../infra/postgres/v2/${migration}`, import.meta.url), "utf8"))
    }
    const profileRepository = createFunnelProfileRepository({ pool })
    await profileRepository.publish({
      sourceId: "source-one",
      profile: commerceProfile,
      publishedAt: "2026-08-29T00:00:00.000Z",
    })
    await profileRepository.publish({
      sourceId: "source-one",
      profile: commerceProfile,
      publishedAt: "2026-08-29T00:00:01.000Z",
    })
    await assert.rejects(
      () => profileRepository.publish({ sourceId: "source-one", profile: { ...commerceProfile, display_name: "Changed in place" } }),
      /different semantics/,
    )
    const activations = await pool.query("SELECT * FROM funnel_profile_activations")
    assert.equal(activations.rowCount, 1)
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
  }
})
