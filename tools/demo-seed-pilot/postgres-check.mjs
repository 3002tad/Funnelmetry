// Disposable, network-isolated PostgreSQL only. No host ports, bind mounts or volumes.
import { spawn, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { Duplex } from 'node:stream'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { browserEnvelope, canonicalFor, logicalHash, generate, summarize } from './generator.mjs'
import { goldenQuestions } from './golden.mjs'
import { extractTrafficSourceObservation } from '../../workers/traffic-source-writer/src/observation.js'
import { createHash } from 'node:crypto'
import { persistCartChange } from '../../workers/cart-line-item-cdc-mapper/src/projection.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const directory = process.argv[2]
if (!directory) throw Error('Usage: node postgres-check.mjs <fixture-directory>')
const [fixtureRaw, manifestRaw] = await Promise.all([readFile(resolve(directory, 'fixture.json'), 'utf8'), readFile(resolve(directory, 'manifest.json'), 'utf8')])
const data = JSON.parse(fixtureRaw), manifest = JSON.parse(manifestRaw)
const sha = value => createHash('sha256').update(value).digest('hex')
const generatorSource = await readFile(resolve(root, 'tools/demo-seed-pilot/generator.mjs'))
if (manifest.environment !== 'OFFLINE_DEMO' || manifest.generator_sha256 !== sha(generatorSource) || manifest.fixture_file_sha256 !== sha(fixtureRaw) || manifest.logical_sha256 !== logicalHash(data) || logicalHash(generate(data.config)) !== manifest.logical_sha256) throw Error('fixture mismatch')
const q = v => v == null ? 'NULL' : typeof v === 'boolean' ? String(v) : typeof v === 'number' ? String(v) : `'${String(v).replaceAll("'", "''")}'`
const json = v => `${q(JSON.stringify(v))}::jsonb`
const source = q(data.config.source_id), epoch = q(data.config.epoch)
const statements = []
for (const [i, c] of data.categories.entries()) statements.push(`INSERT INTO catalog_cdc_categories_current (source_id,coverage_epoch_id,category_id,name,is_active,is_internal,soft_deleted,last_topic_offset) VALUES (${source},${epoch},${q(c.category_id)},${q(c.name)},true,false,false,${i}) ON CONFLICT DO NOTHING;`)
for (const [i, p] of data.products.entries()) {
  statements.push(`INSERT INTO catalog_cdc_products_current (source_id,coverage_epoch_id,product_id,title,status,soft_deleted,last_topic_offset) VALUES (${source},${epoch},${q(p.product_id)},${q(p.title)},'published',false,${i}) ON CONFLICT DO NOTHING;`)
  statements.push(`INSERT INTO catalog_cdc_variants_current (source_id,coverage_epoch_id,variant_id,product_id,title,manage_inventory,allow_backorder,soft_deleted,last_topic_offset) VALUES (${source},${epoch},${q(p.variant_id)},${q(p.product_id)},'Default',true,false,false,${i}) ON CONFLICT DO NOTHING;`)
  if (p.category_id) statements.push(`INSERT INTO catalog_cdc_product_categories_current (source_id,coverage_epoch_id,product_id,category_id,last_topic_offset) VALUES (${source},${epoch},${q(p.product_id)},${q(p.category_id)},${i}) ON CONFLICT DO NOTHING;`)
}
for (const c of data.carts) statements.push(`INSERT INTO cart_cdc_line_state VALUES (${source},${epoch},${q(c.line_item_id)},${q(c.cart_id)},${q(c.product_id)},${q(c.variant_id)},${c.quantity},false,${q(c.updated_at)}) ON CONFLICT DO NOTHING;`)
for (const [i, o] of data.orders.entries()) {
  const record = `synthetic-baseline-${i}`
  statements.push(`INSERT INTO reference_cdc_v2_record_inbox (record_id,source_instance_id,coverage_epoch_id,fact_topic,order_id,record_type,payload,kafka_partition,kafka_offset) VALUES (${q(record)},${source},${epoch},'synthetic-demo-baseline',${q(o.order_id)},'BASELINE',${json({ synthetic: true })},0,${i}) ON CONFLICT DO NOTHING;`)
  statements.push(`INSERT INTO reference_cdc_v2_order_current_state (source_instance_id,coverage_epoch_id,order_id,cart_id,active,last_record_id,last_topic_offset) VALUES (${source},${epoch},${q(o.order_id)},${q(o.cart_id)},${q(o.active)},${q(record)},${i}) ON CONFLICT DO NOTHING;`)
}
statements.push(`INSERT INTO reference_cdc_v2_quality_state (source_instance_id,coverage_epoch_id,status,historical_gap_status,reason) VALUES (${source},${epoch},'BLOCKED_BY_QUALITY','INCOMPLETE','Synthetic pilot; no source coverage attestation') ON CONFLICT DO NOTHING;`)
// Ingestion time is supplied by PostgreSQL at actual insertion; it is excluded from the logical seed hash.
for (const e of data.events) {
  const c = canonicalFor(e, data.config, new Date().toISOString())
  const doc = `(jsonb_set(jsonb_set(${json(c)},'{ingested_at}',to_jsonb(transaction_timestamp())), '{normalized_at}',to_jsonb(transaction_timestamp())))`
  statements.push(`INSERT INTO canonical_events (canonical_event_id,source_id,source_event_id,event_type,event_class,canonical_schema_version,mapping_version,occurred_at,produced_at,ingested_at,normalized_at,aggregate_type,aggregate_id,relations,identity,data,quality,raw_record_id,raw_content_hash,raw_byte_size,canonical_document) VALUES (${q(c.canonical_event_id)},${source},${q(c.source_event_id)},${q(c.event_type)},${q(c.event_class)},${q(c.canonical_schema_version)},${q(c.mapping_version)},${q(c.occurred_at)},${q(c.produced_at)},transaction_timestamp(),transaction_timestamp(),${q(c.aggregate?.type)},${q(c.aggregate?.id)},${json(c.relations ?? null)},${json(c.identity ?? null)},${json(c.data)},${json(c.quality)},${q(c.source_reference.raw_record_id)},${q(c.source_reference.content_hash)},${c.source_reference.byte_size},${doc}) ON CONFLICT DO NOTHING;`)
  if (!e.cdc) {
    const envelope = browserEnvelope(e, data.config)
    const raw = { ingestion_id: c.source_reference.raw_record_id, received_at: new Date().toISOString(), raw_body: JSON.stringify(envelope) }
    const observation = extractTrafficSourceObservation({ key: JSON.stringify([envelope.source_id, envelope.event_id]), value: JSON.stringify(raw) })
    if (observation.raw_content_hash !== c.source_reference.content_hash) throw Error('synthetic raw lineage hash mismatch')
    statements.push(`INSERT INTO traffic_source_raw_events_v1 (source_id,source_event_id,source_event_type,source_schema_version,raw_record_id,raw_content_hash,received_at,utm_source_state,utm_source_hash,synthetic) VALUES (${source},${q(observation.source_event_id)},${q(observation.source_event_type)},${q(observation.source_schema_version)},${q(observation.raw_record_id)},${q(observation.raw_content_hash)},transaction_timestamp(),${q(observation.utm_source_state)},${q(observation.utm_source_hash)},true) ON CONFLICT DO NOTHING;`)
  }
}
for (const label of ['organic', 'newsletter', 'social']) {
  const hash = createHash('sha256').update(label).digest('hex')
  statements.push(`INSERT INTO traffic_source_registry_v1 (source_id,raw_utm_source_hash,canonical_label,created_by,updated_by) VALUES (${source},${q(hash)},${q(label)},'00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001') ON CONFLICT DO NOTHING;`)
}
const migrations = await Promise.all(['001_canonical_ledger.sql', '002_journey_projection.sql', '003_funnel_projection.sql', '004_kpi_projection.sql', '021_catalog_cdc_candidate.sql', '022_inventory_price_cdc_context_candidate.sql', '023_reference_order_cdc_v2_candidate.sql', '028_reference_cdc_v2_profile_candidate.sql', '031_cart_line_item_cdc.sql'].map(name => readFile(resolve(root, 'infra/postgres/v2', name), 'utf8')))
const trafficMigrations = await Promise.all(['001_raw_utm_source.sql','002_source_registry.sql'].map(name => readFile(resolve(root, 'infra/postgres/traffic', name), 'utf8')))
const exploreViews = await readFile(resolve(root, 'tools/dbgpt-metadata-sync/exploration-views.sql'), 'utf8')
const demoViews = `CREATE SCHEMA funnelmetry_demo;
CREATE VIEW funnelmetry_demo.traffic_observations AS SELECT e.source_id,e.event_type,e.occurred_at,t.received_at,t.utm_source_state,CASE WHEN t.utm_source_state='ABSENT' THEN 'ABSENT' WHEN t.utm_source_state='INVALID' THEN 'INVALID' ELSE coalesce(r.canonical_label,'UNMAPPED') END AS utm_label FROM canonical_events e JOIN traffic_source_raw_events_v1 t ON e.source_id=t.source_id AND e.source_event_id=t.source_event_id LEFT JOIN traffic_source_registry_v1 r ON r.source_id=t.source_id AND r.raw_utm_source_hash=t.utm_source_hash WHERE e.source_id=${source} AND t.synthetic;
CREATE VIEW funnelmetry_demo.browser_sessions AS SELECT e.source_id,e.occurred_at,e.identity->>'session_id' AS session_id FROM canonical_events e JOIN traffic_source_raw_events_v1 t ON e.source_id=t.source_id AND e.source_event_id=t.source_event_id WHERE e.source_id=${source} AND t.synthetic;
GRANT USAGE ON SCHEMA funnelmetry_demo TO funnelmetry_ai_agent;
GRANT SELECT ON ALL TABLES IN SCHEMA funnelmetry_demo TO funnelmetry_ai_agent;`
const load = `BEGIN;\n${statements.join('\n')}\nCOMMIT;\n`
const check = `SELECT json_build_object('products',(SELECT count(*) FROM catalog_cdc_products_current),'variants',(SELECT count(*) FROM catalog_cdc_variants_current),'categories',(SELECT count(*) FROM catalog_cdc_categories_current),'cart_lines',(SELECT count(*) FROM cart_cdc_line_state),'recorded_orders',(SELECT count(*) FROM reference_cdc_v2_order_current_state),'active_recorded_orders',(SELECT count(*) FROM reference_cdc_v2_order_current_state WHERE active),'events',(SELECT count(*) FROM canonical_events),'cart_added',(SELECT count(*) FROM canonical_events WHERE event_type='cart.item_added'),'searches',(SELECT count(*) FROM canonical_events WHERE event_type='behavior.search_query_submitted'),'cart_links',(SELECT count(*) FROM canonical_events WHERE event_type='context.cart_linked'),'orphans',(SELECT count(*) FROM cart_cdc_line_state c LEFT JOIN catalog_cdc_variants_current v ON c.source_id=v.source_id AND c.coverage_epoch_id=v.coverage_epoch_id AND c.variant_id=v.variant_id WHERE v.variant_id IS NULL),'orphan_orders',(SELECT count(*) FROM reference_cdc_v2_order_current_state o WHERE NOT EXISTS (SELECT 1 FROM cart_cdc_line_state c WHERE c.source_id=o.source_instance_id AND c.coverage_epoch_id=o.coverage_epoch_id AND c.cart_id=o.cart_id)),'bad_time',(SELECT count(*) FROM canonical_events WHERE ingested_at < occurred_at),'gap',(SELECT historical_gap_status FROM reference_cdc_v2_quality_state),'quality',(SELECT status FROM reference_cdc_v2_quality_state));`
const name = `funnelmetry-demo-pilot-${randomUUID().slice(0, 8)}`
function run(args, input, allowFail = false) {
  const result = spawnSync('docker', args, { input, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 })
  if (result.error || (result.status !== 0 && !allowFail)) throw Error(`docker ${args[0]} failed: ${result.error?.message ?? result.stderr}`)
  return result.stdout
}
const sql = text => run(['exec', '-i', name, 'psql', '-q', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'funnelmetry_demo_pilot', '-At'], text)
let started = false
try {
  run(['run', '-d', '--rm', '--network', 'none', '--name', name, '-e', 'POSTGRES_PASSWORD=disposable-pilot-only', '-e', 'POSTGRES_DB=funnelmetry_demo_pilot', 'postgres:15-alpine'])
  started = true
  let ready = false
  for (let i = 0; i < 30; i++) {
    const logs = spawnSync('docker', ['logs', name], { encoding: 'utf8' })
    const result = spawnSync('docker', ['exec', name, 'pg_isready', '-U', 'postgres', '-d', 'funnelmetry_demo_pilot'], { encoding: 'utf8' })
    // initdb starts a temporary server and then stops it; wait for final startup.
    if ((logs.stdout + logs.stderr).includes('PostgreSQL init process complete') && result.status === 0) { ready = true; break }
    await new Promise(r => setTimeout(r, 1000))
  }
  if (!ready) throw Error('disposable PostgreSQL did not become ready')
  sql('CREATE ROLE funnelmetry_ai_agent NOLOGIN; REVOKE CREATE ON SCHEMA public FROM PUBLIC;\n' + migrations.join('\n') + trafficMigrations.join('\n') + exploreViews + demoViews)
  sql(load)
  const first = JSON.parse(sql(check).trim())
  sql(load) // Idempotent insert replay, not a CDC replay certification.
  const second = JSON.parse(sql(check).trim())
  const expected = summarize(data)
  if (JSON.stringify(first) !== JSON.stringify(second) || first.products !== expected.products || first.variants !== expected.products || first.categories !== expected.categories || first.cart_lines !== expected.cart_lines || first.recorded_orders !== expected.recorded_orders || first.active_recorded_orders !== expected.active_recorded_orders || first.events !== expected.events || first.cart_added !== expected.event_types['cart.item_added'] || first.searches !== expected.event_types['behavior.search_query_submitted'] || first.cart_links !== expected.event_types['context.cart_linked'] || first.orphans !== 0 || first.orphan_orders !== 0 || first.bad_time !== 0 || first.gap !== 'INCOMPLETE' || first.quality !== 'BLOCKED_BY_QUALITY') throw Error(`SQL reconciliation failed: ${JSON.stringify(first)}`)
  const questions = goldenQuestions(data), answers = []
  const sorted = value => JSON.stringify(value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).sort()) : value)
  for (const question of questions.filter(x => x.sql)) {
    const actual = JSON.parse(sql(`SET ROLE funnelmetry_ai_agent; ${question.sql};`).trim())
    if (sorted(actual) !== sorted(question.expected)) throw Error(`golden ${question.id} failed: ${JSON.stringify(actual)} expected ${JSON.stringify(question.expected)}`)
    answers.push({ ...question, actual, result: 'PASS' })
  }
  const expectedUnmapped = questions.find(x => x.id === 'G10').expected.organic
  const unmapped = Number(sql("BEGIN; DELETE FROM traffic_source_registry_v1 WHERE canonical_label='organic'; SET ROLE funnelmetry_ai_agent; SELECT count(*) FROM funnelmetry_demo.traffic_observations WHERE utm_label='UNMAPPED'; RESET ROLE; ROLLBACK;").trim())
  if (unmapped !== expectedUnmapped) throw Error('present but unmapped UTM must not be counted as absent')
  const privilege = JSON.parse(sql("SELECT json_build_object('read_view',has_table_privilege('funnelmetry_ai_agent','funnelmetry_explore.behavior_events','SELECT'),'write_table',has_table_privilege('funnelmetry_ai_agent','canonical_events','INSERT'),'raw_table',has_table_privilege('funnelmetry_ai_agent','traffic_source_raw_events_v1','SELECT'),'create_schema',has_schema_privilege('funnelmetry_ai_agent','public','CREATE'));" ).trim())
  if (!privilege.read_view || privilege.write_table || privilege.raw_table || privilege.create_schema) throw Error(`invalid demo role permissions ${JSON.stringify(privilege)}`)
  const denied = spawnSync('docker', ['exec', '-i', name, 'psql', '-q', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'funnelmetry_demo_pilot', '-At'], { input: "SET ROLE funnelmetry_ai_agent; DELETE FROM canonical_events;", encoding: 'utf8' })
  if (denied.status === 0 || !denied.stderr.includes('permission denied')) throw Error('expected a real write attempt to be denied')
  // Run the real mapper over a private docker-exec stream to local PostgreSQL.
  // No host port or container network is created. This tests one CDC record, not Kafka itself.
  const require = createRequire(resolve(root, 'workers/traffic-source-writer/package.json'))
  const { Client } = require('pg')
  const tunnel = spawn('docker', ['exec', '-i', name, 'nc', '127.0.0.1', '5432'], { stdio: ['pipe', 'pipe', 'pipe'] })
  const stream = Duplex.from({ writable: tunnel.stdin, readable: tunnel.stdout })
  stream.setNoDelay = () => stream
  stream.setKeepAlive = () => stream
  stream.connect = () => { process.nextTick(() => stream.emit('connect')); return stream }
  const client = new Client({ user: 'postgres', password: 'disposable-pilot-only', database: 'funnelmetry_demo_pilot', stream, connectionTimeoutMillis: 5000 })
  let mapperReplay
  let connected = false
  try {
    await client.connect()
    connected = true
    const cart = data.events.find(e => e.cdc).cdc
    const input = { sourceId: 'demo-replay-pilot', epochId: data.config.epoch, prefix: 'demo_cart', topic: cart.topic, partition: 0, offset: 0, key: { id: cart.raw.after.id }, value: cart.raw }
    await persistCartChange(client, input)
    await persistCartChange(client, input)
    let gapRejected = false
    try { await persistCartChange(client, { ...input, offset: 2 }) } catch (error) { if (!String(error.message).includes('cart_cdc_offset_gap')) throw error; gapRejected = true }
    const replay = await client.query(`SELECT (SELECT count(*)::int FROM cart_cdc_line_state WHERE source_id=$1) AS lines,(SELECT count(*)::int FROM cart_cdc_canonical_outbox WHERE source_id=$1) AS outbox,(SELECT next_offset::int FROM cart_cdc_input_offsets WHERE source_id=$1) AS next_offset`, [input.sourceId])
    mapperReplay = { ...replay.rows[0], gap_rejected: gapRejected }
    if (mapperReplay.lines !== 1 || mapperReplay.outbox !== 1 || mapperReplay.next_offset !== 1 || !gapRejected) throw Error(`mapper replay failed ${JSON.stringify(mapperReplay)}`)
  } finally { if (connected) await client.end().catch(() => {}); tunnel.kill() }
  console.log(JSON.stringify({ fixture_postgres_reconciliation: 'PASS', checked_at: new Date().toISOString(), logical_sha256: manifest.logical_sha256, replay: 'idempotent fixture insertion; one real mapper input duplicate and offset-gap check', mapper_replay: mapperReplay, source_cdc_coverage: 'not certified', demo_role_privileges: privilege, write_attempt: 'DENIED', utm_unmapped_test: { unmapped_events: unmapped, result: 'PASS' }, golden_questions: answers, unsupported_questions: questions.filter(x => !x.sql), results: first }, null, 2))
} finally {
  if (started) run(['stop', '-t', '2', name], undefined, true)
}
