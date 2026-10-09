import { readFile } from 'node:fs/promises'
import { parseEnv } from 'node:util'
import assert from 'node:assert/strict'
const env=parseEnv(await readFile(new URL('monitoring.env',import.meta.url),'utf8'))
const port=Number(env.MONITORING_GRAFANA_PORT||5182)
if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Invalid Grafana port')
const password=await readFile(new URL('monitoring/grafana-password',import.meta.url),'utf8')
const headers={Authorization:'Basic '+Buffer.from('monitoring-admin:'+password).toString('base64')}
async function get(path) {
  const response=await fetch(`http://127.0.0.1:${port}`+path,{headers,redirect:'error',signal:AbortSignal.timeout(15000)})
  assert.equal(response.status,200);return response.json()
}
try {
  const health=await get('/api/health');assert.equal(health.database,'ok')
  const dashboard=await get('/api/dashboards/uid/funnelmetry-pipeline-monitoring')
  assert.equal(dashboard.dashboard.panels.length,8)
  const query=async expr=>(await get('/api/datasources/proxy/uid/funnelmetry-prometheus/api/v1/query?query='+encodeURIComponent(expr))).data.result
  const up=await query('up{job="funnelmetry-monitoring"}')
  assert.equal(up.length,1);assert.equal(up[0].value[1],'1')
  const workers=await query('funnelmetry_worker_runtime_ready{job="funnelmetry-monitoring"}')
  assert.equal(workers.length,6)
  console.log(`PASS: Grafana dashboard provisioned (${dashboard.dashboard.panels.length} panels), Prometheus UP=1, ${workers.length} worker observations.`)
} catch {console.error('Monitoring check failed; inspect scrape status/credential expiry. No secrets printed.');process.exitCode=1}
