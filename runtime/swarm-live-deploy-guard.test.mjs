import test from 'node:test';
import assert from 'node:assert/strict';
import { liveDeploymentDrift, assertReviewedLiveDrift } from './swarm-live-deploy-guard.mjs';

const config = {
  SWARM_API_IMAGE: 'ghcr.io/example/api@sha256:' + 'a'.repeat(64),
  SWARM_WEB_IMAGE: 'ghcr.io/example/web@sha256:' + 'b'.repeat(64),
  SWARM_WORKERS_IMAGE: 'ghcr.io/example/workers@sha256:' + 'c'.repeat(64),
  SWARM_NORMALIZER_IMAGE: 'ghcr.io/example/workers@sha256:' + 'd'.repeat(64),
  SWARM_PROFILE_PUBLISHER_IMAGE: 'ghcr.io/example/workers@sha256:' + 'e'.repeat(64),
  SWARM_FUNNEL_PROCESSOR_IMAGE: 'ghcr.io/example/workers@sha256:' + 'f'.repeat(64),
  SWARM_PRODUCT_REFERENCE_PROVIDER: 'catalog_cdc',
  SWARM_ENABLE_CDC_REFERENCE_CANDIDATE: 'true',
  SWARM_ENABLE_CDC_REFERENCE_ACTIVE: 'true',
  SWARM_ENABLE_CDC_REFERENCE_OFFER: 'true',
  SWARM_CDC_REFERENCE_SOURCE_ID: 'medusa-reference',
  SWARM_CDC_REFERENCE_COVERAGE_EPOCH_ID: 'cdc11_order_epoch1',
  SWARM_CDC_REFERENCE_ACTIVATION_AT: '2026-10-30T00:00:00Z',
};

const live = {
  'dashboard-api': { Image: config.SWARM_API_IMAGE, Env: [
    'PRODUCT_REFERENCE_PROVIDER=catalog_cdc',
    'DASHBOARD_ENABLE_CDC_REFERENCE_CANDIDATE=true',
    'DASHBOARD_ENABLE_CDC_REFERENCE_ACTIVE=true',
    'DASHBOARD_ENABLE_CDC_REFERENCE_OFFER=true',
    'CDC_REFERENCE_SOURCE_ID=medusa-reference',
    'CDC_REFERENCE_COVERAGE_EPOCH_ID=cdc11_order_epoch1',
    'CDC_REFERENCE_ACTIVATION_AT=2026-10-30T00:00:00Z',
  ] },
  'dashboard-web': { Image: config.SWARM_WEB_IMAGE },
  'canonical-ledger-writer': { Image: config.SWARM_WORKERS_IMAGE },
  'journey-processor': { Image: config.SWARM_WORKERS_IMAGE },
  'canonical-normalizer': { Image: config.SWARM_NORMALIZER_IMAGE },
  'profile-publisher': { Image: config.SWARM_PROFILE_PUBLISHER_IMAGE },
  'funnel-processor': { Image: config.SWARM_FUNNEL_PROCESSOR_IMAGE },
};

test('unchanged live deployment needs no acknowledgment', () => {
  const drift = liveDeploymentDrift(config, live);
  assert.deepEqual(drift, { changes: [], digest: null });
  assert.doesNotThrow(() => assertReviewedLiveDrift(drift));
});

test('stale env cannot replace live CDC API image or disable its flags', () => {
  const stale = { ...config, SWARM_API_IMAGE: 'ghcr.io/example/old-api@sha256:' + '0'.repeat(64),
    SWARM_ENABLE_CDC_REFERENCE_ACTIVE: 'false' };
  const drift = liveDeploymentDrift(stale, live);
  assert.deepEqual(drift.changes.map(change => change.field),
    ['DASHBOARD_ENABLE_CDC_REFERENCE_ACTIVE', 'image']);
  assert.throws(() => assertReviewedLiveDrift(drift), /Live deployment drift/);
  assert.doesNotThrow(() => assertReviewedLiveDrift(drift, drift.digest));
});

test('scoped worker upgrade is visible and requires its exact digest', () => {
  const next = { ...config, SWARM_NORMALIZER_IMAGE: 'ghcr.io/example/workers@sha256:' + '1'.repeat(64) };
  const drift = liveDeploymentDrift(next, live);
  assert.deepEqual(drift.changes.map(change => `${change.service}.${change.field}`),
    ['canonical-normalizer.image']);
  assert.throws(() => assertReviewedLiveDrift(drift, 'incorrect'), /reviewed change digest/);
});
