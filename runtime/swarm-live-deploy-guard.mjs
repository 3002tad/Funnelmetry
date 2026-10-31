import { createHash } from 'node:crypto';

const imageBindings = Object.freeze({
  'dashboard-api': 'SWARM_API_IMAGE',
  'dashboard-web': 'SWARM_WEB_IMAGE',
  'canonical-ledger-writer': 'SWARM_WORKERS_IMAGE',
  'journey-processor': 'SWARM_WORKERS_IMAGE',
  'canonical-normalizer': 'SWARM_NORMALIZER_IMAGE',
  'profile-publisher': 'SWARM_PROFILE_PUBLISHER_IMAGE',
  'funnel-processor': 'SWARM_FUNNEL_PROCESSOR_IMAGE',
});

const apiEnvironment = Object.freeze({
  PRODUCT_REFERENCE_PROVIDER: ['SWARM_PRODUCT_REFERENCE_PROVIDER', 'catalog_cdc'],
  DASHBOARD_ENABLE_CDC_REFERENCE_CANDIDATE: ['SWARM_ENABLE_CDC_REFERENCE_CANDIDATE', 'false'],
  DASHBOARD_ENABLE_CDC_REFERENCE_ACTIVE: ['SWARM_ENABLE_CDC_REFERENCE_ACTIVE', 'false'],
  DASHBOARD_ENABLE_CDC_REFERENCE_OFFER: ['SWARM_ENABLE_CDC_REFERENCE_OFFER', 'false'],
  CDC_REFERENCE_SOURCE_ID: ['SWARM_CDC_REFERENCE_SOURCE_ID', ''],
  CDC_REFERENCE_COVERAGE_EPOCH_ID: ['SWARM_CDC_REFERENCE_COVERAGE_EPOCH_ID', ''],
  CDC_REFERENCE_ACTIVATION_AT: ['SWARM_CDC_REFERENCE_ACTIVATION_AT', ''],
});

export const guardedServices = Object.freeze(Object.keys(imageBindings));

export function liveDeploymentDrift(config, liveServices) {
  const changes = [];
  for (const [service, key] of Object.entries(imageBindings)) {
    const live = liveServices[service];
    if (!live) continue;
    const desired = config[key]?.trim() ||
      (['SWARM_NORMALIZER_IMAGE', 'SWARM_PROFILE_PUBLISHER_IMAGE', 'SWARM_FUNNEL_PROCESSOR_IMAGE'].includes(key)
        ? config.SWARM_WORKERS_IMAGE?.trim() : '');
    if (!desired) throw Error(`${key} missing from reviewed deployment env`);
    if (live.Image !== desired) changes.push({ service, field: 'image', from: live.Image, to: desired });
  }
  const api = liveServices['dashboard-api'];
  if (api) {
    const current = Object.fromEntries((api.Env ?? []).map(value => {
      const delimiter = value.indexOf('=');
      return [value.slice(0, delimiter), value.slice(delimiter + 1)];
    }));
    for (const [field, [key, fallback]] of Object.entries(apiEnvironment)) {
      const desired = config[key] ?? fallback;
      if (current[field] !== desired) {
        changes.push({ service: 'dashboard-api', field, from: current[field] ?? null, to: desired });
      }
    }
  }
  changes.sort((a, b) => `${a.service}/${a.field}`.localeCompare(`${b.service}/${b.field}`));
  const digest = changes.length ? createHash('sha256').update(JSON.stringify(changes)).digest('hex') : null;
  return { changes, digest };
}

export function assertReviewedLiveDrift(drift, acknowledgment) {
  if (drift.digest && acknowledgment !== drift.digest) {
    const fields = drift.changes.map(change => `${change.service}.${change.field}`).join(', ');
    throw Error(`Live deployment drift: ${fields}; reviewed change digest ${drift.digest}. ` +
      'Run check-app, review current and desired service config, then set SWARM_DEPLOY_CHANGE_ACK to this digest for one deploy.');
  }
}
