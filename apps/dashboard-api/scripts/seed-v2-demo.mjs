import { createHash, randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"
import bcrypt from "bcryptjs"
import pg from "pg"

const databaseUrl = process.env.DEMO_DATABASE_URL || "postgresql://app:demo@127.0.0.1:55432/realtime"
const sourceId = process.env.DEMO_SOURCE_ID || "medusa-reference"
const analystEmail = process.env.DEMO_ANALYST_EMAIL || "analyst@funnelmetry.local"
const analystPassword = process.env.DEMO_ANALYST_PASSWORD || "funnelmetry-demo"
const pool = new pg.Pool({ connectionString: databaseUrl })

function iso(daysAgo, minuteOffset = 0) {
  return new Date(Date.now() - daysAgo * 86_400_000 + minuteOffset * 60_000).toISOString()
}

function hash(value) {
  return createHash("sha256").update(value).digest("hex")
}

function addMilliseconds(value, milliseconds) {
  return new Date(Date.parse(value) + milliseconds).toISOString()
}

const journeys = [
  {
    id: "journey-demo-converted-reconciled", daysAgo: 12, outcome: "CONVERTED", quality: "RECONCILED",
    events: ["behavior.product_viewed", "cart.item_added", "checkout.started", "order.accepted"],
  },
  {
    id: "journey-demo-cart-pending", daysAgo: 6, outcome: "IN_PROGRESS", quality: "PROVISIONAL",
    events: ["behavior.product_viewed", "cart.item_added"],
  },
  {
    id: "journey-demo-degraded-time", daysAgo: 3, outcome: "IN_PROGRESS", quality: "DEGRADED",
    events: ["behavior.product_viewed", "cart.item_added", "checkout.started"], fallback: true,
  },
  {
    id: "journey-demo-converted-live", daysAgo: 1, outcome: "CONVERTED", quality: "PROVISIONAL",
    events: ["behavior.product_viewed", "cart.item_added", "checkout.started", "order.accepted"],
  },
]

const steps = [
  ["view", "behavior.product_viewed", "BEHAVIOR_INTENT"],
  ["cart", "cart.item_added", "BEHAVIOR_INTENT"],
  ["checkout", "checkout.started", "BEHAVIOR_INTENT"],
  ["order", "order.accepted", "BUSINESS_FACT"],
]

async function seed() {
  const client = await pool.connect()
  try {
    for (const migration of [
      "001_canonical_ledger.sql", "002_journey_projection.sql", "003_funnel_projection.sql",
      "004_kpi_projection.sql", "005_ingress_telemetry.sql",
    ]) {
      await client.query(await readFile(new URL(`../../../infra/postgres/v2/${migration}`, import.meta.url), "utf8"))
    }
    await client.query("BEGIN")
    await client.query(`
      CREATE TABLE IF NOT EXISTS dashboard_users (
        id UUID PRIMARY KEY, email VARCHAR(255) UNIQUE NOT NULL, password_hash VARCHAR(255) NOT NULL,
        display_name VARCHAR(100), role VARCHAR(20) NOT NULL CHECK (role IN ('super_admin', 'analyst')),
        is_active BOOLEAN NOT NULL DEFAULT true, last_login_at TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `)
    await client.query(
      `INSERT INTO dashboard_users (id, email, password_hash, display_name, role)
       VALUES ($1,$2,$3,'Demo Analyst','analyst')
       ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, is_active = true, updated_at = NOW()`,
      [randomUUID(), analystEmail, await bcrypt.hash(analystPassword, 10)],
    )
    await client.query(
      `INSERT INTO funnel_profiles (
         funnel_profile_id, profile_version, display_name, subject_scope, entry_event_type,
         profile_document, conversion_horizon_seconds, late_arrival_grace_seconds, published_at
       ) VALUES ('commerce-conversion','1.0.0','Commerce Conversion','JOURNEY','behavior.product_viewed',
         $1::jsonb,604800,86400,$2)
       ON CONFLICT DO NOTHING`,
      [JSON.stringify({ demo: true, note: "Local UI demo profile" }), iso(30)],
    )
    for (const [index, [stepId, eventType, eventClass]] of steps.entries()) {
      await client.query(
        `INSERT INTO funnel_profile_steps (
           funnel_profile_id, profile_version, step_index, step_id, event_type, event_class
         ) VALUES ('commerce-conversion','1.0.0',$1,$2,$3,$4) ON CONFLICT DO NOTHING`,
        [index, stepId, eventType, eventClass],
      )
    }
    await client.query(
      `INSERT INTO funnel_profile_activations (source_id, funnel_profile_id, profile_version, enabled_at)
       VALUES ($1,'commerce-conversion','1.0.0',$2) ON CONFLICT DO NOTHING`,
      [sourceId, iso(30)],
    )

    for (const [journeyIndex, journey] of journeys.entries()) {
      const eventIds = journey.events.map((_, index) => `canonical-demo-${journeyIndex + 1}-${index + 1}`)
      const occurred = journey.events.map((_, index) => iso(journey.daysAgo, index * 8))
      for (const [eventIndex, eventType] of journey.events.entries()) {
        const eventClass = eventType === "order.accepted" ? "BUSINESS_FACT" : "BEHAVIOR_INTENT"
        const eventId = eventIds[eventIndex]
        const timeBasis = journey.fallback ? "ingress_fallback" : "source_occurred"
        const quality = { time_basis: timeBasis, authoritative_event_time: !journey.fallback, demo_seed: true }
        const document = {
          canonical_event_id: eventId, source_id: sourceId, source_event_id: `demo:${eventId}`,
          event_type: eventType, event_class: eventClass, canonical_schema_version: "canonical-event.v1",
          mapping_version: "demo-v1", occurred_at: occurred[eventIndex], ingested_at: occurred[eventIndex],
          normalized_at: occurred[eventIndex], data: {}, quality,
          source_reference: { raw_record_id: `raw-${eventId}`, content_hash: hash(eventId), byte_size: 64 },
        }
        await client.query(
          `INSERT INTO canonical_events (
             canonical_event_id, source_id, source_event_id, event_type, event_class,
             canonical_schema_version, mapping_version, occurred_at, ingested_at, normalized_at,
             data, quality, raw_record_id, raw_content_hash, raw_byte_size, canonical_document, persisted_at
           ) VALUES ($1,$2,$3,$4,$5,'canonical-event.v1','demo-v1',$6,$6,$6,'{}'::jsonb,$7::jsonb,$8,$9,64,$10::jsonb,$6)
           ON CONFLICT DO NOTHING`,
          [eventId, sourceId, `demo:${eventId}`, eventType, eventClass, occurred[eventIndex], JSON.stringify(quality),
            `raw-${eventId}`, hash(eventId), JSON.stringify(document)],
        )
        const sourceEventId = `demo:${eventId}`
        const ingestionId = `ingestion-${eventId}`
        const receipt = {
          status: "accepted", source_id: sourceId, event_id: sourceEventId,
          ingestion_id: ingestionId, ingestion_attempt_id: `attempt-${eventId}`,
          received_at: occurred[eventIndex],
        }
        await client.query(
          `INSERT INTO ingress_accepted_receipts (
             source_id, event_id, ingestion_id, ingestion_attempt_id, received_at, receipt_document
           ) VALUES ($1,$2,$3,$4,$5,$6::jsonb) ON CONFLICT DO NOTHING`,
          [sourceId, sourceEventId, ingestionId, `attempt-${eventId}`, occurred[eventIndex], JSON.stringify(receipt)],
        )
        const processedAt = addMilliseconds(occurred[eventIndex], 25 + eventIndex * 7)
        const outcome = {
          source_id: sourceId, source_event_id: sourceEventId, status: "normalized",
          canonical_event_id: eventId, mapping_version: "demo-v1", processed_at: processedAt,
          raw_record_id: `raw-${eventId}`,
        }
        await client.query(
          `INSERT INTO canonicalization_outcomes (
             source_id, source_event_id, mapping_version, status, canonical_event_id,
             reason_code, processed_at, raw_record_id, outcome_document
           ) VALUES ($1,$2,'demo-v1','normalized',$3,NULL,$4,$5,$6::jsonb) ON CONFLICT DO NOTHING`,
          [sourceId, sourceEventId, eventId, processedAt, `raw-${eventId}`, JSON.stringify(outcome)],
        )
      }
      await client.query(
        `INSERT INTO journeys (journey_id, source_id, status, first_event_at, last_event_at, event_count, created_at, updated_at)
         VALUES ($1,$2,'ACTIVE',$3,$4,$5,$3,$4) ON CONFLICT DO NOTHING`,
        [journey.id, sourceId, occurred[0], occurred.at(-1), journey.events.length],
      )
      await client.query(
        `INSERT INTO journey_entities (
           source_id, entity_type, entity_key, journey_id, linked_at, link_method, link_confidence, evidence_event_id
         ) VALUES ($1,'SESSION',$2,$3,$4,'SESSION_CONTEXT',$5,$6) ON CONFLICT DO NOTHING`,
        [sourceId, hash(`${journey.id}:session`), journey.id, occurred[0], journey.fallback ? "WEAK" : "STRONG", eventIds[0]],
      )
      for (const [eventIndex, eventType] of journey.events.entries()) {
        await client.query(
          `INSERT INTO journey_events (
             canonical_event_id, journey_id, event_type, occurred_at, link_method, link_confidence, linked_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$4) ON CONFLICT DO NOTHING`,
          [eventIds[eventIndex], journey.id, eventType, occurred[eventIndex],
            eventIndex ? "SESSION_CONTEXT" : "NEW_JOURNEY", journey.fallback ? "WEAK" : eventIndex ? "STRONG" : "ISOLATED"],
        )
      }
      const instanceId = `funnel-demo-${journeyIndex + 1}`
      const convertedAt = journey.outcome === "CONVERTED" ? occurred.at(-1) : null
      await client.query(
        `INSERT INTO funnel_instances (
           funnel_instance_id, source_id, journey_id, funnel_profile_id, profile_version,
           entry_event_id, entry_at, conversion_deadline, outcome_status, quality_status, converted_at
         ) VALUES ($1,$2,$3,'commerce-conversion','1.0.0',$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING`,
        [instanceId, sourceId, journey.id, eventIds[0], occurred[0], iso(journey.daysAgo - 7),
          journey.outcome, journey.quality, convertedAt],
      )
      for (const [stepIndex, eventType] of journey.events.entries()) {
        await client.query(
          `INSERT INTO funnel_instance_steps (
             funnel_instance_id, step_index, step_id, event_type, representative_event_id,
             first_reached_at, last_reached_at, occurrence_count, sequence_status
           ) VALUES ($1,$2,$3,$4,$5,$6,$6,1,'IN_ORDER') ON CONFLICT DO NOTHING`,
          [instanceId, stepIndex, steps[stepIndex][0], eventType, eventIds[stepIndex], occurred[stepIndex]],
        )
      }
      await client.query(
        `INSERT INTO funnel_kpi_instance_facts (
           funnel_instance_id, source_id, journey_id, funnel_profile_id, profile_version,
           entry_at, conversion_deadline, outcome_status, quality_status, converted_at,
           reached_step_count, total_step_count, branch_count, latest_trigger_event_id,
           projection_hash, projection_revision, projected_at
         ) VALUES ($1,$2,$3,'commerce-conversion','1.0.0',$4,$5,$6,$7,$8,$9,4,0,$10,$11,1,$12)
         ON CONFLICT DO NOTHING`,
        [instanceId, sourceId, journey.id, occurred[0], iso(journey.daysAgo - 7), journey.outcome,
          journey.quality, convertedAt, journey.events.length, eventIds.at(-1), hash(`projection:${instanceId}`), occurred.at(-1)],
      )
      for (const [stepIndex, eventType] of journey.events.entries()) {
        await client.query(
          `INSERT INTO funnel_kpi_step_facts (
             funnel_instance_id, step_index, step_id, event_type, first_reached_at, last_reached_at, occurrence_count
           ) VALUES ($1,$2,$3,$4,$5,$5,1) ON CONFLICT DO NOTHING`,
          [instanceId, stepIndex, steps[stepIndex][0], eventType, occurred[stepIndex]],
        )
      }
    }
    await client.query("COMMIT")
    console.log(`[demo-seed] ${journeys.length} journeys and ${journeys.reduce((sum, item) => sum + item.events.length, 0)} canonical events with telemetry ready`)
    console.log(`[demo-seed] login ${analystEmail} / ${analystPassword}`)
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {})
    throw error
  } finally {
    client.release()
  }
}

await seed().finally(() => pool.end())
