// Controller-side adapter. This module has no Docker socket/CLI dependency.
import { validateConfig } from './controller.mjs';

export function brokerClient(config, endpoint, token, transport = fetch) {
  validateConfig(config);
  const url = new URL(endpoint);
  if (url.protocol !== 'http:' || url.hostname !== 'swarm-scale-broker' ||
    url.port !== '32130' || url.username || url.password || url.pathname !== '/' ||
    url.search || url.hash) throw Error('Invalid private broker endpoint');
  if (typeof token !== 'string' || token.length < 32 || /[\r\n]/.test(token)) throw Error('Invalid broker token');
  const rpc = async payload => {
    const response = await transport(new URL('/v1/rpc', url), {
      method: 'POST', headers: { 'content-type': 'application/json',
        'x-funnelmetry-broker-token': token }, body: JSON.stringify(payload),
      signal: AbortSignal.timeout(90000),
    });
    if (!response.ok) throw Error('BROKER_REQUEST_DENIED_OR_FAILED');
    return (await response.json()).value;
  };
  return {
    discover: () => rpc({ method: 'discover' }),
    inspectService: () => rpc({ method: 'inspectService' }),
    health: target => rpc({ method: 'health', targetId: target.id }),
    identity: target => rpc({ method: 'identity', targetId: target.id }),
    memory: target => rpc({ method: 'memory', targetId: target.id }),
    kafka: target => rpc({ method: 'kafka', targetId: target.id }),
    capacity: () => rpc({ method: 'capacity' }),
    scale: desiredReplicas => rpc({ method: 'scale', desiredReplicas }),
    forceUpdate: () => { throw Error('RECOVERY_ACTUATOR_NOT_ENABLED'); },
  };
}
