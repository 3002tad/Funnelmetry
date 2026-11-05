import { createHash } from 'node:crypto'
import { validateBehaviorEvent } from '../../packages/behavior-event-catalog/src/index.js'

export const DEFAULTS = Object.freeze({dataset_id:'demo-expanded-pilot-v2', seed:20261105, sessions:2000, start:'2025-11-01T00:00:00.000Z', end:'2026-11-01T00:00:00.000Z', seasonal_weights:[1.65,1.8,0.72,0.78,0.88,0.95,1.0,1.08,1.18,1.08,1.02,1.38],campaigns:[{id:'winter-sale',start_fraction:0.07,end_fraction:0.10,traffic_multiplier:2.4,price_factor:0.85},{id:'summer-sale',start_fraction:0.59,end_fraction:0.62,traffic_multiplier:2,price_factor:0.90}],cart_probability:0.06,search_probability:0.15,product_rank_exponent:2.6,short_session_probability:0.25,long_session_probability:0.08,customer_pool_divisor:10})
export const hash = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex')
const ident = (prefix,n) => `demo-${prefix}-${String(n).padStart(7,'0')}`
const iso = n => new Date(n).toISOString()
function rng(seed) { let x=seed>>>0; return () => ((x=(Math.imul(x,1664525)+1013904223)>>>0)/4294967296) }

export function addCatalogLabels(anchor, labels) {
  if(!labels?.captured_at || !Array.isArray(labels.products) || !Array.isArray(labels.categories)) throw Error('invalid_catalog_labels')
  const lookups={}
  for(const [type,values,field] of [['product',labels.products,'title'],['category',labels.categories,'name']]) {
    const map=new Map(values.map(x=>[x.id,x[field]])),required=anchor.entities.filter(x=>x.entity_type===type)
    if(map.size!==values.length || required.length!==map.size || required.some(x=>typeof map.get(x.source_entity_id)!=='string'||!map.get(x.source_entity_id).trim()))throw Error(`catalog_labels_mismatch_${type}`)
    lookups[type]=new Map(required.map(x=>[x.demo_entity_key,map.get(x.source_entity_id)]))
  }
  return {...anchor,label_capture_at:labels.captured_at,synthetic_catalog:{...anchor.synthetic_catalog,products:anchor.synthetic_catalog.products.map(x=>({...x,title:lookups.product.get(x.product_id)})),categories:anchor.synthetic_catalog.categories.map(x=>({...x,name:lookups.category.get(x.category_id)}))}}
}

// The catalog anchor proves a comparison at snapshot time only. This fixture is synthetic.
export function generateExpanded(anchor, config=DEFAULTS) {
  if(anchor?.version!=='demo-catalog-anchor-snapshot.v1' || anchor.status!=='SNAPSHOT_VERIFIED' || anchor.scope!=='CATALOG_POINT_IN_TIME_ONLY' || !Array.isArray(anchor.entities)) throw Error('invalid_catalog_anchor')
  const start=Date.parse(config.start),end=Date.parse(config.end)
  if(!Number.isSafeInteger(config.seed)||!Number.isInteger(config.sessions)||config.sessions<100||config.sessions>100000||!Number.isFinite(start)||!Number.isFinite(end)||end-start<86400000*30||!Array.isArray(config.seasonal_weights)||config.seasonal_weights.length!==12||config.seasonal_weights.some(x=>!Number.isFinite(x)||x<=0)||!Array.isArray(config.campaigns)||config.campaigns.some(x=>!(x.start_fraction>=0&&x.end_fraction>x.start_fraction&&x.end_fraction<=1&&x.traffic_multiplier>=1&&x.price_factor>0&&x.price_factor<=1))||!(config.cart_probability>=0&&config.cart_probability<=1&&config.search_probability>=0&&config.search_probability<=1&&config.product_rank_exponent>0)) throw Error('invalid_config')
  const catalog=anchor.synthetic_catalog
  if(!catalog||!['products','variants','categories','product_categories'].every(k=>Array.isArray(catalog[k])&&catalog[k].length)) throw Error('empty_catalog')
  const products=new Set(catalog.products.map(x=>x.product_id)), variants=new Set(catalog.variants.map(x=>x.variant_id)), categories=new Set(catalog.categories.map(x=>x.category_id))
  if(products.size!==catalog.products.length || variants.size!==catalog.variants.length || categories.size!==catalog.categories.length || catalog.variants.some(v=>!products.has(v.product_id)) || catalog.product_categories.some(x=>!products.has(x.product_id)||!categories.has(x.category_id))) throw Error('invalid_catalog_relations')
  const entities=anchor.entities, entityKeys=new Set(entities.map(x=>`${x.entity_type}:${x.demo_entity_key}`)), sourceKeys=new Set(entities.map(x=>`${x.entity_type}:${x.source_entity_id}`))
  if(entityKeys.size!==entities.length||sourceKeys.size!==entities.length||entities.some(x=>x.source_id!=='medusa-reference'||x.mapping_status!=='SNAPSHOT_VERIFIED')||[...products].some(k=>!entityKeys.has(`product:${k}`))||[...variants].some(k=>!entityKeys.has(`variant:${k}`))||[...categories].some(k=>!entityKeys.has(`category:${k}`))) throw Error('invalid_anchor_crosswalk')
  const rand=rng(config.seed), rows={catalog_products:catalog.products.map((p,i)=>({...p,title:p.title??`Demo product ${i+1}`,label_origin:p.title?'OBSERVED_LABEL_SNAPSHOT':'SYNTHETIC_LABEL'})),catalog_variants:catalog.variants,catalog_categories:catalog.categories.map((c,i)=>({...c,name:c.name??`Demo category ${i+1}`,label_origin:c.name?'OBSERVED_LABEL_SNAPSHOT':'SYNTHETIC_LABEL'})),product_categories:catalog.product_categories,category_history:[],crosswalk:entities.map(x=>({entity_type:x.entity_type,demo_entity_key:x.demo_entity_key,source_id:x.source_id,source_entity_id:x.source_entity_id,mapping_status:x.mapping_status,mapping_evidence:x.mapping_evidence,snapshot_at:x.snapshot_at})),coverage:['catalog','price','inventory','browser','cart','order','payment','fulfillment','customer'].map(domain=>({domain,source_id:'synthetic_history',coverage_epoch:'demo-epoch-v1',interval_start:config.start,interval_end:config.end,status:'UNVERIFIED',basis:'fixture requires independent verification'})),offer_prices:[],stock_positions:[],sessions:[],browser_events:[],cart_changes:[],cart_links:[],orders:[],order_transitions:[],order_lines:[],payments:[],fulfillments:[],customer_evidence:[]}
  const push=(name,row)=>rows[name].push(row), choose=a=>a[Math.floor(rand()*a.length)], variantList=[...catalog.variants].sort((a,b)=>a.variant_id.localeCompare(b.variant_id))
  const span=end-start, campaignAt=t=>config.campaigns.find(c=>t>=start+span*c.start_fraction&&t<start+span*c.end_fraction), maxWeight=Math.max(...config.seasonal_weights)*Math.max(1,...config.campaigns.map(c=>c.traffic_multiplier))
  const sampleTime=()=>{for(let i=0;i<100000;i++){const t=start+Math.floor(rand()*(span-20000)),monthOffset=(new Date(t).getUTCFullYear()-new Date(start).getUTCFullYear())*12+new Date(t).getUTCMonth()-new Date(start).getUTCMonth(),weight=config.seasonal_weights[((monthOffset%12)+12)%12]*(campaignAt(t)?.traffic_multiplier??1);if(rand()*maxWeight<weight)return t}throw Error('time_sampler_exhausted')}
  const split=start+Math.floor(span*0.55), categoryList=[...categories].sort()
  for(const [i,bridge] of catalog.product_categories.entries()) {const changed=categoryList.length>1&&i%8===0,previous=changed?categoryList[(categoryList.indexOf(bridge.category_id)+1)%categoryList.length]:bridge.category_id;if(changed)push('category_history',{...bridge,category_id:previous,revision:1,valid_from:iso(start),valid_to:iso(split)});push('category_history',{...bridge,revision:changed?2:1,valid_from:iso(changed?split:start),valid_to:iso(end)})}
  for(const [i,v] of variantList.entries()) {
    const base=500+Math.floor(rand()*9500), mid=start+Math.floor((end-start)*0.55), inventory=`inventory:${v.variant_id}`
    const revised=Math.round(base*(0.85+rand()*0.3))
    for(const [revision,at,amount] of [[1,start,base],[2,mid,revised]]) push('offer_prices',{variant_key:v.variant_id,revision,effective_at:iso(at),valid_to:revision===1?iso(mid):iso(end),currency:'EUR',amount_minor:amount,channel:'web',region:'eu',price_rule:'base'})
    for(const c of config.campaigns) {const from=start+span*c.start_fraction,to=start+span*c.end_fraction;for(const [revision,a,b,amount] of [[1,from,Math.min(to,mid),base],[2,Math.max(from,mid),to,revised]])if(a<b)push('offer_prices',{variant_key:v.variant_id,revision,effective_at:iso(a),valid_to:iso(b),currency:'EUR',amount_minor:Math.round(amount*c.price_factor),channel:'web',region:'eu',price_rule:c.id})}
    for(const location of ['warehouse-eu','warehouse-west']) for(const [revision,at] of [[1,start],[2,mid]]) push('stock_positions',{inventory_item_key:inventory,variant_key:v.variant_id,revision,effective_at:iso(at),valid_to:revision===1?iso(mid):iso(end),location,channel:'web',stocked:80+Math.floor(rand()*120),reserved:Math.floor(rand()*20),incoming:Math.floor(rand()*20),manage_inventory:true,allow_backorder:false,required_quantity:1})
  }
  const priceAt=(v,t)=>{const rule=campaignAt(t)?.id??'base';return rows.offer_prices.find(x=>x.variant_key===v&&x.price_rule===rule&&Date.parse(x.effective_at)<=t&&t<Date.parse(x.valid_to))}
  const addBrowser=(session,type,t,data,utm)=>{validateBehaviorEvent(type,data); push('browser_events',{event_id:ident('event',rows.browser_events.length),session_id:session,event_type:type,occurred_at:iso(t),data,utm_source:utm})}
  const sourceValues=['organic','newsletter','social','paid',null,'unmapped-example']
  for(let i=0;i<config.sessions;i++) {
    const session=ident('session',i),page=`page:${session}`,time=sampleTime(),utm=choose(sourceValues),device=choose(['mobile','desktop','tablet']), customer=rand()<0.45?ident('customer',Math.floor(rand()*Math.max(10,Math.ceil(config.sessions/config.customer_pool_divisor)))):null,mode=rand(),short=mode<config.short_session_probability,long=mode>=1-config.long_session_probability
    // Deliberately skew item popularity and leave a long tail. This is a scenario parameter, not a production claim.
    const v=variantList[Math.floor(Math.pow(rand(),config.product_rank_exponent)*variantList.length)]
    const first=rows.browser_events.length
    addBrowser(session,'behavior.page_viewed',time,{page_type:'product',path_template:'/{countryCode}/products/{handle}',page_instance_id:page},utm)
    if(!short&&rand()<0.72) addBrowser(session,'behavior.product_viewed',time+1000,{product_id:v.product_id,variant_id:v.variant_id,page_instance_id:page},utm)
    if(!short&&rand()<0.34) addBrowser(session,'behavior.scroll_depth_reached',time+2000,{page_type:'product',page_instance_id:page,depth_percent:choose([25,50,75,100])},utm)
    if(long)for(let j=0,n=3+Math.floor(rand()*12);j<n;j++){const extra=variantList[Math.floor(Math.pow(rand(),config.product_rank_exponent)*variantList.length)];addBrowser(session,'behavior.product_viewed',time+2200+j*10,{product_id:extra.product_id,variant_id:extra.variant_id,page_instance_id:page},utm)}
    if(!short&&rand()<config.search_probability) addBrowser(session,'behavior.search_query_submitted',time+3000,{search_interaction_id:`search:${session}`,query_normalized:choose(['travel bag','water bottle','kitchen tool','running shoes']),page_instance_id:page},utm)
    if(rand()<config.cart_probability) {
      const cart=ident('cart',rows.cart_changes.length), lines=[{...v}]
      if(rand()<0.12) lines.push({...choose(variantList)})
      for(const [lineIndex,item] of lines.entries()) push('cart_changes',{cart_id:cart,line_item_id:`${cart}:line:${lineIndex}`,revision:1,product_key:item.product_id,variant_key:item.variant_id,before_quantity:0,after_quantity:1,change_type:'ADD',change_at:iso(time+4000+lineIndex)})
      const mutation=rand();if(mutation<0.3) {const item=lines[0],line=`${cart}:line:0`;push('cart_changes',{cart_id:cart,line_item_id:line,revision:2,product_key:item.product_id,variant_key:item.variant_id,before_quantity:1,after_quantity:2,change_type:'ADD',change_at:iso(time+4500)});if(mutation<0.18){const deleting=mutation<0.08;push('cart_changes',{cart_id:cart,line_item_id:line,revision:3,product_key:item.product_id,variant_key:item.variant_id,before_quantity:2,after_quantity:deleting?0:1,change_type:deleting?'DELETE':'DECREASE',change_at:iso(time+4700)});if(deleting)lines.shift()}else item.quantity=2}
      const linked=rand()<0.92
      if(linked) {addBrowser(session,'context.cart_linked',time+5000,{cart_id:cart,page_instance_id:page},utm);push('cart_links',{session_id:session,cart_id:cart,event_id:rows.browser_events.at(-1).event_id,occurred_at:iso(time+5000),evidence_type:'context.cart_linked'})}
      if(lines.length&&rand()<0.65) {
        addBrowser(session,'checkout.started',time+6000,{cart_id:cart,step:'address',page_instance_id:page},utm)
        if(rand()<0.68) {
          const orderIndex=rows.orders.length,order=ident('order',orderIndex), created=time+10000, active=orderIndex%23!==0
          push('orders',{order_id:order,cart_id:cart,customer_key:customer,status:'pending',currency:'EUR',created_at:iso(created),reference_state:active?'ON':'OFF',transition_at:iso(created+(active?1000:5000)),checkout_event_id:rows.browser_events.at(-1).event_id})
          push('order_transitions',{order_id:order,transition_id:`${order}:on`,state:'ON',transition_at:iso(created+1000),transition_kind:'STREAM'})
          if(!active)push('order_transitions',{order_id:order,transition_id:`${order}:off`,state:'OFF',transition_at:iso(created+5000),transition_kind:'STREAM'})
          let total=0
          for(const [lineIndex,item] of lines.entries()) {const price=priceAt(item.variant_id,created),amount=price.amount_minor,quantity=item.quantity??1;total+=amount*quantity;push('order_lines',{order_id:order,line_id:`${order}:line:${lineIndex}`,product_key:item.product_id,variant_key:item.variant_id,quantity,unit_amount_minor:amount,line_total_minor:amount*quantity,price_rule:price.price_rule,currency:'EUR',ordered_at:iso(created)})}
          const payment=`payment:${order}`, captured=active&&rand()<0.82
          push('payments',{order_id:order,payment_id:payment,action_id:`${payment}:authorize`,action:'AUTHORIZED',amount_minor:total,currency:'EUR',action_at:iso(created+2000)})
          if(captured) {const partial=rand()<0.25,firstCapture=partial?Math.floor(total/2):total;push('payments',{order_id:order,payment_id:payment,action_id:`${payment}:capture:1`,action:'CAPTURED',amount_minor:firstCapture,currency:'EUR',action_at:iso(created+3000)});if(partial)push('payments',{order_id:order,payment_id:payment,action_id:`${payment}:capture:2`,action:'CAPTURED',amount_minor:total-firstCapture,currency:'EUR',action_at:iso(created+4000)});if(rand()<0.15&&created+86400000*5<end)push('payments',{order_id:order,payment_id:payment,action_id:`${payment}:refund:1`,action:'REFUNDED',amount_minor:Math.max(1,Math.floor(total/4)),currency:'EUR',action_at:iso(created+86400000*5)})}
          if(active&&rand()<0.8) {const groups=lines.length>1?lines.map((_,n)=>[`${order}:line:${n}`]):[[`${order}:line:0`]];for(const [n,lineIds] of groups.entries()){const f=`fulfillment:${order}:${n}`,shipped=created+86400000*(1+n),delivery=created+86400000*(2+n+Math.floor(rand()*3)),delivered=rand()<0.85;if(shipped<end)push('fulfillments',{order_id:order,fulfillment_id:f,transition_id:`${f}:shipped`,state:'SHIPPED',occurred_at:iso(shipped),line_ids:lineIds});if(delivered&&delivery<end)push('fulfillments',{order_id:order,fulfillment_id:f,transition_id:`${f}:delivered`,state:'DELIVERED',occurred_at:iso(delivery),line_ids:lineIds})}}
          if(customer)push('customer_evidence',{customer_key:customer,evidence_id:`evidence:${order}`,session_id:session,cart_id:cart,order_id:order,evidence_type:'SYNTHETIC_CUSTOMER_ORDER_LINK',observed_at:iso(created)})
        }
      }
    }
    const events=rows.browser_events.slice(first)
    push('sessions',{session_id:session,started_at:iso(time),ended_at:events.at(-1).occurred_at,event_count:events.length,device,utm_source:utm,customer_key:customer})
  }
  return {config,origin:'SYNTHETIC_BACKFILL',source_id:'synthetic_history',contract_version:'demo-expanded.v2',anchor:{source_snapshot_sha256:anchor.source_snapshot_sha256,projection_snapshot_sha256:anchor.projection_snapshot_sha256,source_captured_at:anchor.source_captured_at,label_capture_at:anchor.label_capture_at??null,scope:anchor.scope,live_cutover_status:'UNVERIFIED',historical_coverage:'INCOMPLETE'},rows}
}
export function summarizeExpanded(data) { return Object.fromEntries(Object.entries(data.rows).map(([k,v])=>[k,v.length])) }
