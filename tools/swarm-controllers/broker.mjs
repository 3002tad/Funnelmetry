// Narrow manager-side RPC. Only this process may reach Docker; never expose its port.
import { createHash, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { collect, validateConfig } from './controller.mjs';
import { dockerClient, verifyService } from './docker.mjs';

const deny = reason => { throw Error(reason); };
const decimal = value => typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value);
const taskIds = targets => targets.map(target => target.taskId).sort().join(',');

export async function dispatchBroker(config, adapter, request) {
  validateConfig(config);
  if (!request || typeof request !== 'object' || Array.isArray(request)) deny('INVALID_REQUEST');
  const { method } = request;
  if (method === 'discover') return adapter.discover();
  if (method === 'inspectService') return adapter.inspectService();
  if (method === 'capacity') {
    const { service } = await adapter.discover();
    return adapter.capacity(service.reservation, service.replicas);
  }
  if (['health', 'identity', 'memory', 'kafka'].includes(method)) {
    const { targets } = await adapter.discover();
    const target = targets.find(item => item.id === request.targetId);
    if (!target || targets.filter(item => item.id === request.targetId).length !== 1) deny('TASK_SCOPE_UNVERIFIED');
    return adapter[method](target);
  }
  if (method !== 'scale') deny('METHOD_DENIED');
  const desired = request.desiredReplicas;
  if (!Number.isSafeInteger(desired) || desired < config.autoscale.minReplicas ||
    desired > config.autoscale.maxReplicas) deny('REPLICA_BOUND_DENIED');
  const observed = await collect(config, adapter);
  const s = observed.autoscale;
  const current = observed.service.replicas;
  if (!observed.stableTopology || s.ready !== true || s.groupStable !== true ||
    s.identityVerified !== true || s.replayVerified !== true ||
    s.memberCount !== current || observed.unavailable.length ||
    !Number.isSafeInteger(s.partitions) || desired > s.partitions ||
    !Number.isSafeInteger(s.hostReplicaLimit) || desired > s.hostReplicaLimit ||
    !decimal(s.lag)) deny('LIVE_SCALE_GUARD_UNVERIFIED');
  if (Math.abs(desired - current) !== 1) deny('ONE_STEP_SCALE_ONLY');
  if (desired > current) {
    const backlog = BigInt(s.lag);
    const lagUp = backlog >= BigInt(config.autoscale.upLag);
    const ramUp = Number.isFinite(s.memoryPercentMax) &&
      config.autoscale.upMemoryPercent !== undefined &&
      s.memoryPercentMax >= config.autoscale.upMemoryPercent &&
      backlog > BigInt(config.autoscale.downLag);
    if (!lagUp && !ramUp) deny('SCALE_UP_SIGNAL_UNVERIFIED');
  } else if (s.gracefulDownVerified !== true || s.lag !== '0' ||
    (config.autoscale.upMemoryPercent !== undefined &&
      (!Number.isFinite(s.memoryPercentMax) ||
        s.memoryPercentMax > config.autoscale.downMemoryPercent))) {
    deny('SCALE_DOWN_DRAIN_UNVERIFIED');
  }
  const after = await adapter.discover();
  if (after.service.id !== observed.service.id || after.service.version !== observed.service.version ||
    after.service.replicas !== current || taskIds(after.targets) !== taskIds(observed.targets)) {
    deny('TOPOLOGY_CHANGED');
  }
  await adapter.scale(desired);
  const updated = verifyService(config, await adapter.inspectService());
  if (updated.id !== observed.service.id || updated.version <= observed.service.version ||
    updated.replicas !== desired) deny('ACTUATOR_UNCONFIRMED');
  return { accepted: true, previousReplicas: current, desiredReplicas: desired };
}

function tokenMatches(expected, received) {
  if (typeof received !== 'string' || received.length > 512) return false;
  const left = createHash('sha256').update(expected).digest();
  const right = createHash('sha256').update(received).digest();
  return timingSafeEqual(left, right) && received.length === expected.length;
}

export function createBrokerServer(config, adapter, token, { audit = () => {} } = {}) {
  validateConfig(config);
  if (typeof token !== 'string' || token.length < 32 || /[\r\n]/.test(token)) throw Error('Invalid broker token');
  let active = false;
  return createServer(async (req, res) => {
    req.setTimeout(5000, () => req.destroy());
    const finish = (status, value) => {
      res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify(value));
    };
    if (req.method !== 'POST' || req.url !== '/v1/rpc') {
      audit({ method: 'HTTP_OUT_OF_SCOPE', result: 'DENIED' });
      return finish(404, { error: 'DENIED' });
    }
    if (!tokenMatches(token, req.headers['x-funnelmetry-broker-token'])) {
      audit({ method: 'UNAUTHENTICATED', result: 'DENIED' });
      return finish(403, { error: 'DENIED' });
    }
    if (active) {
      audit({ method: 'CONCURRENT', result: 'DENIED' });
      return finish(429, { error: 'BUSY' });
    }
    active = true;
    let method = 'UNKNOWN';
    try {
      let body = '';
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 4096) throw Error('REQUEST_TOO_LARGE');
      }
      const request = JSON.parse(body);
      method = typeof request?.method === 'string' ? request.method : 'UNKNOWN';
      const value = await dispatchBroker(config, adapter, request);
      audit({ method, result: 'ACCEPTED' });
      finish(200, { value });
    } catch {
      audit({ method, result: 'DENIED_OR_FAILED' });
      finish(403, { error: 'DENIED_OR_FAILED' });
    } finally { active = false; }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [configPath, tokenPath] = process.argv.slice(2);
    if (!configPath || !tokenPath || process.argv.length !== 4) throw Error('Expected config and secret paths');
    const config = JSON.parse(await readFile(configPath, 'utf8'));
    const token = (await readFile(tokenPath, 'utf8')).trim();
    const server = createBrokerServer(config, dockerClient(config), token, {
      audit: event => console.log(JSON.stringify({ at: new Date().toISOString(), ...event })),
    });
    server.listen(32130, '0.0.0.0');
  } catch {
    console.error('Swarm broker refused to start; config/socket/token unavailable.');
    process.exitCode = 1;
  }
}
