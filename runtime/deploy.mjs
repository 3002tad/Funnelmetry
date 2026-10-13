// LEGACY COMPOSE rollback only. New deployments use runtime/swarm.mjs.
// Retained for DEC-125 recovery provenance; never run accidentally.
import { readFile, access } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { parseEnv } from 'node:util';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const envFile = join(root, 'runtime', 'deploy.env');
const composeFile = join(root, 'infra', 'compose.yaml');
const supportedProfiles = new Set(['live', 'catalog', 'monitoring']);
const monitoringFiles = [
  'metrics-token', 'grafana-password', 'credential.json', 'dashboards/pipeline.json',
].map(name => join(root, 'runtime', 'monitoring', name));

export function parseProfiles(value = '') {
  const profiles = value.split(',').map(item => item.trim()).filter(Boolean);
  if (new Set(profiles).size !== profiles.length || profiles.some(item => !supportedProfiles.has(item))) {
    throw Error('HANDOFF_DEPLOY_PROFILES must contain each of live,catalog,monitoring at most once');
  }
  return profiles;
}

function required(value, name) {
  if (!value?.trim() || /^(change-me|example|placeholder|todo)$/i.test(value.trim())) {
    throw Error(`${name} must be configured in ignored runtime/deploy.env`);
  }
}

function httpsUrl(value, name) {
  let url;
  try { url = new URL(value); } catch { throw Error(`${name} must be a valid HTTPS URL`); }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) {
    throw Error(`${name} must be a valid HTTPS URL without embedded credentials or fragment`);
  }
}

export function validateConfig(env) {
  if (Object.keys(env).some(key => /^COMPOSE_/i.test(key))) {
    throw Error('Remove COMPOSE_* from deploy.env; use HANDOFF_DEPLOY_PROFILES for one reviewed profile set');
  }
  const profiles = parseProfiles(env.HANDOFF_DEPLOY_PROFILES);
  for (const key of ['HANDOFF_PROJECT', 'HANDOFF_DB_PASSWORD', 'HANDOFF_JWT_SECRET',
    'HANDOFF_ADMIN_EMAIL', 'HANDOFF_ADMIN_PASSWORD', 'HANDOFF_API_IMAGE',
    'HANDOFF_WEB_IMAGE', 'HANDOFF_WORKERS_IMAGE']) required(env[key], key);
  if (!['build', 'always'].includes(env.HANDOFF_IMAGE_POLICY)) {
    throw Error('HANDOFF_IMAGE_POLICY must be build or always');
  }
  if (env.HANDOFF_IMAGE_POLICY === 'always') {
    for (const key of ['HANDOFF_API_IMAGE', 'HANDOFF_WEB_IMAGE', 'HANDOFF_WORKERS_IMAGE']) {
      if (!/@sha256:[a-f0-9]{64}$/.test(env[key])) throw Error(`${key} must use a verified sha256 digest for image-only deployment`);
    }
  }
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(env.HANDOFF_PROJECT)) {
    throw Error('HANDOFF_PROJECT must be a lowercase Compose project name');
  }
  const port = Number(env.HANDOFF_UI_PORT);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw Error('HANDOFF_UI_PORT must be 1024..65535');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(env.HANDOFF_ADMIN_EMAIL)) {
    throw Error('HANDOFF_ADMIN_EMAIL must be a valid email address');
  }
  if (!['true', 'false'].includes(env.HANDOFF_ENABLE_QWEN)) throw Error('HANDOFF_ENABLE_QWEN must be true or false');
  const rawPartitions = Number(env.HANDOFF_RAW_PARTITIONS ?? '1');
  if (!/^[1-9][0-9]*$/.test(env.HANDOFF_RAW_PARTITIONS ?? '1') || !Number.isSafeInteger(rawPartitions)
    || rawPartitions > 32) throw Error('HANDOFF_RAW_PARTITIONS must be 1..32 for a new isolated project');
  const normalizerMode = env.HANDOFF_NORMALIZER_ID_MODE ?? 'explicit';
  if (!['explicit', 'container'].includes(normalizerMode)) {
    throw Error('HANDOFF_NORMALIZER_ID_MODE must be explicit or container');
  }
  if (rawPartitions > 1 && normalizerMode !== 'container') {
    throw Error('Multi-partition Raw Kafka requires unique container normalizer identity');
  }
  if (!['true', 'false'].includes(env.HANDOFF_MONITORING_ENABLED)) {
    throw Error('HANDOFF_MONITORING_ENABLED must be true or false');
  }
  if (env.HANDOFF_ENABLE_QWEN === 'true') {
    required(env.HANDOFF_DASHSCOPE_API_KEY, 'HANDOFF_DASHSCOPE_API_KEY');
    httpsUrl(env.HANDOFF_DASHSCOPE_BASE_URL, 'HANDOFF_DASHSCOPE_BASE_URL');
  }
  if (profiles.includes('live')) {
    if (env.HANDOFF_LIVE_ACK !== 'FRESH_PARALLEL_LIVE') {
      throw Error('Live Feed requires reviewed HANDOFF_LIVE_ACK=FRESH_PARALLEL_LIVE');
    }
    for (const key of ['HANDOFF_CONNECTOR_ID', 'HANDOFF_FEED_TOKEN', 'HANDOFF_FEED_ID',
      'HANDOFF_INITIAL_AFTER_SEQ']) required(env[key], key);
    if (!/^(0|[1-9][0-9]*)$/.test(env.HANDOFF_INITIAL_AFTER_SEQ)) {
      throw Error('HANDOFF_INITIAL_AFTER_SEQ must be an explicit nonnegative integer');
    }
    httpsUrl(env.HANDOFF_FEED_URL, 'HANDOFF_FEED_URL');
  }
  if (profiles.includes('catalog')) {
    required(env.HANDOFF_CATALOG_KEY, 'HANDOFF_CATALOG_KEY');
    httpsUrl(env.HANDOFF_CATALOG_URL, 'HANDOFF_CATALOG_URL');
  }
  if (profiles.includes('monitoring') !== (env.HANDOFF_MONITORING_ENABLED === 'true')) {
    throw Error('monitoring profile and HANDOFF_MONITORING_ENABLED=true must be selected together');
  }
  if (profiles.includes('monitoring')) {
    const grafanaPort = Number(env.MONITORING_GRAFANA_PORT);
    if (!Number.isInteger(grafanaPort) || grafanaPort < 1024 || grafanaPort > 65535 || grafanaPort === port) {
      throw Error('MONITORING_GRAFANA_PORT must be 1024..65535 and differ from HANDOFF_UI_PORT');
    }
  }
  return profiles;
}

export function profileArgs(profiles) {
  return profiles.flatMap(profile => ['--profile', profile]);
}

export function assertLegacyRollbackAcknowledged(env = process.env) {
  if (env.FUNNELMETRY_LEGACY_COMPOSE_ACK !== 'ROLLBACK_ONLY') {
    throw Error('Legacy Compose launcher disabled for normal deployment; use runtime/swarm.mjs. Explicit DEC-125 rollback requires FUNNELMETRY_LEGACY_COMPOSE_ACK=ROLLBACK_ONLY');
  }
}

function run(executable, args, childEnv) {
  const result = spawnSync(executable, args, { cwd: root, env: childEnv, stdio: 'inherit', windowsHide: true });
  if (result.error || result.status !== 0) throw Error('Deployment command failed; inspect the preceding sanitized output');
}

async function artifactsState() {
  const present = await Promise.all(monitoringFiles.map(file => access(file).then(() => true, () => false)));
  if (present.some(Boolean) && !present.every(Boolean)) {
    throw Error('Monitoring artifacts are incomplete; inspect ignored runtime/monitoring before retrying');
  }
  return present.every(Boolean);
}

async function waitForMonitoring(childEnv) {
  const args = [join(root, 'runtime', 'check-monitoring.mjs')];
  console.log('Waiting for the first authenticated monitoring scrape (up to 60 seconds)...');
  for (let attempt = 0; attempt < 7; attempt++) {
    const result = spawnSync(process.execPath, args, {
      cwd: root, env: childEnv, stdio: attempt === 6 ? 'inherit' : 'ignore', windowsHide: true,
    });
    if (!result.error && result.status === 0) return;
    if (attempt < 6) await delay(10000);
  }
  throw Error('Monitoring acceptance failed; inspect scrape, credential expiry and worker readiness');
}

export async function main(action = 'check') {
  assertLegacyRollbackAcknowledged();
  if (!['check', 'start', 'status', 'stop'].includes(action)) {
    throw Error('Usage: node runtime/deploy.mjs <check|start|status|stop>');
  }
  let env;
  try { env = parseEnv(await readFile(envFile, 'utf8')); }
  catch { throw Error('Create ignored runtime/deploy.env from runtime/deploy.env.example first'); }
  const profiles = validateConfig(env);
  // Shell variables must not silently override the reviewed file during Compose interpolation.
  const childEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    !/^(HANDOFF_|MONITORING_|COMPOSE_)/i.test(key)));
  const compose = (...args) => run('docker', ['compose', '--env-file', envFile, '-f', composeFile, ...args], childEnv);
  const selected = profileArgs(profiles);
  compose(...selected, 'config', '--quiet');
  if (action === 'check') {
    if (profiles.includes('monitoring')) await artifactsState();
    console.log(`PASS: Compose config and selected profiles (${profiles.join(', ') || 'core'}); no services started.`);
    return;
  }
  if (action === 'status') return compose(...selected, 'ps', '-a');
  if (action === 'stop') return compose(...selected, 'stop');

  const buildArgs = env.HANDOFF_IMAGE_POLICY === 'build' ? ['--build'] : [];
  if (profiles.includes('monitoring')) {
    // Bootstrap API/account first; then install additive monitoring schema and issue a
    // metrics-only credential. Prometheus/Grafana must never start with placeholder secrets.
    compose('up', '-d', ...buildArgs, '--wait');
    compose('--profile', 'monitoring', 'run', '--rm', 'monitoring-schema');
    if (!await artifactsState()) run(process.execPath, [join(root, 'runtime', 'prepare-monitoring.mjs')], childEnv);
  }
  compose(...selected, 'up', '-d', ...buildArgs, '--wait');
  if (profiles.includes('monitoring')) await waitForMonitoring(childEnv);
  console.log(`PASS: selected services started (${profiles.join(', ') || 'core'}). Verify event lineage and tool evidence separately.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { await main(process.argv[2]); }
  catch (error) { console.error(`Deployment stopped: ${error.message}`); process.exitCode = 1; }
}
