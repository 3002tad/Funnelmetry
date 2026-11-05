// Only creates a fresh, network-isolated disposable PostgreSQL container.
import { spawnSync } from 'node:child_process'
import { randomUUID,createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve,dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { generateExpanded,hash,summarizeExpanded,addCatalogLabels } from './expanded.mjs'

const [anchorPath,dir,labelsPath]=process.argv.slice(2)
if(!anchorPath||!dir) throw Error('Usage: expanded-postgres-check.mjs <anchor> <fixture-directory>')
const [anchorRaw,fixtureRaw,manifestRaw,generatorRaw]=await Promise.all([readFile(resolve(anchorPath)),readFile(resolve(dir,'fixture.json')),readFile(resolve(dir,'manifest.json'),'utf8'),readFile(resolve(dirname(fileURLToPath(import.meta.url)),'expanded.mjs'))])
const rawLabels=labelsPath?await readFile(resolve(labelsPath)):null
const sha=x=>createHash('sha256').update(x).digest('hex'),anchor=rawLabels?addCatalogLabels(JSON.parse(anchorRaw),JSON.parse(rawLabels.toString('utf8').replace(/^\uFEFF/,''))):JSON.parse(anchorRaw),data=JSON.parse(fixtureRaw),manifest=JSON.parse(manifestRaw)
if(manifest.environment!=='OFFLINE_DEMO'||manifest.labels_sha256!==(rawLabels?sha(rawLabels):null)||manifest.anchor_sha256!==sha(anchorRaw)||manifest.generator_sha256!==sha(generatorRaw)||manifest.fixture_sha256!==sha(fixtureRaw)||manifest.logical_sha256!==hash(data)||manifest.logical_sha256!==hash(generateExpanded(anchor,data.config))) throw Error('fixture_verification_failed')
const q=s=>`'${String(s).replaceAll("'","''")}'`
import { schemas } from './expanded-schema.mjs'

if(JSON.stringify(Object.keys(schemas).sort())!==JSON.stringify(Object.keys(data.rows).sort())) throw Error('unexpected_domains')
const name=`funnelmetry-demo-expanded-${randomUUID().slice(0,8)}`
function run(args,input,allowFail=false){const r=spawnSync('docker',args,{input,encoding:'utf8',maxBuffer:64*1024*1024});if(r.error||(!allowFail&&r.status!==0))throw Error(`docker ${args[0]} failed: ${r.error?.message??r.stderr}`);return r}
const sql=s=>run(['exec','-i',name,'psql','-X','-q','-v','ON_ERROR_STOP=1','-U','postgres','-d','demo','-At'],s).stdout.trim()
const createViews=Object.entries(schemas).map(([name,columns])=>`CREATE VIEW demo.${name} AS SELECT r.dataset_id,r.origin,r.loaded_at,t.* FROM demo.records r CROSS JOIN LATERAL jsonb_to_record(r.payload) AS t(${columns}) WHERE r.domain=${q(name)};`).join('\n')
let started=false
try {
 run(['run','-d','--rm','--network','none','--name',name,'-e','POSTGRES_PASSWORD=disposable-pilot-only','-e','POSTGRES_DB=demo','postgres:15-alpine']);started=true
 let ready=false
 for(let i=0;i<30;i++){const logs=run(['logs',name],null,true),check=run(['exec',name,'pg_isready','-U','postgres','-d','demo'],null,true);if((logs.stdout+logs.stderr).includes('PostgreSQL init process complete')&&check.status===0){ready=true;break}await new Promise(r=>setTimeout(r,1000))}
 if(!ready)throw Error('postgres_not_ready')
 sql(`CREATE ROLE demo_reader NOLOGIN; REVOKE CREATE ON SCHEMA public FROM PUBLIC; CREATE SCHEMA demo; CREATE TABLE demo.manifest(dataset_id text PRIMARY KEY, logical_sha256 text NOT NULL, manifest jsonb NOT NULL, loaded_at timestamptz NOT NULL DEFAULT clock_timestamp()); CREATE TABLE demo.records(dataset_id text NOT NULL REFERENCES demo.manifest(dataset_id),domain text NOT NULL,ordinal int NOT NULL,origin text NOT NULL CHECK(origin='SYNTHETIC_BACKFILL'),payload jsonb NOT NULL,loaded_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(dataset_id,domain,ordinal)); ${createViews} GRANT USAGE ON SCHEMA demo TO demo_reader; GRANT SELECT ON ALL TABLES IN SCHEMA demo TO demo_reader;`)
 const load=`BEGIN; INSERT INTO demo.manifest(dataset_id,logical_sha256,manifest) VALUES(${q(data.config.dataset_id)},${q(manifest.logical_sha256)},${q(JSON.stringify(manifest))}::jsonb) ON CONFLICT(dataset_id) DO NOTHING; INSERT INTO demo.records(dataset_id,domain,ordinal,origin,payload) SELECT ${q(data.config.dataset_id)},d.key,r.ordinality, 'SYNTHETIC_BACKFILL',r.value FROM jsonb_each(${q(JSON.stringify(data.rows))}::jsonb) d CROSS JOIN LATERAL jsonb_array_elements(d.value) WITH ORDINALITY r(value,ordinality) ON CONFLICT(dataset_id,domain,ordinal) DO NOTHING; COMMIT;`
 sql(load);const before=JSON.parse(sql("SELECT json_object_agg(domain,n) FROM (SELECT domain,count(*) n FROM demo.records GROUP BY domain) x"));sql(load);const after=JSON.parse(sql("SELECT json_object_agg(domain,n) FROM (SELECT domain,count(*) n FROM demo.records GROUP BY domain) x"))
 for(const [domain,n] of Object.entries(summarizeExpanded(data)))if(before[domain]!==n||after[domain]!==n)throw Error(`row_count_or_replay_${domain}`)
 const checks=JSON.parse(sql(`SET ROLE demo_reader; SELECT json_build_object(
 'variant_orphans',(SELECT count(*) FROM demo.catalog_variants v LEFT JOIN demo.catalog_products p ON p.product_id=v.product_id WHERE p.product_id IS NULL),
 'category_orphans',(SELECT count(*) FROM demo.product_categories b LEFT JOIN demo.catalog_products p ON p.product_id=b.product_id LEFT JOIN demo.catalog_categories c ON c.category_id=b.category_id WHERE p.product_id IS NULL OR c.category_id IS NULL),
 'event_orphans',(SELECT count(*) FROM demo.browser_events e LEFT JOIN demo.sessions s USING(session_id) WHERE s.session_id IS NULL),
 'event_product_orphans',(SELECT count(*) FROM demo.browser_events e LEFT JOIN demo.catalog_variants v ON v.variant_id=e.data->>'variant_id' AND v.product_id=e.data->>'product_id' WHERE e.event_type='behavior.product_viewed' AND v.variant_id IS NULL),
 'cart_line_orphans',(SELECT count(*) FROM demo.cart_changes c LEFT JOIN demo.catalog_variants v ON v.variant_id=c.variant_key AND v.product_id=c.product_key WHERE v.variant_id IS NULL OR c.before_quantity<0 OR c.after_quantity<0 OR (c.change_type='ADD' AND c.after_quantity<=c.before_quantity) OR (c.change_type='DECREASE' AND NOT(c.after_quantity>0 AND c.after_quantity<c.before_quantity)) OR (c.change_type='DELETE' AND NOT(c.after_quantity=0 AND c.before_quantity>0))),
 'cart_revision_gaps',(SELECT count(*) FROM (SELECT revision,before_quantity,lag(after_quantity) OVER(PARTITION BY cart_id,line_item_id ORDER BY revision) previous,lag(revision) OVER(PARTITION BY cart_id,line_item_id ORDER BY revision) previous_revision FROM demo.cart_changes) x WHERE (revision=1 AND before_quantity<>0) OR (revision>1 AND (previous IS NULL OR before_quantity<>previous OR revision<>previous_revision+1))),
 'link_orphans',(SELECT count(*) FROM demo.cart_links l LEFT JOIN demo.browser_events e ON e.event_id=l.event_id AND e.session_id=l.session_id AND e.event_type='context.cart_linked' AND e.data->>'cart_id'=l.cart_id WHERE e.event_id IS NULL OR NOT EXISTS(SELECT 1 FROM demo.cart_changes c WHERE c.cart_id=l.cart_id)),
 'order_orphans',(SELECT count(*) FROM demo.orders o LEFT JOIN demo.browser_events e ON e.event_id=o.checkout_event_id AND e.event_type='checkout.started' AND e.data->>'cart_id'=o.cart_id WHERE e.event_id IS NULL OR NOT EXISTS(SELECT 1 FROM demo.cart_changes c WHERE c.cart_id=o.cart_id)),
 'order_line_orphans',(SELECT count(*) FROM demo.order_lines l LEFT JOIN demo.orders o USING(order_id) LEFT JOIN demo.catalog_variants v ON v.variant_id=l.variant_key AND v.product_id=l.product_key WHERE o.order_id IS NULL OR v.variant_id IS NULL OR o.currency<>l.currency),
 'price_at_order_mismatch',(SELECT count(*) FROM demo.order_lines l LEFT JOIN demo.offer_prices p ON p.variant_key=l.variant_key AND p.currency=l.currency AND p.price_rule=l.price_rule AND p.effective_at<=l.ordered_at AND l.ordered_at<p.valid_to WHERE p.variant_key IS NULL OR p.amount_minor<>l.unit_amount_minor OR l.line_total_minor<>l.quantity*l.unit_amount_minor),
 'payment_orphans',(SELECT count(*) FROM demo.payments p LEFT JOIN demo.orders o USING(order_id) WHERE o.order_id IS NULL OR p.currency<>o.currency OR p.action_at<o.created_at),
 'fulfillment_orphans',(SELECT count(*) FROM demo.fulfillments f LEFT JOIN demo.orders o USING(order_id) WHERE o.order_id IS NULL OR f.occurred_at<o.created_at OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(f.line_ids) x WHERE NOT EXISTS(SELECT 1 FROM demo.order_lines l WHERE l.order_id=f.order_id AND l.line_id=x))),
 'customer_orphans',(SELECT count(*) FROM demo.customer_evidence e LEFT JOIN demo.orders o USING(order_id) WHERE o.order_id IS NULL OR o.customer_key<>e.customer_key OR o.cart_id<>e.cart_id OR NOT EXISTS(SELECT 1 FROM demo.sessions s WHERE s.session_id=e.session_id AND s.customer_key=e.customer_key)),
 'bad_stock',(SELECT count(*) FROM demo.stock_positions WHERE stocked<0 OR reserved<0 OR reserved>stocked OR required_quantity<=0 OR valid_to<=effective_at),
 'price_overlaps',(SELECT count(*) FROM demo.offer_prices a JOIN demo.offer_prices b ON a.variant_key=b.variant_key AND a.currency=b.currency AND a.channel=b.channel AND a.region=b.region AND a.price_rule=b.price_rule AND a.revision<b.revision AND tstzrange(a.effective_at,a.valid_to,'[)') && tstzrange(b.effective_at,b.valid_to,'[)')),
 'stock_overlaps',(SELECT count(*) FROM demo.stock_positions a JOIN demo.stock_positions b ON a.inventory_item_key=b.inventory_item_key AND a.location=b.location AND a.revision<b.revision AND tstzrange(a.effective_at,a.valid_to,'[)') && tstzrange(b.effective_at,b.valid_to,'[)')),
 'payment_overages',(SELECT count(*) FROM (SELECT o.order_id,(SELECT coalesce(sum(l.line_total_minor),0) FROM demo.order_lines l WHERE l.order_id=o.order_id) total,(SELECT coalesce(sum(p.amount_minor),0) FROM demo.payments p WHERE p.order_id=o.order_id AND p.action='CAPTURED') captured,(SELECT coalesce(sum(p.amount_minor),0) FROM demo.payments p WHERE p.order_id=o.order_id AND p.action='REFUNDED') refunded FROM demo.orders o) x WHERE captured>total OR refunded>captured),
 'time_mismatch',(SELECT count(*) FROM demo.browser_events e JOIN demo.sessions s USING(session_id) WHERE e.occurred_at<s.started_at OR e.occurred_at>s.ended_at OR e.loaded_at<=e.occurred_at),
 'latest_state_mismatch',(SELECT count(*) FROM demo.orders o WHERE o.reference_state<>(SELECT t.state FROM demo.order_transitions t WHERE t.order_id=o.order_id ORDER BY t.transition_at DESC LIMIT 1)),
 'events',(SELECT count(*) FROM demo.browser_events), 'distinct_sessions',(SELECT count(DISTINCT session_id) FROM demo.browser_events),
 'line_total',(SELECT coalesce(sum(line_total_minor),0) FROM demo.order_lines WHERE currency='EUR'),
 'capture',(SELECT coalesce(sum(amount_minor),0) FROM demo.payments WHERE action='CAPTURED' AND currency='EUR'),
 'refund',(SELECT coalesce(sum(amount_minor),0) FROM demo.payments WHERE action='REFUNDED' AND currency='EUR'),
 'terminal_linked',(SELECT count(*) FROM demo.orders o WHERE o.reference_state='ON' AND EXISTS(SELECT 1 FROM demo.cart_links l WHERE l.cart_id=o.cart_id)),
 'unlinked',(SELECT count(*) FROM demo.orders o WHERE NOT EXISTS(SELECT 1 FROM demo.cart_links l WHERE l.cart_id=o.cart_id)),
 'repeat_customers',(SELECT count(*) FROM (SELECT customer_key FROM demo.customer_evidence GROUP BY customer_key HAVING count(DISTINCT order_id)>1) x),
 'partial_ship_orders',(SELECT count(*) FROM (SELECT order_id FROM demo.fulfillments WHERE state='SHIPPED' GROUP BY order_id HAVING count(DISTINCT fulfillment_id)>1) x),
 'read',(SELECT has_table_privilege('demo_reader','demo.browser_events','SELECT')),'write',(SELECT has_table_privilege('demo_reader','demo.records','INSERT')));`))
 const zero=['variant_orphans','category_orphans','event_orphans','event_product_orphans','cart_line_orphans','cart_revision_gaps','link_orphans','order_orphans','order_line_orphans','price_at_order_mismatch','payment_orphans','fulfillment_orphans','customer_orphans','bad_stock','price_overlaps','stock_overlaps','payment_overages','time_mismatch','latest_state_mismatch']
 for(const key of zero)if(checks[key]!==0)throw Error(`integrity_${key}:${checks[key]}`)
 const sum=(rows,filter,value)=>rows.filter(filter).reduce((a,b)=>a+value(b),0),expected={events:data.rows.browser_events.length,distinct_sessions:data.rows.sessions.length,line_total:sum(data.rows.order_lines,x=>x.currency==='EUR',x=>x.line_total_minor),capture:sum(data.rows.payments,x=>x.action==='CAPTURED'&&x.currency==='EUR',x=>x.amount_minor),refund:sum(data.rows.payments,x=>x.action==='REFUNDED'&&x.currency==='EUR',x=>x.amount_minor),terminal_linked:data.rows.orders.filter(o=>o.reference_state==='ON'&&data.rows.cart_links.some(l=>l.cart_id===o.cart_id)).length,unlinked:data.rows.orders.filter(o=>!data.rows.cart_links.some(l=>l.cart_id===o.cart_id)).length}
 for(const [key,value] of Object.entries(expected))if(Number(checks[key])!==value)throw Error(`golden_${key}:${checks[key]}!=${value}`)
 if(!checks.repeat_customers||!checks.partial_ship_orders)throw Error('missing_pilot_scenario_repeat_customer_or_partial_shipment')
 const group=(items,key)=>items.reduce((a,x)=>(a[key(x)]=(a[key(x)]??0)+1,a),{})
 const orderKeys=o=>JSON.stringify(Object.fromEntries(Object.entries(o).sort(([a],[b])=>a.localeCompare(b))))
 const categoryExpected={}
 for(const e of data.rows.browser_events.filter(e=>e.event_type==='behavior.product_viewed'))for(const b of data.rows.category_history.filter(x=>x.product_id===e.data.product_id&&x.valid_from<=e.occurred_at&&e.occurred_at<x.valid_to))categoryExpected[b.category_id]=(categoryExpected[b.category_id]??0)+1
 const groups=[
  ['daily_events',group(data.rows.browser_events,e=>e.occurred_at.slice(0,10)),"SELECT coalesce(json_object_agg(day_key,n),'{}') FROM (SELECT to_char(occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD') AS day_key,count(*) n FROM demo.browser_events GROUP BY 1) q"],
  ['utm_sessions',group(data.rows.sessions,s=>s.utm_source??'ABSENT'),"SELECT coalesce(json_object_agg(source,n),'{}') FROM (SELECT coalesce(utm_source,'ABSENT') source,count(*) n FROM demo.sessions GROUP BY 1) q"],
  ['product_view_category',categoryExpected,"SELECT coalesce(json_object_agg(category_id,n),'{}') FROM (SELECT b.category_id,count(*) n FROM demo.browser_events e JOIN demo.category_history b ON b.product_id=e.data->>'product_id' AND b.valid_from<=e.occurred_at AND e.occurred_at<b.valid_to WHERE e.event_type='behavior.product_viewed' GROUP BY b.category_id) q"]
 ]
 for(const [label,want,query] of groups){const actual=JSON.parse(sql(`SET ROLE demo_reader; ${query};`));if(orderKeys(actual)!==orderKeys(want))throw Error(`golden_group_${label}`)}
 const stockExpected=data.rows.stock_positions.filter(x=>x.revision===1&&x.manage_inventory&&!x.allow_backorder&&x.channel==='web'&&x.location==='warehouse-eu').reduce((n,x)=>n+Math.floor((x.stocked-x.reserved)/x.required_quantity),0)
 const stockActual=Number(sql("SET ROLE demo_reader; SELECT sum((stocked-reserved)/required_quantity) FROM demo.stock_positions WHERE revision=1 AND manage_inventory AND NOT allow_backorder AND channel='web' AND location='warehouse-eu';"))
 if(stockActual!==stockExpected)throw Error('golden_stock_available')
 if(!checks.read||checks.write)throw Error('demo_role_privileges')
 const denied=run(['exec','-i',name,'psql','-X','-q','-v','ON_ERROR_STOP=1','-U','postgres','-d','demo','-At'],"SET ROLE demo_reader; DELETE FROM demo.records;",true)
 if(denied.status===0||!denied.stderr.includes('permission denied'))throw Error('read_only_not_enforced')
 console.log(JSON.stringify({status:'PASS',environment:'disposable_postgresql_OFFLINE_DEMO',logical_sha256:manifest.logical_sha256,counts:before,integrity_checks:zero.length,golden_sql:expected,golden_groups:groups.map(x=>x[0]),stock_available_units:stockActual,repeat_customers:checks.repeat_customers,partial_ship_orders:checks.partial_ship_orders,fixture_replay:'PASS',read_only_role:'PASS',source_cdc_coverage:'NOT_CERTIFIED',live_cutover:'UNVERIFIED'},null,2))
} finally {if(started)run(['stop','-t','2',name],null,true)}
