// Explicit opt-in offline fixture. No ports, volumes, source credentials or actual workers.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { dockerAdapter, initialize, tick } from './controller.mjs';

const docker = process.env.WATCHDOG_DOCKER_EXE || 'docker';
const image = process.argv[2];
if (!image || !process.argv.includes('--run-isolated')) throw Error('Provide local Node image and --run-isolated');
const exec = promisify(execFile);
const run = async args => (await exec(docker, args, { timeout: 30000, maxBuffer: 8192, windowsHide: true })).stdout.trim();
const project = `watchdog-smoke-${randomUUID().slice(0, 8)}`;
const service = 'canonical-normalizer';
const config = { project, services: [service], failureThreshold: 2, startupGraceMs: 0,
  cooldownMs: 100, maxAttempts: 1, windowMs: 600000, maxSampleAgeMs: 10000,
  port: 31009, probeTimeoutMs: 400, commandTimeoutMs: 10000, restartTimeoutSec: 1 };
const fixture = `const fs=require('node:fs');const http=require('node:http');
try{fs.unlinkSync('/tmp/hang')}catch{}
http.createServer((req,res)=>{if(fs.existsSync('/tmp/hang'))return;
const ready=!fs.existsSync('/tmp/dependency');res.writeHead(req.url==='/healthz'||ready?200:503);
res.end(JSON.stringify({worker:'canonical-normalizer',ready,status:ready?'READY':'DEGRADED',scope:'local_kafka_runtime_flag'}));
}).listen(31009,'127.0.0.1');`;
const dir = await mkdtemp(join(tmpdir(), project));
const statePath = join(dir, 'state.json');
let id;
const adapter = dockerAdapter(config, docker);
const round = () => tick(config, statePath, adapter, { apply: true });
try {
  const imageId = await run(['image', 'inspect', image, '--format', '{{.Id}}']);
  id = await run(['run', '-d', '--name', project, '--network', 'none', '--read-only',
    '--tmpfs', '/tmp:rw,noexec,nosuid,size=1m', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
    '--label', `com.docker.compose.project=${project}`, '--label', `com.docker.compose.service=${service}`,
    '--label', 'com.docker.compose.oneoff=False', '--entrypoint', 'node', imageId, '-e', fixture]);
  await initialize(config, statePath);
  let events;
  for (let i = 0; i < 10; i++) { events = await round(); if (events[0].status === 'HEALTHY') break; }
  assert.equal(events[0].status, 'HEALTHY');
  const started = (await adapter.inspect(id)).startedAt;
  await run(['exec', id, 'node', '-e', "require('node:fs').writeFileSync('/tmp/dependency','1')"]);
  for (let i = 0; i < 3; i++) assert.equal((await round())[0].reason, 'DEPENDENCY_NOT_READY');
  assert.equal((await adapter.inspect(id)).startedAt, started);
  console.log('PASS dependency readiness failure: no restart');
  await run(['exec', id, 'node', '-e', "require('node:fs').writeFileSync('/tmp/hang','1')"]);
  await round(); events = await round();
  assert.equal(events.at(-1).action, 'RESTART_ACCEPTED');
  assert.notEqual((await adapter.inspect(id)).startedAt, started);
  // Docker recreates tmpfs on restart, so both fault markers disappear.
  for (let i = 0; i < 10; i++) { events = await round(); if (events[0].status === 'HEALTHY') break; }
  assert.equal(events[0].status, 'HEALTHY');
  console.log('PASS local liveness timeout: restart and live re-probe');
  await run(['exec', id, 'node', '-e', "require('node:fs').writeFileSync('/tmp/hang','1')"]);
  await round(); events = await round();
  assert.equal(events.at(-1).reason, 'RECOVERY_BUDGET_EXHAUSTED');
  assert.equal(JSON.parse(await readFile(statePath)).states[service].attempts.length, 1);
  console.log('PASS reload retains budget; repeated failure opens circuit');
  console.log(JSON.stringify({ project, imageId, scope: 'offline HTTP fixture only, not Kafka replay acceptance' }));
} finally {
  if (id && /^[a-f0-9]{64}$/.test(id)) {
    const target = await adapter.inspect(id);
    if (target.project !== project || target.service !== service) throw Error('Cleanup scope mismatch');
    await run(['rm', '-f', id]);
  }
  await rm(dir, { recursive: true, force: true }); // only mkdtemp path created by this run
}
