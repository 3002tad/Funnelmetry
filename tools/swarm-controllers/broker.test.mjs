import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { brokerClient } from './broker-client.mjs';
import { createBrokerServer, dispatchBroker } from './broker.mjs';

const base = JSON.parse(readFileSync(new URL('./config.example.json', import.meta.url), 'utf8'));
const config = { ...base, evidence: { image: base.image,
  replayTestRef: 'reviewed-replay-123', drainTestRef: 'reviewed-drain-123' } };
const token = 't'.repeat(40);

function fixture() {
  let version = 1, replicas = 1, lag = 200, scales = 0;
  const targets = Array.from({ length: 2 }, (_, i) => ({ id: `${i + 1}`.repeat(64),
    taskId: `${i + 1}`.repeat(25), startedAt: 1, running: true }));
  const service = () => ({ id: 'service-id', version, replicas,
    reservation: { NanoCPUs: 100000000, MemoryBytes: 268435456 } });
  return {
    get scales() { return scales; },
    setLag(value) { lag = value; },
    async discover() { return { service: service(), targets: targets.slice(0, replicas) }; },
    async inspectService() { return { ID: 'service-id', Version: { Index: version }, Spec: {
      Name: `${config.stack}_${config.service}`, Labels: { 'com.docker.stack.namespace': config.stack },
      Mode: { Replicated: { Replicas: replicas } }, TaskTemplate: {
        ContainerSpec: { Image: config.image }, Resources: { Reservations: service().reservation },
      },
    } }; },
    async health() { return { liveness: 'alive', readiness: true }; },
    async identity(target) { return { mode: 'container', instanceId: target.taskId, clientId: 'client',
      groupId: config.groupId, topic: config.topic }; },
    async memory() { return 10; },
    async kafka() { return { ends: [{ partition: 0, high: String(lag), low: '0' },
      { partition: 1, high: '0', low: '0' }],
    commits: [{ partition: 0, offset: '0' }, { partition: 1, offset: '0' }],
    assignments: Array.from({ length: replicas }, (_, i) =>
      [0, 1].filter(partition => partition % replicas === i)), memberCount: replicas, stable: true }; },
    async capacity() { return { nodeCpu: 4e9, nodeMem: 8 * 1024 ** 3,
      usedCpu: 1e9, usedMem: 1 * 1024 ** 3, cpuPerReplica: 100000000,
      memPerReplica: 268435456, currentReplicas: replicas }; },
    async scale(next) { replicas = next; version++; scales++; },
  };
}

test('broker denies arbitrary Docker methods, foreign tasks and unreviewed release', async () => {
  const adapter = fixture();
  for (const method of ['containerCreate', 'removeStack', 'forceUpdate', 'exec']) {
    await assert.rejects(dispatchBroker(config, adapter, { method }), /METHOD_DENIED/);
  }
  await assert.rejects(dispatchBroker(config, adapter, { method: 'health', targetId: 'foreign' }),
    /TASK_SCOPE_UNVERIFIED/);
  await assert.rejects(dispatchBroker(base, adapter, { method: 'scale', desiredReplicas: 2 }),
    /LIVE_SCALE_GUARD_UNVERIFIED/);
  assert.equal(adapter.scales, 0);
});

test('broker accepts only one-step allowlisted scaling with verified live signal', async () => {
  const adapter = fixture();
  await assert.rejects(dispatchBroker(config, adapter, { method: 'scale', desiredReplicas: 3 }),
    /REPLICA_BOUND_DENIED/);
  adapter.setLag(0);
  await assert.rejects(dispatchBroker(config, adapter, { method: 'scale', desiredReplicas: 2 }),
    /SCALE_UP_SIGNAL_UNVERIFIED/);
  adapter.setLag(200);
  assert.deepEqual(await dispatchBroker(config, adapter, { method: 'scale', desiredReplicas: 2 }),
    { accepted: true, previousReplicas: 1, desiredReplicas: 2 });
  await assert.rejects(dispatchBroker(config, adapter, { method: 'scale', desiredReplicas: 1 }),
    /SCALE_DOWN_DRAIN_UNVERIFIED/);
  adapter.setLag(0);
  assert.deepEqual(await dispatchBroker(config, adapter, { method: 'scale', desiredReplicas: 1 }),
    { accepted: true, previousReplicas: 2, desiredReplicas: 1 });
  assert.equal(adapter.scales, 2);
});

test('broker treats an unconfirmed Docker update as uncertain', async () => {
  const adapter = fixture();
  adapter.scale = async () => {};
  await assert.rejects(dispatchBroker(config, adapter, { method: 'scale', desiredReplicas: 2 }),
    /ACTUATOR_UNCONFIRMED/);
});

test('broker HTTP endpoint rejects missing token and all generic Docker API paths', async () => {
  const adapter = fixture();
  const audit = [];
  const server = createBrokerServer(config, adapter, token, { audit: event => audit.push(event) });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const url = `http://127.0.0.1:${server.address().port}`;
    const foreign = await fetch(`${url}/containers/create`, { method: 'POST',
      headers: { 'x-funnelmetry-broker-token': token } });
    assert.equal(foreign.status, 404);
    const unauthorized = await fetch(`${url}/v1/rpc`, { method: 'POST',
      body: JSON.stringify({ method: 'discover' }) });
    assert.equal(unauthorized.status, 403);
    const authorized = await fetch(`${url}/v1/rpc`, { method: 'POST',
      headers: { 'x-funnelmetry-broker-token': token }, body: JSON.stringify({ method: 'discover' }) });
    assert.equal(authorized.status, 200);
    assert.equal((await authorized.json()).value.service.replicas, 1);
    assert.deepEqual(audit.map(event => event.result), ['DENIED', 'DENIED', 'ACCEPTED']);
    assert.equal(JSON.stringify(audit).includes(token), false);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('controller client sends only bounded broker RPC, not Docker CLI commands', async () => {
  const calls = [];
  const transport = async (url, options) => {
    calls.push({ url: String(url), method: options.method, payload: JSON.parse(options.body) });
    return { ok: true, json: async () => ({ value: { service: 'observed' } }) };
  };
  const client = brokerClient(config, 'http://swarm-scale-broker:32130/', token, transport);
  assert.deepEqual(await client.discover(), { service: 'observed' });
  assert.deepEqual(calls, [{ url: 'http://swarm-scale-broker:32130/v1/rpc', method: 'POST',
    payload: { method: 'discover' } }]);
  assert.throws(() => client.forceUpdate(), /RECOVERY_ACTUATOR_NOT_ENABLED/);
  assert.throws(() => brokerClient(config, 'http://example.com:2375/', token), /Invalid private broker endpoint/);
});
