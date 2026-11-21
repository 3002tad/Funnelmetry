import test from 'node:test'
import assert from 'node:assert/strict'
import pg from 'pg'
import {FUNNEL_BRIDGE_SQL} from '../src/lib/reference-cdc-profile-v3.js'
import {REFERENCE_CDC_PROFILE_V2} from '../src/lib/reference-cdc-profile-v2.js'
import {switchSql} from '../../../tools/reference-cdc-profile/bridge-release.mjs'
import {readFile} from 'node:fs/promises'
import {randomUUID} from 'node:crypto'

test('profile switch and rollback are atomic, audited, immutable and fail closed on expired quality', {skip:!process.env.TEST_DATABASE_URL},async()=>{
  const db=new pg.Client({connectionString:process.env.TEST_DATABASE_URL});await db.connect()
  const schema='bridge_test_'+randomUUID().replaceAll('-','')
  try {
    await db.query(`CREATE SCHEMA ${schema}; SET search_path TO ${schema}`)
    for(const name of ['028_reference_cdc_v2_profile_candidate.sql','029_reference_cdc_v2_profile_audit.sql'])
      await db.query(await readFile(new URL('../../../infra/postgres/v2/'+name,import.meta.url),'utf8'))
    await db.query(`CREATE TABLE reference_cdc_v2_quality_state(source_instance_id text,coverage_epoch_id text,status text,baseline_complete boolean,historical_gap_status text,verified_at timestamptz,valid_until timestamptz);
      INSERT INTO reference_cdc_v2_quality_state VALUES('medusa-reference','epoch','CURRENT_STATE_READY',true,'INCOMPLETE',now(),now()+interval '1 hour')`)
    const p=REFERENCE_CDC_PROFILE_V2
    await db.query('INSERT INTO reference_cdc_v2_profile_releases(profile_id,profile_version,contract_id,metric_id,definition) VALUES($1,$2,$3,$4,$5)',[p.profile_id,p.profile_version,p.contract_id,p.metric_id,JSON.stringify(p)])
    await db.query(`INSERT INTO reference_cdc_v2_profile_bindings(source_instance_id,profile_id,profile_version,coverage_epoch_id,activation_at,state,decision_ref,activated_at)
      VALUES('medusa-reference','reference-commerce-current-state','2.0.0','epoch','2026-10-30','ACTIVE','test-fixture',now())`)
    await db.query(switchSql())
    assert.equal((await db.query("SELECT profile_version FROM reference_cdc_v2_profile_bindings WHERE state='ACTIVE'")).rows[0].profile_version,'3.0.0')
    assert.deepEqual((await db.query("SELECT definition FROM reference_cdc_v2_profile_releases WHERE profile_version='2.0.0'")).rows[0].definition,p)
    await db.query(switchSql({rollback:true}))
    assert.equal((await db.query("SELECT profile_version FROM reference_cdc_v2_profile_bindings WHERE state='ACTIVE'")).rows[0].profile_version,'2.0.0')
    assert.equal(Number((await db.query('SELECT count(*) FROM reference_cdc_v2_profile_binding_audit')).rows[0].count),6)
    await db.query("UPDATE reference_cdc_v2_quality_state SET valid_until=now()-interval '1 hour'")
    await assert.rejects(()=>db.query(switchSql()),/quality lease/)
    await db.query('ROLLBACK')
    assert.equal((await db.query("SELECT profile_version FROM reference_cdc_v2_profile_bindings WHERE state='ACTIVE'")).rows[0].profile_version,'2.0.0')
  }finally{await db.query('ROLLBACK');await db.query(`DROP SCHEMA ${schema} CASCADE`);await db.end()}
})

test('explicit cart bridge preserves source/cohort/order/grain under duplicates, ambiguity and late evidence', {skip:!process.env.TEST_DATABASE_URL}, async()=>{
  const db=new pg.Client({connectionString:process.env.TEST_DATABASE_URL});await db.connect()
  try {
    await db.query(`BEGIN;
      CREATE TEMP TABLE canonical_events(canonical_event_id text PRIMARY KEY,source_id text,event_type text,occurred_at timestamptz,identity jsonb,relations jsonb,data jsonb);
      CREATE TEMP TABLE journeys(journey_id text PRIMARY KEY,source_id text);
      CREATE TEMP TABLE journey_events(canonical_event_id text PRIMARY KEY,journey_id text);
      CREATE TEMP TABLE journey_entities(source_id text,entity_type text,entity_key text,journey_id text,link_confidence text);
      CREATE TEMP TABLE reference_cdc_v2_funnel_terminal_candidate(source_instance_id text,coverage_epoch_id text,journey_id text,cart_id text,checkout_event_id text,observed_state_at timestamptz);`)
    let id=0
    const event=async(type,journey,hour,{source='s',session='session-1',page='page-1',cart='cart-1',relationCart=cart}={})=>{
      const key='e'+(++id)
      await db.query('INSERT INTO journeys VALUES($1,$2) ON CONFLICT DO NOTHING',[journey,source])
      await db.query('INSERT INTO canonical_events VALUES($1,$2,$3,$4,$5,$6,$7)',[key,source,type,`2026-11-${hour<0?'17':'18'}T${String(hour<0?23:hour).padStart(2,'0')}:00:00Z`,JSON.stringify({session_id:session}),JSON.stringify({cart_id:relationCart}),JSON.stringify({cart_id:cart,page_instance_id:page})])
      await db.query('INSERT INTO journey_events VALUES($1,$2)',[key,journey]);return key
    }
    const owner=async(cart='cart-1',journey='cart-journey',source='s')=>{
      await db.query('INSERT INTO journeys VALUES($1,$2) ON CONFLICT DO NOTHING',[journey,source])
      await db.query("INSERT INTO journey_entities VALUES($1,'CART',$2,$3,'STRONG')",[source,cart,journey])
    }
    const read=async()=> (await db.query(FUNNEL_BRIDGE_SQL,['s','epoch','2026-11-01','2026-11-18','2026-11-19'])).rows[0]
    const counts=async(expected)=>{const r=await read();assert.deepEqual(['entrants','item_added','checkout_started','currently_recorded_journeys'].map(k=>Number(r[k])),expected);return r}
    await owner()
    await event('behavior.product_viewed','browser',1)
    // Checkout/CDC arrive before their context; occurrence order still governs.
    const checkout=await event('checkout.started','cart-journey',3)
    await event('cart.item_added','cart-journey',2)
    await counts([1,0,0,0])
    await event('context.cart_linked','cart-journey',2)
    await counts([1,1,1,0])
    await db.query('INSERT INTO reference_cdc_v2_funnel_terminal_candidate VALUES($1,$2,$3,$4,$5,$6)',['s','epoch','cart-journey','cart-1',checkout,'2026-11-18T04:00:00Z'])
    await counts([1,1,1,1])
    // Repeated observations and multiple terminal rows cannot fan out the grain.
    await event('context.cart_linked','cart-journey',2)
    await event('behavior.product_viewed','browser',1)
    await db.query('INSERT INTO reference_cdc_v2_funnel_terminal_candidate SELECT * FROM reference_cdc_v2_funnel_terminal_candidate')
    await counts([1,1,1,1])
    // OFF removes terminals on the next read (the governed terminal view owns ON/OFF).
    await db.query('DELETE FROM reference_cdc_v2_funnel_terminal_candidate');await counts([1,1,1,0])
    // Same identifiers from another source do not change attribution.
    await owner('cart-1','other-cart','other')
    await event('behavior.product_viewed','other-browser',1,{source:'other'})
    await event('context.cart_linked','other-cart',2,{source:'other'})
    await counts([1,1,1,0])
    // A second owner whose entry is outside the selected cohort still makes a cart ambiguous.
    await event('behavior.product_viewed','earlier-browser',-1,{session:'session-2',page:'page-2'})
    await event('context.cart_linked','cart-journey',2,{session:'session-2',page:'page-2'})
    const ambiguous=await counts([1,0,0,0]);assert.equal(Number(ambiguous.ambiguous_carts),1)
    // Restore fixture, then prove same-cart ordering, missing keys and mismatches.
    await db.query("DELETE FROM canonical_events WHERE identity->>'session_id'='session-2'")
    await db.query("DELETE FROM canonical_events WHERE event_type='checkout.started'")
    await owner('cart-2','cart-journey-2')
    await event('context.cart_linked','cart-journey-2',2,{cart:'cart-2'})
    await event('checkout.started','cart-journey-2',3,{cart:'cart-2'})
    await counts([1,1,0,0]) // add on cart 1 cannot satisfy checkout on cart 2
    await event('cart.item_added','cart-journey-2',4,{cart:'cart-2'})
    await counts([1,1,0,0]) // checkout before add is not a transition
    await event('checkout.started','cart-journey-2',5,{cart:'cart-2'})
    await counts([1,1,1,0]) // two linked carts still count one browser journey
    await db.query("UPDATE canonical_events SET data=data-'page_instance_id' WHERE event_type='context.cart_linked'")
    const missing=await counts([1,0,0,0]);assert.equal(Number(missing.entries_without_cart_context),1)
    await event('context.cart_linked','cart-journey',2,{page:'wrong-page'})
    await event('context.cart_linked','cart-journey',2,{relationCart:'contradictory-cart'})
    await event('context.cart_linked','cart-journey',2,{session:''})
    await counts([1,0,0,0])
    await db.query('ROLLBACK')
  }finally{await db.end()}
})
