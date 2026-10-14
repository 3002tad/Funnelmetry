// Run only from the socket-free controller image on an isolated broker network.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';

const endpoint = 'http://swarm-scale-broker:32130';
const token = readFileSync('/run/secrets/broker_token', 'utf8').trim();
assert.equal(existsSync('/var/run/docker.sock'), false, 'controller must not see Docker socket');
assert.equal(process.env.PATH.split(delimiter).some(path => existsSync(join(path, 'docker'))), false,
  'controller image must not contain Docker CLI');

async function rpc(payload, authorized = true) {
  return fetch(`${endpoint}/v1/rpc`, { method: 'POST',
    headers: { 'content-type': 'application/json',
      ...(authorized ? { 'x-funnelmetry-broker-token': token } : {}) },
    body: JSON.stringify(payload), signal: AbortSignal.timeout(30000) });
}

const generic = await fetch(`${endpoint}/containers/create`, { method: 'POST',
  headers: { 'x-funnelmetry-broker-token': token } });
assert.equal(generic.status, 404);
assert.equal((await rpc({ method: 'discover' }, false)).status, 403);
assert.equal((await rpc({ method: 'forceUpdate' })).status, 403);
assert.equal((await rpc({ method: 'scale', desiredReplicas: 2 })).status, 403,
  'release without reviewed evidence must not scale live');
const observed = await rpc({ method: 'discover' });
assert.equal(observed.status, 200);
const value = (await observed.json()).value;
assert.equal(value?.service?.name, 'funnelmetry-live-20261014_canonical-normalizer');
console.log(JSON.stringify({ socketAbsent: true, dockerCliAbsent: true,
  genericApiDenied: true, noTokenDenied: true, recoveryDenied: true,
  unreviewedScaleDenied: true, allowlistedReadSucceeded: true }));
