import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { open, readFile, rename, mkdir, rmdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { evaluate, initialState, validatePolicy } from './policy.mjs';

const exec = promisify(execFile);
export function validateConfig(config) {
  validatePolicy(config);
  for (const [key, max] of Object.entries({ port: 65535, probeTimeoutMs: 30000,
    commandTimeoutMs: 120000, restartTimeoutSec: 60 })) {
    if (!Number.isSafeInteger(config[key]) || config[key] < 1 || config[key] > max) throw Error(`Invalid ${key}`);
  }
  if (config.commandTimeoutMs < config.probeTimeoutMs * 2 + 3000 ||
      config.commandTimeoutMs < config.restartTimeoutSec * 1000 + 3000) throw Error('Command timeout too short');
}
const fingerprint = config => createHash('sha256').update(JSON.stringify(config)).digest('hex');

// Never return full inspect output: Docker env may contain credentials.
const INSPECT = '{"id":{{json .Id}},"project":{{json (index .Config.Labels "com.docker.compose.project")}},"service":{{json (index .Config.Labels "com.docker.compose.service")}},"oneoff":{{json (index .Config.Labels "com.docker.compose.oneoff")}},"running":{{.State.Running}},"paused":{{.State.Paused}},"restarting":{{.State.Restarting}},"startedAt":{{json .State.StartedAt}}}';
const LOCAL_PROBE = `
const http=require('node:http');
const [port,timeout,worker]=process.argv.slice(1);
function probe(path){return new Promise(resolve=>{
 let done=false;const finish=x=>{if(!done){done=true;clearTimeout(timer);resolve(x)}};
 const req=http.get({host:'127.0.0.1',port:Number(port),path},res=>{
  let body='';res.on('data',chunk=>{body+=chunk;if(body.length>4096){finish({kind:'unknown'});req.destroy()}});
  res.on('end',()=>{try{const data=JSON.parse(body);
   if(data.worker!==worker||data.scope!=='local_kafka_runtime_flag'){finish({kind:'unknown'});return}
   finish({kind:res.statusCode===200?'alive':'unknown',ready:data.ready===true,status:data.status});
  }catch{finish({kind:'unknown'})}});res.on('error',()=>finish({kind:'unknown'}));
 });
 const timer=setTimeout(()=>{finish({kind:'failed'});req.destroy()},Number(timeout));
 req.on('error',err=>finish({kind:err.code==='ECONNREFUSED'?'failed':'unknown'}));
})}
(async()=>{const live=await probe('/healthz');const ready=live.kind==='alive'?await probe('/readyz'):{};
 console.log(JSON.stringify({liveness:['STARTING','STOPPING'].includes(live.status)?'unknown':live.kind,readiness:ready.ready===true}));
})().catch(()=>process.exitCode=1);
`;

export function dockerAdapter(config, docker = 'docker') {
  const run = async args => {
    try { return (await exec(docker, args, { timeout: config.commandTimeoutMs, maxBuffer: 16384, windowsHide: true })).stdout.trim(); }
    catch { throw Error('DOCKER_COMMAND_FAILED'); } // no raw stderr/command/env in audit
  };
  const inspect = async id => {
    if (!/^[a-f0-9]{64}$/.test(id)) throw Error('Invalid container ID');
    const value = JSON.parse(await run(['inspect', '--format', INSPECT, id]));
    return { ...value, oneoff: value.oneoff === 'False' ? false : true,
      startedAt: Date.parse(value.startedAt), running: value.running && !value.paused && !value.restarting };
  };
  return {
    async discover(service) {
      const ids = (await run(['ps', '-aq', '--no-trunc', '--filter', `label=com.docker.compose.project=${config.project}`,
        '--filter', `label=com.docker.compose.service=${service}`])).split(/\s+/).filter(Boolean);
      if (ids.length !== 1) return null; // singleton only, ambiguity must not restart a replica
      return inspect(ids[0]);
    },
    inspect,
    async probe(target) {
      try {
        const value = JSON.parse(await run(['exec', target.id, 'node', '-e', LOCAL_PROBE,
          String(config.port), String(config.probeTimeoutMs), target.service]));
        return { liveness: ['alive', 'failed'].includes(value.liveness) ? value.liveness : 'unknown', readiness: value.readiness === true };
      } catch { return { liveness: 'unknown', readiness: false }; }
    },
    async restart(id) { await run(['restart', '--time', String(config.restartTimeoutSec), id]); },
  };
}

async function save(path, data) {
  const temp = `${path}.${randomUUID()}.tmp`;
  const file = await open(temp, 'wx', 0o600);
  try { await file.writeFile(JSON.stringify(data)); await file.sync(); } finally { await file.close(); }
  await rename(temp, path);
  // On POSIX also flush directory metadata; Windows does not support directory fsync here.
  if (process.platform !== 'win32') {
    const dir = await open(dirname(path), 'r');
    try { await dir.sync(); } finally { await dir.close(); }
  }
}
async function lock(path, fn) {
  const lockPath = `${path}.lock`;
  await mkdir(lockPath); // EEXIST => fail closed, never steal stale locks
  try { return await fn(); } finally { await rmdir(lockPath); }
}

export async function initialize(config, path) {
  validateConfig(config);
  await mkdir(dirname(path), { recursive: true });
  return lock(path, async () => {
    const file = await open(path, 'wx', 0o600); // existing state must NEVER be overwritten
    try {
      await file.writeFile(JSON.stringify({ version: 1, fingerprint: fingerprint(config), pending: null,
        states: Object.fromEntries(config.services.map(service => [service, initialState(config.project, service)])), audit: [] }));
      await file.sync();
    } finally { await file.close(); }
  });
}

const eligible = (target, config, service) => target && /^[a-f0-9]{64}$/.test(target.id) &&
  target.project === config.project && target.service === service && target.oneoff === false && target.running === true;

export async function metrics(config, path, now = Date.now()) {
  validateConfig(config);
  const data = JSON.parse(await readFile(path, 'utf8'));
  if (data.version !== 1 || data.fingerprint !== fingerprint(config) || !data.states) throw Error('STATE_CONFIG_MISMATCH');
  const lines = ['# Local snapshot; not a controller heartbeat or proof of data recovery.',
    '# TYPE funnelmetry_watchdog_pending_action gauge',
    `funnelmetry_watchdog_pending_action{project="${config.project}"} ${data.pending === null ? 0 : 1}`,
    '# TYPE funnelmetry_watchdog_circuit_open gauge',
    '# TYPE funnelmetry_watchdog_reserved_attempts_window gauge',
    '# TYPE funnelmetry_watchdog_last_observation_seconds gauge'];
  for (const service of config.services) {
    const state = data.states[service];
    evaluate(config, state, { service }, now);
    const labels = `{project="${config.project}",service="${service}"}`;
    lines.push(`funnelmetry_watchdog_circuit_open${labels} ${state.circuitOpen ? 1 : 0}`,
      `funnelmetry_watchdog_reserved_attempts_window${labels} ${state.attempts.filter(at => now - at < config.windowMs).length}`,
      `funnelmetry_watchdog_last_observation_seconds${labels} ${state.lastObservedAt === null ? 'NaN' : state.lastObservedAt / 1000}`);
  }
  return lines.join('\n') + '\n';
}

export async function tick(config, path, adapter, { apply = false, clock = Date.now } = {}) {
  validateConfig(config);
  return lock(path, async () => {
    const data = JSON.parse(await readFile(path, 'utf8'));
    if (data.version !== 1 || data.fingerprint !== fingerprint(config) || !Array.isArray(data.audit) || !data.states) {
      throw Error('STATE_CONFIG_MISMATCH');
    }
    if (data.pending !== null) throw Error('UNCERTAIN_ACTION_OPERATOR_REVIEW');
    const events = [];
    const record = async event => {
      events.push(event);
      data.audit = [...data.audit, event].slice(-200); // bounded local history, not long-term incident archive
      await save(path, data);
    };
    for (const service of config.services) {
      const target = await adapter.discover(service);
      const health = eligible(target, config, service) ? await adapter.probe(target) : {};
      const now = clock();
      const observation = { ...target, ...health, project: target?.project, service, observedAt: now };
      const previous = data.states[service];
      const decision = evaluate(config, previous, observation, now);
      if (decision.action === 'RESTART' && !apply) {
        decision.state.attempts = previous.attempts;
        decision.state.failures = config.failureThreshold;
        decision.state.status = 'UNHEALTHY';
        decision.audit = { ...decision.audit, action: 'WOULD_RESTART', status: 'UNHEALTHY' };
      }
      data.states[service] = decision.state;
      if (decision.action !== 'RESTART' || !apply) { await record(decision.audit); continue; }
      data.pending = { service, containerId: target.id, at: now };
      await record(decision.audit); // persist reservation AND intent before crossing actuator boundary
      try {
        const current = await adapter.inspect(target.id);
        if (!eligible(current, config, service) || current.id !== target.id || current.startedAt !== target.startedAt) {
          data.pending = null;
          await record({ ...decision.audit, action: 'SKIPPED', reason: 'TARGET_CHANGED' });
          continue;
        }
        await adapter.restart(target.id);
        // Do not label success HEALTHY: only a later probe establishes recovery.
        data.pending = null;
        await record({ ...decision.audit, at: clock(), action: 'RESTART_ACCEPTED', reason: 'AWAITING_HEALTH_VERIFICATION' });
      } catch {
        // CLI timeout may mean Docker did restart: leave uncertainty latched across controller reload.
        data.pending = { service, containerId: target.id, at: now };
        await record({ ...decision.audit, action: 'UNCERTAIN', reason: 'ACTUATOR_OR_STATE_WRITE_FAILED' });
        throw Error('UNCERTAIN_ACTION_OPERATOR_REVIEW');
      }
    }
    return events;
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [command, configPath, statePath, ...flags] = process.argv.slice(2);
  try {
    if (!['init', 'once', 'metrics'].includes(command) || !configPath || !statePath ||
        flags.some(flag => flag !== '--apply') || flags.length > 1 || (command !== 'once' && flags.length)) {
      throw Error('Usage: controller.mjs init|once|metrics config.json state.json [--apply]');
    }
    const config = JSON.parse(await readFile(configPath, 'utf8'));
    if (command === 'init') { await initialize(config, resolve(statePath)); console.log('Watchdog state initialized'); }
    else if (command === 'metrics') process.stdout.write(await metrics(config, resolve(statePath)));
    else console.log(JSON.stringify(await tick(config, resolve(statePath), dockerAdapter(config, process.env.WATCHDOG_DOCKER_EXE || 'docker'), { apply: flags.includes('--apply') })));
  } catch { console.error('Watchdog stopped safely: check config/state/lock and Docker locally; no automatic reset.'); process.exitCode = 1; }
}
