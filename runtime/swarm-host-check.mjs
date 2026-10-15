// Read-only host checks for an independent, single-node Swarm installation.
// This does not initialize Swarm, label nodes, pull images or inspect secrets.
export async function checkSingleNodeHost(docker, env) {
  const state = await docker(['info', '--format', '{{.Swarm.LocalNodeState}}|{{.Swarm.ControlAvailable}}'], env);
  if (state !== 'active|true') throw Error('Docker must be an active Swarm manager on this machine');

  const os = await docker(['info', '--format', '{{.OSType}}'], env);
  if (os !== 'linux') throw Error('Use the Linux Docker engine (Docker Desktop: Linux containers)');

  const nodes = (await docker(['node', 'ls', '--format', '{{.ID}}'], env)).split(/\s+/).filter(Boolean);
  if (nodes.length !== 1) throw Error(`Independent single-node deployment requires exactly one Swarm node; found ${nodes.length}`);

  for (const label of ['stateful', 'edge']) {
    const value = await docker(['node', 'inspect', 'self', '--format', `{{index .Spec.Labels "funnelmetry.${label}"}}`], env);
    if (value !== 'true') throw Error(`Label this node funnelmetry.${label}=true after reviewing local storage and HTTPS ports`);
  }
  return { nodeCount: 1, dockerOs: os };
}
