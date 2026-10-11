// Called only within run-handoff.ps1's isolated project lifecycle.
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { initialize, tick, dockerAdapter } from './controller.mjs';

const [project, docker] = process.argv.slice(2);
assert.match(project || '', /^funnelmetry-handoff-test-[a-f0-9]{12}$/);
assert.ok(docker);
const config = { project, services: ['canonical-normalizer'], failureThreshold: 2,
  cooldownMs: 10000, maxAttempts: 1, windowMs: 600000, startupGraceMs: 0,
  maxSampleAgeMs: 10000, port: 31009, probeTimeoutMs: 1500,
  commandTimeoutMs: 15000, restartTimeoutSec: 3 };
const adapter = dockerAdapter(config, docker);
const exec = promisify(execFile);
const run = async args => (await exec(docker, args, { timeout: 20000, windowsHide: true, maxBuffer: 8192 })).stdout.trim();
const dir = await mkdtemp(join(tmpdir(), 'watchdog-pipeline-'));
const state = join(dir, 'state.json');
let target, faultPid, frozen = false;
const fixture = await readFile(new URL('../v2-e2e/test/handoff-pipeline.mjs', import.meta.url), 'utf8');
async function check(mode) {
  const child = spawn(docker, ['exec', '-i', '-e', `HANDOFF_PIPELINE_TEST=${mode}`, target.id,
    'node', '--input-type=module'], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  child.stdout.pipe(process.stdout);
  // Fixture logs only sanitized stage failures; never expose arbitrary Docker stderr.
  child.stderr.resume();
  child.stdin.on('error', () => {});
  child.stdin.end(fixture);
  const timeout = setTimeout(() => child.kill(), 170000);
  try {
    await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', code => code === 0 ? resolve() : reject(Error(`Pipeline fixture failed: ${mode}`)));
    });
  } finally { clearTimeout(timeout); }
}
try {
  target = await adapter.discover('canonical-normalizer');
  assert.ok(target?.running && target.project === project && target.oneoff === false);
  await initialize(config, state);
  assert.equal((await tick(config, state, adapter))[0].status, 'HEALTHY');
  // Same UID, no extra Linux capability or Docker pause. Exec probe stays runnable.
  faultPid = await run(['exec', target.id, 'node', '-e', "const fs=require('node:fs');const pids=fs.readdirSync('/proc').filter(p=>/^\\d+$/.test(p)).filter(p=>{try{const a=fs.readFileSync('/proc/'+p+'/cmdline','utf8').split('\\0');return a[1]==='src/main.js'}catch{return false}});if(pids.length!==1||Number(pids[0])<=1)process.exit(1);process.kill(Number(pids[0]),'SIGSTOP');console.log(pids[0])"]);
  assert.match(faultPid, /^[0-9]+$/);
  frozen = true;
  assert.equal((await adapter.probe(target)).liveness, 'failed', 'SIGSTOP must actually freeze health listener');
  await check('watchdog-enqueue');
  const began = Date.now();
  assert.equal((await tick(config, state, adapter, { apply: true }))[0].action, 'NONE');
  const recovery = await tick(config, state, adapter, { apply: true });
  assert.equal(recovery.at(-1).action, 'RESTART_ACCEPTED');
  frozen = false;
  assert.notEqual((await adapter.inspect(target.id)).startedAt, target.startedAt);
  let healthy = false;
  for (let n = 0; n < 45; n++) {
    if ((await tick(config, state, adapter))[0].status === 'HEALTHY') { healthy = true; break; }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  assert.ok(healthy, 'restarted worker health deadline');
  await check('watchdog-verify');
  const saved = JSON.parse(await readFile(state, 'utf8'));
  assert.equal(saved.states['canonical-normalizer'].attempts.length, 1);
  assert.equal(saved.pending, null);
  console.log(JSON.stringify({ result: 'PASS', project, worker: 'canonical-normalizer',
    recoveryAndCatchupMs: Date.now() - began, attempts: 1,
    evidence: 'five canonical events, one order EUR20, no duplicate canonical identities, raw offsets caught up' }));
} finally {
  if (frozen && target) {
    const current = await adapter.inspect(target.id);
    if (current.project === project && current.running && current.startedAt === target.startedAt) {
      await run(['exec', target.id, 'node', '-e', "process.kill(Number(process.argv[1]),'SIGCONT')", faultPid]);
    }
  }
  await rm(dir, { recursive: true, force: true }); // this run's mkdtemp only; Compose owner cleans DB/Kafka
}
