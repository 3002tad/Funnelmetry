import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runnerOptions } from './broker-runner.mjs';

test('scale-only runner requires explicit live acknowledgement', () => {
  assert.throws(() => runnerOptions({}), /REVIEWED_LIVE_AUTOSCALE_ACK_REQUIRED/);
  assert.deepEqual(runnerOptions({ SWARM_CONTROLLER_APPLY: 'reviewed-live-autoscale' }), {
    endpoint: 'http://swarm-scale-broker:32130/', intervalMs: 30000,
  });
});

test('Swarm controller template isolates Docker socket and publishes no port', () => {
  const manifest = readFileSync(new URL('../../infra/swarm-scale-controller.yml', import.meta.url), 'utf8');
  const broker = manifest.split('  swarm-scale-broker:')[1].split('  swarm-scale-controller:')[0];
  const controller = manifest.split('  swarm-scale-controller:')[1].split('\nnetworks:')[0];
  assert.match(broker, /source: \/var\/run\/docker\.sock/);
  assert.doesNotMatch(controller, /docker\.sock|ports:/);
  assert.match(manifest, /internal: true/);
  assert.match(manifest, /SWARM_SCALE_CONTROLLER_REPLICAS:-0/);
  assert.match(manifest, /SWARM_SCALE_BROKER_REPLICAS:-0/);
});
