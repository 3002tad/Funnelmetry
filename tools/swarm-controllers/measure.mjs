// Read-only Swarm observation. This does not load or mutate controller state.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { collect, validateConfig } from './controller.mjs';
import { dockerClient } from './docker.mjs';

export function prepareMeasureConfig(config, imageOverride) {
  validateConfig(config);
  if (imageOverride === undefined) return { config: structuredClone(config), imageOverrideUsed: false };
  const prepared = structuredClone(config);
  prepared.image = imageOverride;
  if (imageOverride !== config.image) delete prepared.evidence;
  validateConfig(prepared);
  return { config: prepared, imageOverrideUsed: imageOverride !== config.image };
}

export function projectMeasure(observation, config, configuredImage, checkedAt) {
  return {
    checkedAt: new Date(checkedAt).toISOString(), source: 'live_read_only',
    stack: config.stack, service: config.service, image: config.image,
    configuredImageMatchesRuntime: configuredImage === config.image,
    replicas: observation.service.replicas, ready: observation.autoscale.ready,
    groupStable: observation.autoscale.groupStable, memberCount: observation.autoscale.memberCount,
    partitions: observation.autoscale.partitions, consumableLag: observation.autoscale.lag,
    memoryPercentMax: observation.autoscale.memoryPercentMax,
    rawOffsetLag: observation.autoscale.rawOffsetLag,
    controlOnlyPartitions: observation.autoscale.controlOnlyPartitions,
    identityVerified: observation.autoscale.identityVerified,
    hostReplicaLimit: observation.autoscale.hostReplicaLimit,
    releaseEvidenceConfigured: observation.autoscale.replayVerified,
    unavailable: observation.unavailable,
  };
}

export async function measure(config, { samples = 1, intervalMs = 5000, configuredImage = config.image, clock = Date.now,
  wait = delay, adapter = dockerClient(config), onSample = () => {} } = {}) {
  validateConfig(config);
  if (!Number.isSafeInteger(samples) || samples < 1 || samples > 20 ||
    !Number.isSafeInteger(intervalMs) || intervalMs < 1000 || intervalMs > 60000) {
    throw Error('Invalid bounded measurement window');
  }
  const results = [];
  for (let index = 0; index < samples; index++) {
    if (index) await wait(intervalMs);
    const checkedAt = clock();
    const observation = await collect(config, adapter, checkedAt);
    const result = projectMeasure(observation, config, configuredImage, checkedAt);
    results.push(result);
    await onSample(result);
  }
  return results;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [configPath, ...flags] = process.argv.slice(2);
    const parsed = Object.fromEntries(flags.map(flag => {
      const match = /^--(image|samples|interval-ms)=(.+)$/.exec(flag);
      if (!match) throw Error('Invalid measurement flag');
      return [match[1], match[2]];
    }));
    if (!configPath || flags.length !== Object.keys(parsed).length) throw Error('Invalid measurement arguments');
    const original = JSON.parse(await readFile(configPath, 'utf8'));
    const { config } = prepareMeasureConfig(original, parsed.image);
    const samples = parsed.samples === undefined ? 1 : Number(parsed.samples);
    const intervalMs = parsed['interval-ms'] === undefined ? 5000 : Number(parsed['interval-ms']);
    await measure(config, { samples, intervalMs, configuredImage: original.image,
      onSample: result => console.log(JSON.stringify(result)) });
  } catch {
    console.error('Read-only Swarm measurement failed; verify scope, digest, Docker and Kafka. No controller state or service was changed.');
    process.exitCode = 1;
  }
}
