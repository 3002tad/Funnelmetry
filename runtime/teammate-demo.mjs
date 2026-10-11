import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, rmdir, readFile, writeFile, access } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { initialize, dockerAdapter } from '../tools/resilience-watchdog/controller.mjs';
import { run } from '../tools/resilience-watchdog/run.mjs';
const exec = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const folder = join(root, 'runtime/teammate-demo');
export const images = {
  HANDOFF_API_IMAGE: 'ghcr.io/3002tad/funnelmetry/handoff-api@sha256:a794500f8cf84f6a2f03c99d2da1864937522b9a5757a79be815bf920face72d',
  HANDOFF_WEB_IMAGE: 'ghcr.io/3002tad/funnelmetry/handoff-web@sha256:b5a0f6feb77e2823013a5fc3f35b3f71deb651eaedfc8f4f697294760f5671dc',
  HANDOFF_WORKERS_IMAGE: 'ghcr.io/3002tad/funnelmetry/handoff-workers@sha256:6987b769f89d1a38cfbaee539f670e86ffb50cec5c84271c38b2037b41811650',
};
export function bundle(port = 5183) {
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) throw Error('INVALID_PORT');
  const project = `funnelmetry-teammate-${randomBytes(6).toString('hex')}`;
  const manifest = { version: 1, project, port, createdAt: new Date().toISOString(),
    mode: 'OFFLINE_DEMO', authoritative: false, stateLineageId: randomUUID(),
    imageSourceCommit: '2fb6b91f73f7abe9036d527cbb78217062e96d1e', platform: 'linux/amd64', images,
    coverage: 'Empty fresh database; no source events or historical snapshot',
    disabled: ['Medusa feed', 'catalog sync', 'Qwen', 'automatic scaling', 'Prometheus/Grafana provisioning'] };
  const env = { HANDOFF_PROJECT: project, HANDOFF_UI_PORT: String(port), ...images,
    HANDOFF_DB_PASSWORD: randomBytes(32).toString('hex'), HANDOFF_JWT_SECRET: randomBytes(48).toString('hex'),
    HANDOFF_ADMIN_EMAIL: 'admin@teammate.local', HANDOFF_ADMIN_PASSWORD: randomBytes(24).toString('hex') };
  return { manifest, env: Object.entries(env).map(([k,v]) => `${k}=${v}`).join('\n') + '\n' };
}
export function validateManifest(m) {
  if (m?.version !== 1 || !/^funnelmetry-teammate-[a-f0-9]{12}$/.test(m.project || '') ||
      !Number.isSafeInteger(m.port) || m.port < 1024 || m.port > 65535 || m.mode !== 'OFFLINE_DEMO' ||
      m.authoritative !== false || JSON.stringify(m.images) !== JSON.stringify(images)) throw Error('INVALID_MANIFEST');
}
export async function createBundle(dir, port) {
  const data = bundle(port);
  await mkdir(dir); // Never overwrite or silently repair a partial installation.
  await writeFile(join(dir, 'demo.env'), data.env, { flag: 'wx', mode: 0o600 });
  await writeFile(join(dir, 'manifest.json'), JSON.stringify(data.manifest, null, 2), { flag: 'wx', mode: 0o600 });
  return data.manifest;
}
export function composeArgs(dir, m, repo = root) {
  validateManifest(m);
  return ['compose', '-p', m.project, '--env-file', join(dir, 'demo.env'),
    ...['compose.handoff.yml', 'compose.handoff-pipeline.yml', 'compose.handoff-analytics.yml',
      'compose.handoff-monitoring.yml'].flatMap(file => ['-f', join(repo, 'infra', file)])];
}
async function exists(path) {
  try { await access(path); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; }
}
export async function exclusiveOperation(dir, action, operation) {
  if (action === 'status') return operation();
  const lease = join(dir, 'operation.lock');
  try { await mkdir(lease); } catch (e) {
    if (e.code === 'EEXIST') throw Error('DEMO_OPERATION_ALREADY_ACTIVE');
    throw e;
  }
  try { return await operation(); } finally { await rmdir(lease); }
}
async function dockerExe() {
  const candidates = [process.env.WATCHDOG_DOCKER_EXE, 'docker',
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Programs/DockerDesktop/resources/bin/docker.exe'),
    process.env.ProgramFiles && join(process.env.ProgramFiles, 'Docker/Docker/resources/bin/docker.exe')].filter(Boolean);
  for (const cmd of candidates) { try { await exec(cmd, ['version', '--format', '{{.Client.Version}}'], { timeout: 5000, windowsHide: true }); return cmd; } catch {} }
  throw Error('DOCKER_CLI_UNAVAILABLE');
}
async function main() {
  const [action = 'start', portArg, ...extra] = process.argv.slice(2);
  if (!['start', 'stop', 'status', 'watchdog'].includes(action) || extra.length ||
      (portArg && action !== 'start')) throw Error('INVALID_ARGUMENTS');
  const docker = await dockerExe();
  // Shell environment must not override the generated, isolated Compose configuration.
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(HANDOFF_|COMPOSE_)/i.test(k)));
  const call = async args => {
    try { return (await exec(docker, args, { cwd: root, env, windowsHide: true, timeout: 600000, maxBuffer: 4194304 })).stdout.trim(); }
    catch { throw Error('DOCKER_OPERATION_FAILED'); } // no command/env/raw Docker error disclosure
  };
  const platform = await call(['info', '--format', '{{.OSType}}/{{.Architecture}}']);
  if (!['linux/x86_64', 'linux/amd64'].includes(platform)) throw Error('LINUX_AMD64_DOCKER_REQUIRED');
  if (!(await exists(folder))) {
    if (action !== 'start') throw Error('DEMO_NOT_INITIALIZED');
    await createBundle(folder, portArg ? Number(portArg) : 5183);
    console.log('Created fresh local credentials in runtime/teammate-demo/demo.env; do not share this file.');
  }
  const m = JSON.parse(await readFile(join(folder, 'manifest.json'), 'utf8'));
  validateManifest(m);
  if (portArg && Number(portArg) !== m.port) throw Error('PORT_CHANGED_REQUIRES_REVIEW');
  const configText = await readFile(join(folder, 'demo.env'), 'utf8');
  for (const [key, value] of Object.entries({ HANDOFF_PROJECT: m.project, HANDOFF_UI_PORT: String(m.port), ...images })) {
    const entries = configText.split(/\r?\n/).filter(line => line.startsWith(`${key}=`));
    if (entries.length !== 1 || entries[0] !== `${key}=${value}`) throw Error('CONFIG_BINDING_MISMATCH');
  }
  const state = join(folder, 'watchdog-state.json');
  await exclusiveOperation(folder, action, async () => {
  if (action !== 'status' && await exists(`${state}.runner.lock`)) throw Error('STOP_WATCHDOG_BEFORE_MAINTENANCE');
  const args = composeArgs(folder, m);
  await call([...args, 'config', '--quiet']);
  if (action === 'start') {
    console.log('Pulling pinned images (GHCR login/read access required)...');
    await call([...args, 'pull']);
    console.log('Starting isolated demo. This may take a few minutes...');
    await call([...args, 'up', '-d', '--pull', 'never', '--wait', '--wait-timeout', '180']);
    const page = await fetch(`http://127.0.0.1:${m.port}/`, { signal: AbortSignal.timeout(10000), redirect: 'error' });
    if (!page.ok || !(await page.text()).includes('id="root"')) throw Error('UI_NOT_VERIFIED');
    const api = await fetch(`http://127.0.0.1:${m.port}/api/v2/admin/event-feed`, { signal: AbortSignal.timeout(10000), redirect: 'error' });
    if (api.status !== 401) throw Error('API_AUTH_BOUNDARY_NOT_VERIFIED');
    console.log(`Demo ready: http://localhost:${m.port}. Admin credentials: runtime/teammate-demo/demo.env`);
    console.log('Fresh empty OFFLINE_DEMO. Create an Analyst from Admin Users. Medusa/Qwen/autoscale are OFF.');
  } else if (action === 'watchdog') {
    const config = { ...JSON.parse(await readFile(join(root, 'tools/resilience-watchdog/demo.config.json'), 'utf8')), project: m.project };
    if (!(await exists(state))) await initialize(config, state);
    const stop = new AbortController();
    const shutdown = () => stop.abort();
    process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
    try {
      console.log('Foreground normalizer Watchdog: keep terminal open, Ctrl+C before demo stop. No autoscaling.');
      await run(config, state, dockerAdapter(config, docker), { intervalMs: 10000, apply: true, signal: stop.signal,
        onEvents: events => console.log(JSON.stringify(events)) });
    } finally { process.off('SIGINT', shutdown); process.off('SIGTERM', shutdown); }
  } else console.log(await call([...args, action === 'stop' ? 'stop' : 'ps', ...(action === 'status' ? ['-a'] : [])]));
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => {
    console.error('Demo operation stopped. Check Docker Linux/amd64, GHCR login, free UI port and local manifest/config/Watchdog lock. No data was deleted. See docs/TEAMMATE_FRESH_DEMO.md.');
    process.exitCode = 1;
  });
}
