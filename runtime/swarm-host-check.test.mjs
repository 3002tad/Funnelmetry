import assert from 'node:assert/strict';
import test from 'node:test';
import { checkSingleNodeHost } from './swarm-host-check.mjs';

function fixture(overrides = {}) {
  const values = {
    info: 'active|true', os: 'linux', nodes: 'node-1', stateful: 'true', edge: 'true', ...overrides,
  };
  const calls = [];
  const docker = async args => {
    calls.push(args);
    if (args[0] === 'info') return args[2].includes('OSType') ? values.os : values.info;
    if (args[1] === 'ls') return values.nodes;
    return args[4].includes('stateful') ? values.stateful : values.edge;
  };
  return { docker, calls };
}

test('accepts one Linux manager with stateful and edge labels using read-only commands', async () => {
  const { docker, calls } = fixture();
  assert.deepEqual(await checkSingleNodeHost(docker, {}), { nodeCount: 1, dockerOs: 'linux' });
  assert.deepEqual(calls.map(args => args.slice(0, 2)), [
    ['info', '--format'], ['info', '--format'], ['node', 'ls'], ['node', 'inspect'], ['node', 'inspect'],
  ]);
});

test('rejects inactive Swarm, Windows engine, multi-node cluster and missing labels', async () => {
  for (const [values, message] of [
    [{ info: 'inactive|false' }, /active Swarm manager/],
    [{ os: 'windows' }, /Linux Docker engine/],
    [{ nodes: 'node-1\nnode-2' }, /exactly one Swarm node/],
    [{ stateful: '<no value>' }, /funnelmetry.stateful=true/],
    [{ edge: '<no value>' }, /funnelmetry.edge=true/],
  ]) await assert.rejects(checkSingleNodeHost(fixture(values).docker, {}), message);
});
