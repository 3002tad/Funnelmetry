// Cross-platform, single-env launcher for the isolated DEC-126 Swarm candidate.
// Does not touch Compose state or create any secret unless explicitly requested.
import { readFile, mkdir, writeFile, access } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { parseEnv } from 'node:util';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validateSwarmApp, validateSwarmCandidate } from './swarm-preflight.mjs';
import { schemaFiles, schemaDigest } from '../infra/bootstrap/bootstrap-swarm.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const stackFile = join(root, 'infra', 'swarm-stack.yml');
const appFile = join(root, 'infra', 'swarm-app.yml');
const workersFile = join(root, 'infra', 'swarm-workers.yml');
const liveFile = join(root, 'infra', 'swarm-live.yml');
const monitoringFile = join(root, 'infra', 'swarm-monitoring.yml');
const edgeFiles = Object.freeze({
  local: join(root, 'infra', 'swarm-edge-local.yml'),
  acme: join(root, 'infra', 'swarm-edge-acme.yml'),
});
const renderKeys = ['SWARM_STACK_NAME', 'SWARM_POSTGRES_IMAGE', 'SWARM_KAFKA_IMAGE',
  'SWARM_API_IMAGE', 'SWARM_WEB_IMAGE', 'SWARM_WORKERS_IMAGE', 'SWARM_TRAEFIK_IMAGE',
  'SWARM_PUBLIC_DOMAIN', 'SWARM_ADMIN_EMAIL', 'SWARM_ACME_EMAIL',
  'HANDOFF_RAW_PARTITIONS', 'SWARM_NORMALIZER_ID_MODE', 'SWARM_EXPECTED_SCHEMA_DIGEST', 'SWARM_MIGRATION_MODE',
  'SWARM_LIVE_ACK', 'SWARM_CONNECTOR_ID', 'SWARM_FEED_URL', 'SWARM_FEED_ID',
  'SWARM_INITIAL_AFTER_SEQ', 'SWARM_CATALOG_URL', 'SWARM_DASHSCOPE_BASE_URL',
  'MONITORING_PROMETHEUS_IMAGE', 'MONITORING_GRAFANA_IMAGE'];

export async function localSchemaDigest() {
  const files = await schemaFiles(root);
  const sql = await Promise.all(files.map(file => readFile(file, 'utf8')));
  return schemaDigest(files, sql, root);
}

export function dockerEnvironment(systemEnv, deployEnv) {
  const result = Object.fromEntries(Object.entries(systemEnv).filter(([key]) =>
    !/(?:PASSWORD|TOKEN|SECRET|API_KEY|AUTH|COOKIE|PRIVATE|CREDENTIAL)/i.test(key)));
  for (const key of renderKeys) if (deployEnv[key]) result[key] = deployEnv[key];
  return result;
}

export function stackDeployArgs(stackFiles, stackName) {
  return ['stack', 'deploy', '--with-registry-auth',
    ...stackFiles.flatMap(file => ['--compose-file', file]), stackName];
}

export function stackFilesForCommand(command, appPlan, mode = 'OFFLINE_DEMO', monitoring = false) {
  const appFiles = [stackFile, workersFile, appFile, ...(mode === 'PARALLEL_LIVE' ? [liveFile] : []),
    ...(monitoring ? [monitoringFile] : [])];
  if (command === 'check-internal' || command === 'deploy-internal') {
    return appFiles;
  }
  if (appPlan) return [...appFiles, edgeFiles[appPlan.tlsMode]];
  return [stackFile];
}

export function validateDbSecret(env) {
  const value = env.SWARM_DB_PASSWORD || '';
  if (value.length < 24 || /[\r\n]/.test(value)) throw Error('Set a new SWARM_DB_PASSWORD of at least 24 single-line characters');
  if (value === env.HANDOFF_DB_PASSWORD) throw Error('Swarm DB password must be independent of the Compose DB password');
  return value;
}

export function validateAppSecrets(env) {
  const jwt = env.SWARM_JWT_SECRET || '';
  const admin = env.SWARM_ADMIN_PASSWORD || '';
  if (jwt.length < 32 || /[\r\n]/.test(jwt)) throw Error('Set a new single-line SWARM_JWT_SECRET of at least 32 characters');
  if (admin.length < 16 || /[\r\n]/.test(admin)) throw Error('Set a new single-line SWARM_ADMIN_PASSWORD of at least 16 characters');
  if (jwt === env.HANDOFF_JWT_SECRET || admin === env.HANDOFF_ADMIN_PASSWORD) {
    throw Error('Swarm application secrets must be independent of Compose secrets');
  }
  return { jwt, admin };
}

export function validateTlsFilePath(file) {
  if (!file || !isAbsolute(file)) throw Error('TLS certificate/key files must use absolute paths outside the repository');
  const rel = relative(root, resolve(file));
  if (!rel.startsWith('..') && !isAbsolute(rel)) throw Error('TLS certificate/key files must stay outside the repository');
  return file;
}

async function saveGeneratedCredential(stackName, kind, value) {
  const dir = join(root, 'runtime', 'credentials');
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const file = join(dir, `${stackName}-${kind}`);
  await writeFile(file, value, { flag: 'wx', mode: 0o600 });
}

async function docker(args, env, input) {
  return await new Promise((resolve, reject) => {
    const child = spawn('docker', args, { cwd: root, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let output = '';
    let error = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { error += chunk; });
    child.once('error', reject);
    child.once('close', code => code === 0 ? resolve(output.trim()) : reject(Error(`Docker ${args.slice(0, 2).join(' ')} failed: ${error.trim().slice(0, 500)}`)));
    child.stdin.end(input);
  });
}

async function managerReady(env) {
  const state = await docker(['info', '--format', '{{.Swarm.LocalNodeState}}|{{.Swarm.ControlAvailable}}'], env);
  if (state !== 'active|true') throw Error('This host must be an active Swarm manager');
  const label = await docker(['node', 'inspect', 'self', '--format', '{{index .Spec.Labels "funnelmetry.stateful"}}'], env);
  if (label !== 'true') throw Error('Label this dedicated stateful node funnelmetry.stateful=true after reviewing local persistent storage');
}

async function secretExists(name, env) {
  try { await docker(['secret', 'inspect', name], env); return true; }
  catch (error) {
    if (/No such secret|not found/i.test(error.message)) return false;
    throw error;
  }
}

async function serviceExists(name, env) {
  try { await docker(['service', 'inspect', name], env); return true; }
  catch (error) {
    if (/No such service|not found/i.test(error.message)) return false;
    throw error;
  }
}

export async function run(command) {
  const parsed = parseEnv(await readFile(join(root, 'runtime', 'deploy.env'), 'utf8'));
  const plan = validateSwarmCandidate(parsed);
  parsed.SWARM_EXPECTED_SCHEMA_DIGEST = await localSchemaDigest();
  const env = dockerEnvironment(process.env, parsed);
  const internalOnly = ['check-internal', 'deploy-internal'].includes(command);
  const withApp = internalOnly || ['check-app', 'create-app-secrets', 'create-tls-secrets', 'create-live-secrets', 'create-monitoring-secrets', 'deploy-app'].includes(command);
  const appPlan = withApp ? validateSwarmApp(parsed) : null;
  const monitoring = parsed.SWARM_MONITORING_ENABLED === 'true';
  const stackFiles = stackFilesForCommand(command, appPlan, plan.mode, monitoring);
  const files = stackFiles.flatMap(file => ['-c', file]);
  if (command === 'check' || command === 'check-app' || command === 'check-internal') {
    await docker(['stack', 'config', ...files], env);
    console.log(`PASS: ${plan.stackName} ${internalOnly ? 'internal-only app' : withApp ? 'HTTPS app' : 'phase-1 data'} stack renders; runtime, DNS and image pulls unverified`);
    return;
  }
  if (!['create-db-secret', 'create-app-secrets', 'create-tls-secrets', 'create-live-secrets', 'create-monitoring-secrets', 'deploy', 'deploy-internal', 'deploy-app'].includes(command)) {
    throw Error('Usage: node runtime/swarm.mjs check|check-internal|check-app|create-db-secret|create-app-secrets|create-tls-secrets|create-live-secrets|create-monitoring-secrets|deploy|deploy-internal|deploy-app');
  }
  await managerReady(env);
  const secretName = `${plan.stackName}_db_password_v1`;
  if (command === 'create-db-secret') {
    const generated = !parsed.SWARM_DB_PASSWORD;
    const password = validateDbSecret({ ...parsed,
      SWARM_DB_PASSWORD: parsed.SWARM_DB_PASSWORD || randomBytes(36).toString('base64url') });
    if (await secretExists(secretName, env)) throw Error('Swarm DB secret already exists; no overwrite performed');
    if (generated) await saveGeneratedCredential(plan.stackName, 'db-password', password);
    await docker(['secret', 'create', secretName, '-'], env, password);
    console.log(`Created isolated Swarm DB secret ${secretName}; back up ignored local credential securely`);
    return;
  }
  if (command === 'create-app-secrets') {
    const generatedAdmin = !parsed.SWARM_ADMIN_PASSWORD;
    const values = validateAppSecrets({ ...parsed,
      SWARM_JWT_SECRET: parsed.SWARM_JWT_SECRET || randomBytes(48).toString('base64url'),
      SWARM_ADMIN_PASSWORD: parsed.SWARM_ADMIN_PASSWORD || randomBytes(24).toString('base64url') });
    const specs = [['jwt_secret', values.jwt], ['admin_password', values.admin]];
    if (generatedAdmin) {
      const credentialFile = join(root, 'runtime', 'credentials', `${plan.stackName}-admin-password`);
      try { await access(credentialFile); throw Error('Local admin credential already exists; no overwrite performed'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    for (const [name] of specs) {
      if (await secretExists(`${plan.stackName}_${name}_v1`, env)) throw Error('Swarm application secret already exists; no overwrite performed');
    }
    if (!parsed.SWARM_JWT_SECRET) await saveGeneratedCredential(plan.stackName, 'jwt-secret', values.jwt);
    if (generatedAdmin) await saveGeneratedCredential(plan.stackName, 'admin-password', values.admin);
    for (const [name, value] of specs) await docker(['secret', 'create', `${plan.stackName}_${name}_v1`, '-'], env, value);
    console.log(`Created isolated Swarm application secrets${generatedAdmin ? '; local admin credential saved in ignored runtime/credentials' : ''}`);
    return;
  }
  if (command === 'create-live-secrets') {
    if (plan.mode !== 'PARALLEL_LIVE') throw Error('Live secrets require PARALLEL_LIVE mode');
    const specs = [
      ['source_feed_token', parsed.HANDOFF_FEED_TOKEN],
      ['catalog_key', parsed.HANDOFF_CATALOG_KEY],
      ['dashscope_api_key', parsed.HANDOFF_DASHSCOPE_API_KEY],
    ];
    if (specs.some(([, value]) => !value || /[\r\n]/.test(value))) throw Error('Live credential values are missing or invalid');
    for (const [name] of specs) {
      if (await secretExists(`${plan.stackName}_${name}_v1`, env)) throw Error('Live secret already exists; no overwrite performed');
    }
    for (const [name, value] of specs) await docker(['secret', 'create', `${plan.stackName}_${name}_v1`, '-'], env, value);
    console.log('Created isolated Swarm live-service secret references');
    return;
  }
  if (command === 'create-monitoring-secrets') {
    if (plan.mode !== 'PARALLEL_LIVE') throw Error('Monitoring provisioning currently requires the fresh live stack');
    const monitorDir = join(root, 'runtime', 'monitoring', 'swarm');
    const tokenFile = join(monitorDir, 'metrics-token');
    try { await access(tokenFile); throw Error('Monitoring credential already provisioned; no overwrite performed'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    for (const name of ['metrics_token', 'grafana_admin_password']) {
      if (await secretExists(`${plan.stackName}_${name}_v1`, env)) throw Error('Monitoring secret already exists; no overwrite performed');
    }
    const ids = (await docker(['ps', '--filter', `label=com.docker.swarm.service.name=${plan.stackName}_dashboard-api`,
      '--format', '{{.ID}}'], env)).split(/\s+/).filter(Boolean);
    if (ids.length !== 1) throw Error('Exactly one healthy Swarm API task is required to issue monitoring credential');
    const issueScript = `const fs=require('node:fs'); (async()=>{
      const base='http://127.0.0.1:32000';
      const pass=fs.readFileSync('/run/secrets/admin_password','utf8').trim();
      const login=await fetch(base+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},
        body:JSON.stringify({email:process.env.DASHBOARD_ADMIN_EMAIL,password:pass})});
      if(login.status!==200)throw Error('login_failed');
      const auth=(await login.json()).token;
      const issued=await fetch(base+'/api/v2/admin/monitoring-credentials',{method:'POST',
        headers:{Authorization:'Bearer '+auth,'content-type':'application/json'},
        body:JSON.stringify({label:'swarm-live-prometheus',ttl_seconds:604800})});
      if(issued.status!==201)throw Error('issue_failed');
      const credential=await issued.json();
      const check=await fetch(base+'/api/monitoring/metrics',
        {headers:{Authorization:'Bearer '+credential.token}});
      if(check.status!==200)throw Error('metrics_validation_failed');
      console.log(JSON.stringify({id:credential.id,expires_at:credential.expires_at,token:credential.token}));
    })().catch(()=>{console.error('Monitoring credential setup failed');process.exit(1)})`;
    const issued = JSON.parse(await docker(['exec', '-i', ids[0], 'node', '-'], env, issueScript));
    if (!/^fmmon_[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/.test(issued.token || '')) throw Error('Issued monitoring token format invalid');
    const grafanaPassword = randomBytes(32).toString('base64url');
    const dashboard = JSON.parse(await readFile(join(root, 'infra', 'observability', 'pipeline-dashboard.json'), 'utf8'));
    delete dashboard.__inputs;
    for (const panel of dashboard.panels) if (panel.datasource) panel.datasource.uid = 'funnelmetry-prometheus';
    await mkdir(monitorDir, { recursive: true, mode: 0o700 });
    await writeFile(join(monitorDir, 'credential.json'), JSON.stringify({ id: issued.id, expires_at: issued.expires_at }), { flag: 'wx', mode: 0o600 });
    await writeFile(tokenFile, issued.token, { flag: 'wx', mode: 0o600 });
    await writeFile(join(monitorDir, 'grafana-password'), grafanaPassword, { flag: 'wx', mode: 0o600 });
    await writeFile(join(monitorDir, 'pipeline.json'), JSON.stringify(dashboard), { flag: 'wx', mode: 0o600 });
    await docker(['secret', 'create', `${plan.stackName}_metrics_token_v1`, '-'], env, issued.token);
    await docker(['secret', 'create', `${plan.stackName}_grafana_admin_password_v1`, '-'], env, grafanaPassword);
    console.log(`Created isolated monitoring secrets and dashboard config; credential expires ${issued.expires_at}`);
    return;
  }
  if (command === 'create-tls-secrets') {
    if (appPlan.tlsMode !== 'local') throw Error('create-tls-secrets is only for local trusted TLS');
    const specs = [['tls_cert', 'SWARM_LOCAL_TLS_CERT_FILE'], ['tls_key', 'SWARM_LOCAL_TLS_KEY_FILE']];
    for (const [name] of specs) {
      if (await secretExists(`${plan.stackName}_${name}_v1`, env)) throw Error('Swarm TLS secret already exists; no overwrite performed');
    }
    const values = [];
    for (const [name, key] of specs) {
      let value;
      try { value = await readFile(validateTlsFilePath(parsed[key])); }
      catch { throw Error(`${key} is unavailable or is inside the repository`); }
      const pem = value.toString('utf8');
      if (!(name === 'tls_cert' ? pem.includes('BEGIN CERTIFICATE')
        : /BEGIN (?:RSA |EC )?PRIVATE KEY/.test(pem))) {
        throw Error(`${key} is not a PEM certificate/key`);
      }
      values.push([name, value]);
    }
    for (const [name, value] of values) await docker(['secret', 'create', `${plan.stackName}_${name}_v1`, '-'], env, value);
    console.log('Created isolated local TLS certificate/key Swarm secrets');
    return;
  }
  if (!await secretExists(secretName, env)) throw Error('Swarm DB secret is missing');
  if (command === 'deploy' && (await serviceExists(`${plan.stackName}_dashboard-api`, env)
    || await serviceExists(`${plan.stackName}_edge`, env))) {
    throw Error('Application services already exist; use deploy-internal or deploy-app so a data-only deploy cannot remove them');
  }
  if (internalOnly && await serviceExists(`${plan.stackName}_edge`, env)) {
    throw Error('HTTPS edge already exists; use deploy-app so internal-only deploy cannot remove it');
  }
  if (withApp) {
    for (const name of ['jwt_secret', 'admin_password']) {
      if (!await secretExists(`${plan.stackName}_${name}_v1`, env)) throw Error(`Swarm ${name} secret is missing`);
    }
    if (plan.mode === 'PARALLEL_LIVE') {
      for (const name of ['source_feed_token', 'catalog_key', 'dashscope_api_key']) {
        if (!await secretExists(`${plan.stackName}_${name}_v1`, env)) throw Error(`Swarm ${name} secret is missing`);
      }
    }
    if (monitoring) {
      for (const name of ['metrics_token', 'grafana_admin_password']) {
        if (!await secretExists(`${plan.stackName}_${name}_v1`, env)) throw Error(`Swarm ${name} secret is missing`);
      }
    }
    if (!internalOnly) {
      if (appPlan.tlsMode === 'local') {
        for (const name of ['tls_cert', 'tls_key']) {
          if (!await secretExists(`${plan.stackName}_${name}_v1`, env)) throw Error(`Swarm ${name} secret is missing`);
        }
      } else if (parsed.SWARM_ACME_READY_ACK !== 'DNS_AND_PORTS_CONFIRMED') {
        throw Error('ACME deployment requires reviewed public DNS and TCP 80/443 reachability');
      }
    }
  }
  await docker(['stack', 'config', ...files], env);
  await docker(stackDeployArgs(stackFiles, plan.stackName), env);
  console.log(`Submitted ${plan.stackName} ${internalOnly ? 'internal-only app' : withApp ? 'HTTPS app' : 'phase-1 data'} stack; verify tasks and readiness before live feed.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { await run(process.argv[2]); }
  catch (error) { console.error(`Swarm candidate stopped: ${error.message}`); process.exitCode = 1; }
}
