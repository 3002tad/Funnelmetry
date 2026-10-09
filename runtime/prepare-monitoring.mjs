// Explicit local-demo provisioning. Never prints credentials or persists Admin JWT.
import { readFile, writeFile, mkdir, access } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { parseEnv } from 'node:util'

const root = new URL('../', import.meta.url)
const dir = new URL('runtime/monitoring/', root)
const env = parseEnv(await readFile(new URL('runtime/demo-new.env', root), 'utf8'))
const port = Number(env.HANDOFF_UI_PORT)
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw Error('Invalid demo port')
const base = `http://127.0.0.1:${port}`
const tokenFile = new URL('metrics-token', dir)
try { await access(tokenFile); throw Error('Already provisioned: rotate explicitly; no overwrite performed') }
catch (error) { if (error.code !== 'ENOENT') throw error }
let adminToken, issued
const call = async (path, options = {}) => {
  const response = await fetch(base + path, { ...options, redirect:'error', signal:AbortSignal.timeout(15000),
    headers: { 'Content-Type':'application/json', ...(adminToken ? {Authorization:`Bearer ${adminToken}`} : {}), ...options.headers } })
  if (!response.ok) throw Error(`Monitoring setup HTTP ${response.status}`)
  return response.status === 204 ? null : response.json()
}
try {
  const login = await call('/api/auth/login', {method:'POST',body:JSON.stringify({email:env.HANDOFF_ADMIN_EMAIL,password:env.HANDOFF_ADMIN_PASSWORD})})
  adminToken = login.token
  issued = await call('/api/v2/admin/monitoring-credentials', {method:'POST',body:JSON.stringify({label:'local-demo-prometheus',ttl_seconds:604800})})
  const check = await fetch(base+'/api/monitoring/metrics', {headers:{Authorization:`Bearer ${issued.token}`},redirect:'error',signal:AbortSignal.timeout(15000)})
  if (!check.ok) throw Error('Machine credential validation failed')
  await mkdir(new URL('dashboards/',dir), {recursive:true,mode:0o700})
  const dashboard = JSON.parse(await readFile(new URL('infra/observability/pipeline-dashboard.json',root),'utf8'))
  delete dashboard.__inputs
  for (const panel of dashboard.panels) if (panel.datasource) panel.datasource.uid='funnelmetry-prometheus'
  await writeFile(new URL('dashboards/pipeline.json',dir),JSON.stringify(dashboard,null,2),{flag:'wx',mode:0o600})
  await writeFile(new URL('grafana-password',dir),randomBytes(32).toString('base64url'),{flag:'wx',mode:0o600})
  await writeFile(new URL('credential.json',dir),JSON.stringify({id:issued.id,expires_at:issued.expires_at},null,2),{flag:'wx',mode:0o600})
  await writeFile(tokenFile,issued.token,{flag:'wx',mode:0o600})
  console.log(`Monitoring provisioned. Credential expires ${issued.expires_at}. Secrets in ignored runtime/monitoring; not printed.`)
} catch (error) {
  if (issued) {
    try { await call(`/api/v2/admin/monitoring-credentials/${issued.id}`,{method:'DELETE'}) }
    catch { console.error('Credential cleanup failed: revoke issued ID through Admin API before retry.') }
  }
  console.error('Monitoring setup failed; no automatic retry/overwrite. Inspect local artifacts before retrying.')
  process.exitCode=1
}
