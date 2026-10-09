import test from 'node:test'
import assert from 'node:assert/strict'
import { alertPolicy, monitoringAlerts, scrapeObservation } from '../src/lib/monitoring-alerts.js'
import { WORKERS } from '../src/lib/worker-readiness.js'
const now = Date.parse('2026-10-10T00:00:00Z')
const policy = alertPolicy({})
const workers = {workers:WORKERS.map(worker=>({worker,status:'READY',ready:true}))}
const credentials=[{id:'test-key',expires_at:'2026-10-17T00:00:00Z'}]
test('known ready has no warning, missing evidence is never healthy',()=>{
  const base={workers,credentials,policy,now,scrape:{state:'OK'}}
  assert.equal(monitoringAlerts(base).status,'NO_CURRENT_WARNINGS')
  assert.equal(monitoringAlerts({...base,workers:{workers:[]}}).items.length,6)
  const uncertain=monitoringAlerts({...base,workers:{workers:[]},credentials:null,scrape:{state:'UNKNOWN'}})
  assert.equal(uncertain.status,'UNVERIFIED');assert.ok(uncertain.items.every(i=>i.level==='UNKNOWN'))
  const w={workers:[...workers.workers.slice(1),{worker:WORKERS[0],status:'DEGRADED',ready:false}]}
  assert.equal(monitoringAlerts({...base,workers:w}).items[0].code,'WORKER_NOT_READY')
  assert.equal(monitoringAlerts({...base,scrape:{state:'ERROR'}}).items[0].code,'SCRAPE_FAILED')
})
test('expiry warning uses configurable window and distinguishes expired',()=>{
  const snapshot=monitoringAlerts({workers,scrape:{state:'OK'},policy,now,credentials:[
    {id:'soon',expires_at:new Date(now+60000).toISOString()},
    {id:'old',expires_at:new Date(now-1).toISOString()},...credentials]})
  assert.deepEqual(snapshot.items.map(i=>i.code),['CREDENTIAL_EXPIRING','CREDENTIAL_EXPIRED'])
  assert.throws(()=>alertPolicy({MONITORING_SCRAPE_STALE_SECONDS:'NaN'}))
})
test('Prometheus probe bounds freshness and sanitizes failure details',async()=>{
  const env={DASHBOARD_PROMETHEUS_MONITORING_ENABLED:'true'}
  const probe=rows=>scrapeObservation({env,now,fetcher:async(url,options)=>{
    assert.equal(url,'http://prometheus:9090/api/v1/targets?state=active');assert.equal(options.redirect,'error')
    return new Response(JSON.stringify({status:'success',data:{activeTargets:rows}}))}})
  const row={labels:{job:'funnelmetry-monitoring'},health:'up',lastScrape:new Date(now-1000).toISOString(),lastError:'secret'}
  assert.equal((await probe([row])).state,'OK')
  assert.equal((await probe([{...row,health:'down'}])).state,'ERROR')
  for(const rows of [[],[row,row],[{...row,lastScrape:new Date(now-121000).toISOString()}]])assert.equal((await probe(rows)).state,'UNKNOWN')
  assert.doesNotMatch(JSON.stringify(await probe([{...row,health:'down'}])),/secret/)
  assert.equal((await scrapeObservation({env:{},fetcher:()=>{throw Error('must not call')}})).reason,'NOT_CONFIGURED')
})
