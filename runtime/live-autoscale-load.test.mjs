import test from 'node:test';
import assert from 'node:assert/strict';
import { liveAutoscaleLoad, prepareLiveLoad } from './live-autoscale-load.mjs';

const env = { FUNNELMETRY_SOURCE_INGRESS_URL: 'https://source.example.test/v1/ingress/events',
  FUNNELMETRY_SOURCE_ID: 'medusa-reference', FUNNELMETRY_SOURCE_KEY_ID: 'browser-key-id',
  FUNNELMETRY_BROWSER_WRITE_KEY: 'private-test-write-key', SWARM_FEED_ID: 'expected-feed',
  SWARM_LIVE_LOAD_ACK: 'LABELED_BEHAVIOR_ONLY' };
const readiness = feed => async () => ({ ok: true, async json() { return { event_feed_id: feed }; } });

test('bounded behavior-only live load requires a separate write credential and explicit ack', () => {
  const { options } = prepareLiveLoad(env, { command: 'run', journeys: 150 });
  assert.equal(options.mode, 'behavior');
  assert.equal(options.journeys, 150);
  assert.equal(options.concurrency, 4);
  assert.equal(options.writeKey, env.FUNNELMETRY_BROWSER_WRITE_KEY);
  assert.throws(() => prepareLiveLoad({ ...env, FUNNELMETRY_BROWSER_WRITE_KEY: '' },
    { command: 'check' }), /FUNNELMETRY_BROWSER_WRITE_KEY/);
  assert.throws(() => prepareLiveLoad({ ...env, SWARM_LIVE_LOAD_ACK: '' },
    { command: 'run' }), /SWARM_LIVE_LOAD_ACK/);
  assert.throws(() => prepareLiveLoad(env, { command: 'run', journeys: 151 }), /1\.\.150/);
  assert.throws(() => prepareLiveLoad({ ...env, FUNNELMETRY_SOURCE_INGRESS_URL: 'http://source.example.test' },
    { command: 'run' }), /HTTPS/);
});

test('check is read-only and rejects a different source feed lineage', async () => {
  let called = false;
  await assert.rejects(liveAutoscaleLoad(env, { command: 'run', journeys: 1,
    fetchImpl: readiness('wrong-feed'), bot: async () => { called = true; } }), /Feed identity mismatch/);
  assert.equal(called, false);
  const messages = [];
  const report = await liveAutoscaleLoad(env, { command: 'check',
    fetchImpl: readiness('expected-feed'), bot: async () => { called = true; },
    log: message => messages.push(message) });
  assert.equal(report.writes, 0);
  assert.equal(called, false);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].includes(env.FUNNELMETRY_BROWSER_WRITE_KEY), false);
});

test('run emits a bounded sanitized report without exposing key or response details', async () => {
  const messages = [];
  const report = await liveAutoscaleLoad(env, { command: 'run', journeys: 3,
    fetchImpl: readiness('expected-feed'),
    bot: async options => ({ journeys_requested: options.journeys, journeys_succeeded: 3,
      journeys_failed: 0, events_source_accepted: 6, medusa_orders_created: 0,
      duration_ms: 500 }), log: message => messages.push(message) });
  assert.equal(report.eventsSourceAccepted, 6);
  assert.equal(report.medusaOrdersCreated, 0);
  assert.equal(JSON.stringify(messages).includes(env.FUNNELMETRY_BROWSER_WRITE_KEY), false);
});
