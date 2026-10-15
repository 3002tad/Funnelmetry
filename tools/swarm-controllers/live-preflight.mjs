// Read-only diagnostic for a live Swarm controller candidate. An explicit
// local-demo attestation can report operator-apply eligibility; this tool
// never starts or scales a service and does not certify production security.
import { execFile } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { status, validateConfig } from './controller.mjs';
import { measure, prepareMeasureConfig } from './measure.mjs';
import { inspectLocalDemoBoundary } from './local-demo-attestation.mjs';

const exec = promisify(execFile);
const digest = value => typeof value === 'string' && /@sha256:[a-f0-9]{64}$/.test(value);

async function docker(args) {
  try {
    return (await exec('docker', args, { timeout: 30000, maxBuffer: 64 * 1024,
      windowsHide: true })).stdout.trim();
  } catch { return null; }
}

async function exists(path) {
  try { await stat(path); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

export function evaluateLivePreflight({ config, runtimeImage, managerReady, authorizationPlugins,
  persisted, observation, sessionActive, localDemoBoundaryAttested = false }) {
  validateConfig(config);
  const blockers = [];
  if (managerReady !== true) blockers.push('SWARM_MANAGER_UNVERIFIED');
  if (!digest(runtimeImage) || runtimeImage !== config.image) blockers.push('IMAGE_DIGEST_MISMATCH');
  if (config.evidence?.image !== config.image) blockers.push('RELEASE_REPLAY_DRAIN_EVIDENCE_MISSING');
  if (persisted === null) blockers.push('CONTROLLER_STATE_UNVERIFIED');
  else {
    if (persisted.pendingOperatorReview || persisted.autoscale?.pending) blockers.push('ACTION_PENDING_REVIEW');
    if (persisted.recovery?.circuitOpen) blockers.push('RECOVERY_CIRCUIT_OPEN');
  }
  if (sessionActive !== false) blockers.push('RUNNER_SESSION_UNVERIFIED');
  if (observation === null) blockers.push('LIVE_OBSERVATION_UNAVAILABLE');
  else {
    if (observation.ready !== true || observation.groupStable !== true ||
      observation.memberCount !== observation.replicas || observation.identityVerified !== true) {
      blockers.push('REPLICA_READINESS_UNVERIFIED');
    }
    if (!Number.isSafeInteger(observation.partitions) || observation.partitions < config.autoscale.maxReplicas ||
      !Number.isSafeInteger(observation.hostReplicaLimit) ||
      observation.hostReplicaLimit < config.autoscale.maxReplicas) blockers.push('PARTITION_OR_CAPACITY_CEILING');
    if (!Array.isArray(observation.unavailable) || observation.unavailable.length) blockers.push('LIVE_PROBE_UNAVAILABLE');
    if (config.autoscale.upMemoryPercent !== undefined &&
      (typeof observation.memoryPercentMax !== 'number' || !Number.isFinite(observation.memoryPercentMax))) {
      blockers.push('MEMORY_PROBE_UNAVAILABLE');
    }
  }
  // This narrow attestation is local-demo risk acceptance only. A plugin alone
  // never proves restricted authority; the broker still owns a privileged socket.
  if (!localDemoBoundaryAttested) blockers.push('RESTRICTED_DOCKER_ACTUATOR_NOT_ATTESTED');
  return {
    source: 'live_read_only_preflight', stack: config.stack, service: config.service,
    controllerImageMatchesRuntime: runtimeImage === config.image,
    authorizationPluginCount: Array.isArray(authorizationPlugins) ? authorizationPlugins.length : null,
    observedReplicas: observation?.replicas ?? null,
    observedConsumableLag: observation?.consumableLag ?? null,
    blockers,
    applyAuthorized: blockers.length === 0 && localDemoBoundaryAttested,
    authorizationScope: localDemoBoundaryAttested ? 'LOCAL_DOCKER_DESKTOP_DEMO' : null,
  };
}

export async function livePreflight(configPath, statePath, attestationPath) {
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  validateConfig(config);
  const manager = await docker(['info', '--format',
    '{{.Swarm.LocalNodeState}}|{{.Swarm.ControlAvailable}}|{{json .Plugins.Authorization}}']);
  const [state, control, pluginsJson] = manager?.split('|') ?? [];
  let authorizationPlugins = null;
  try {
    authorizationPlugins = pluginsJson === 'null' ? [] : JSON.parse(pluginsJson);
  } catch { /* fail closed in report */ }
  const runtimeImage = await docker(['service', 'inspect', `${config.stack}_${config.service}`,
    '--format', '{{.Spec.TaskTemplate.ContainerSpec.Image}}']);
  let persisted = null;
  try { persisted = await status(config, statePath); } catch { /* preserve state; report unknown */ }
  const sessionActive = await exists(`${statePath}.session`);
  let observation = null;
  if (digest(runtimeImage)) {
    try {
      const { config: scoped } = prepareMeasureConfig(config, runtimeImage);
      [observation] = await measure(scoped, { configuredImage: config.image });
    } catch { /* fail closed in report */ }
  }
  let localDemoBoundaryAttested = false;
  if (attestationPath) {
    try {
      const attestation = JSON.parse(await readFile(attestationPath, 'utf8'));
      if (attestation.targetStack === config.stack && attestation.targetService === config.service &&
        attestation.targetImage === config.image) {
        localDemoBoundaryAttested = await inspectLocalDemoBoundary(attestation);
      }
    } catch { /* fail closed in report */ }
  }
  return evaluateLivePreflight({ config, runtimeImage, managerReady: state === 'active' && control === 'true',
    authorizationPlugins, persisted, observation, sessionActive, localDemoBoundaryAttested });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length < 4 || process.argv.length > 5) throw Error('Expected config, state and optional attestation paths');
    const report = await livePreflight(process.argv[2], process.argv[3], process.argv[4]);
    console.log(JSON.stringify(report));
    if (report.blockers.length) process.exitCode = 2;
  } catch {
    console.error('Read-only live preflight failed; no controller state or Swarm service was changed.');
    process.exitCode = 2;
  }
}
