import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"
import test from "node:test"
import pg from "pg"
import { JourneyResolutionConflictError, createJourneyRepository } from "../src/repository.js"
import { canonicalEvent } from "./fixtures.js"

const databaseUrl = process.env.TEST_DATABASE_URL

test("checkout cart anchoring survives both arrival orders and duplicate delivery without merging sessions", {skip:!databaseUrl}, async()=>{
  const pool=new pg.Pool({connectionString:databaseUrl})
  try {
    for(const migration of ['001_canonical_ledger.sql','002_journey_projection.sql'])
      await pool.query(await readFile(new URL(`../../../infra/postgres/v2/${migration}`,import.meta.url),'utf8'))
    for(const cartFirst of [false,true]) {
      const id=randomUUID(),source=`checkout-recovery-${id}`,cart=`cart-${id}`,session=`session-${id}`
      const make=(label,overrides)=>canonicalEvent({source_id:source,canonical_event_id:`can-${id}-${label}`,source_event_id:`evt-${id}-${label}`,...overrides})
      const browse=make('view',{identity:{session_id:session},relations:{correlation_id:session}})
      const add=make('cart',{event_type:'cart.item_added',event_class:'BUSINESS_FACT',relations:{cart_id:cart,correlation_id:`cart:${cart}`},data:{cart_id:cart}})
      const checkout=make('checkout',{event_type:'checkout.started',mapping_version:'canonical-behavior-v2',identity:{session_id:session},relations:{correlation_id:`cart:${cart}`},data:{cart_id:cart,step:'address'}})
      const repo=createJourneyRepository({pool}),resolved={}
      for(const event of cartFirst?[add,browse]:[browse,add]) {
        await persistCanonical(pool,event);resolved[event.event_type]=await repo.resolve(event)
      }
      await persistCanonical(pool,checkout)
      const result=await repo.resolve(checkout)
      assert.equal(result.journey_id,resolved['cart.item_added'].journey_id)
      assert.notEqual(result.journey_id,resolved['behavior.product_viewed'].journey_id)
      assert.equal(result.matched_entity_type,'CART')
      assert.equal(result.link_confidence,'STRONG')
      assert.equal((await repo.resolve(checkout)).status,'duplicate')
      const owner=await pool.query("SELECT journey_id FROM journey_entities WHERE source_id=$1 AND entity_type='SESSION' AND entity_key=$2",[source,session])
      assert.equal(owner.rows[0].journey_id,resolved['behavior.product_viewed'].journey_id)
      const count=await pool.query('SELECT event_count FROM journeys WHERE journey_id=$1',[result.journey_id])
      assert.equal(Number(count.rows[0].event_count),2)
      const contradiction=make('bad',{event_type:'checkout.started',data:{cart_id:cart},relations:{cart_id:`other-${id}`}})
      // A second explicit cart is already owned by another journey: still fail closed.
      const other=make('other',{event_type:'cart.item_added',event_class:'BUSINESS_FACT',relations:{cart_id:`other-${id}`}})
      await persistCanonical(pool,other);await repo.resolve(other);await persistCanonical(pool,contradiction)
      await assert.rejects(()=>repo.resolve(contradiction),JourneyResolutionConflictError)
    }
  }finally{await pool.end()}
})

function json(value) {
  return value === undefined ? null : JSON.stringify(value)
}

async function persistCanonical(pool, event) {
  await pool.query(
    `INSERT INTO canonical_events (
       canonical_event_id, source_id, source_event_id, event_type, event_class,
       canonical_schema_version, mapping_version, occurred_at, ingested_at, normalized_at,
       relations, identity, data, quality, raw_record_id, raw_content_hash, raw_byte_size,
       canonical_document
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
       $11::jsonb,$12::jsonb,$13::jsonb,$14::jsonb,$15,$16,$17,$18::jsonb
     )`,
    [
      event.canonical_event_id,
      event.source_id,
      event.source_event_id,
      event.event_type,
      event.event_class,
      event.canonical_schema_version,
      event.mapping_version,
      event.occurred_at,
      event.ingested_at,
      event.normalized_at,
      json(event.relations),
      json(event.identity),
      json(event.data),
      json(event.quality),
      event.source_reference.raw_record_id,
      event.source_reference.content_hash,
      event.source_reference.byte_size,
      JSON.stringify(event),
    ],
  )
}

test("rolls back a PostgreSQL journey resolution when evidence points to two journeys", { skip: !databaseUrl }, async () => {
  const pool = new pg.Pool({ connectionString: databaseUrl })
  const runId = randomUUID()
  const sourceId = `journey-conflict-${runId}`
  const repository = createJourneyRepository({ pool })

  function event(label, correlationId, sessionId, secondOffset) {
    return canonicalEvent({
      canonical_event_id: `can-${runId}-${label}`,
      source_event_id: `integration:${runId}:${label}`,
      source_id: sourceId,
      occurred_at: new Date(Date.parse("2026-09-01T00:00:00.000Z") + secondOffset * 1_000).toISOString(),
      relations: { correlation_id: correlationId },
      identity: { session_id: sessionId },
      source_reference: {
        raw_record_id: `raw-${runId}-${label}`,
        content_hash: "a".repeat(64),
        byte_size: 100,
      },
    })
  }

  try {
    for (const migration of ["001_canonical_ledger.sql", "002_journey_projection.sql"]) {
      await pool.query(await readFile(new URL(`../../../infra/postgres/v2/${migration}`, import.meta.url), "utf8"))
    }

    const first = event("first", `correlation-a-${runId}`, `session-a-${runId}`, 0)
    const second = event("second", `correlation-b-${runId}`, `session-b-${runId}`, 1)
    const conflict = event("conflict", `correlation-a-${runId}`, `session-b-${runId}`, 2)
    await persistCanonical(pool, first)
    await persistCanonical(pool, second)
    await persistCanonical(pool, conflict)

    const firstResolution = await repository.resolve(first)
    const secondResolution = await repository.resolve(second)
    assert.notEqual(firstResolution.journey_id, secondResolution.journey_id)

    await assert.rejects(repository.resolve(conflict), JourneyResolutionConflictError)

    const conflictingLink = await pool.query(
      "SELECT COUNT(*)::int AS count FROM journey_events WHERE canonical_event_id = $1",
      [conflict.canonical_event_id],
    )
    assert.equal(conflictingLink.rows[0].count, 0)

    const journeyCounts = await pool.query(
      "SELECT event_count FROM journeys WHERE journey_id = ANY($1::text[]) ORDER BY journey_id",
      [[firstResolution.journey_id, secondResolution.journey_id]],
    )
    assert.deepEqual(journeyCounts.rows.map((row) => Number(row.event_count)), [1, 1])
  } finally {
    await pool.end()
  }
})
