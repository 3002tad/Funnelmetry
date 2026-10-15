// Read-only, narrow broker-boundary check for the approved single-node demo.
// This is not a production Docker authorization or independent security audit.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const pinned = image => typeof image === 'string' && /@sha256:[a-f0-9]{64}$/.test(image);
const brokerSocketSources = new Set(['/var/run/docker.sock', '/run/host-services/docker.proxy.sock']);

async function dockerJson(args) {
  const { stdout } = await exec('docker', args, { timeout: 30000, maxBuffer: 128 * 1024,
    windowsHide: true });
  return JSON.parse(stdout);
}

export function evaluateLocalDemoBoundary(attestation, broker, controller, network,
  { brokerRunning, controllerRunning }) {
  const stack = attestation?.stack;
  if (attestation?.kind !== 'LOCAL_DOCKER_DESKTOP_DEMO' ||
    attestation?.riskAccepted !== true ||
    attestation?.negativeTestRef !== 'swarm-overlay-boundary-20261015' ||
    attestation?.targetService !== 'canonical-normalizer' ||
    !/^[a-z0-9][a-z0-9-]{5,80}$/.test(stack || '') ||
    !pinned(attestation.brokerImage) || !pinned(attestation.controllerImage)) return false;
  const brokerName = `${stack}_swarm-scale-broker`;
  const controllerName = `${stack}_swarm-scale-controller`;
  if (broker?.Spec?.Name !== brokerName || controller?.Spec?.Name !== controllerName ||
    broker?.Spec?.TaskTemplate?.ContainerSpec?.Image !== attestation.brokerImage ||
    controller?.Spec?.TaskTemplate?.ContainerSpec?.Image !== attestation.controllerImage ||
    broker.Spec.Mode?.Replicated?.Replicas !== 1 ||
    controller.Spec.Mode?.Replicated?.Replicas !== 0 ||
    brokerRunning !== '1/1' || controllerRunning !== '0/0') return false;
  const brokerTask = broker.Spec.TaskTemplate;
  const controllerTask = controller.Spec.TaskTemplate;
  const brokerContainer = brokerTask.ContainerSpec;
  const controllerContainer = controllerTask.ContainerSpec;
  const brokerMounts = brokerContainer.Mounts || [];
  const controllerMounts = controllerContainer.Mounts || [];
  const brokerNetwork = brokerTask.Networks || [];
  const controllerNetwork = controllerTask.Networks || [];
  return brokerContainer.ReadOnly === true && controllerContainer.ReadOnly === true &&
    (broker.Spec.EndpointSpec?.Ports || []).length === 0 &&
    (broker.Endpoint?.Ports || []).length === 0 &&
    (controller.Spec.EndpointSpec?.Ports || []).length === 0 &&
    (controller.Endpoint?.Ports || []).length === 0 &&
    brokerTask.Placement?.Constraints?.includes('node.role == manager') &&
    controllerTask.Placement?.Constraints?.includes('node.role == manager') &&
    brokerMounts.length === 1 && brokerMounts[0].Type === 'bind' &&
    brokerSocketSources.has(brokerMounts[0].Source) &&
    brokerMounts[0].Target === '/var/run/docker.sock' &&
    // A broad /var/run or root bind can expose the socket without naming it.
    // The controller gets exactly its persisted state volume and nothing else.
    controllerMounts.length === 1 && controllerMounts[0].Type === 'volume' &&
    controllerMounts[0].Target === '/state' &&
    brokerContainer.Secrets?.length === 1 && controllerContainer.Secrets?.length === 1 &&
    brokerContainer.Secrets[0].SecretID === controllerContainer.Secrets[0].SecretID &&
    brokerContainer.Configs?.length === 1 && controllerContainer.Configs?.length === 1 &&
    brokerContainer.Configs[0].ConfigID === controllerContainer.Configs[0].ConfigID &&
    controllerContainer.Env?.includes('SWARM_CONTROLLER_APPLY=off') &&
    brokerNetwork.length === 1 && controllerNetwork.length === 1 &&
    brokerNetwork[0].Target === controllerNetwork[0].Target &&
    network?.Id === brokerNetwork[0].Target && network.Driver === 'overlay' &&
    network.Internal === true && network.Attachable === false;
}

export async function inspectLocalDemoBoundary(attestation) {
  try {
    const brokerName = `${attestation.stack}_swarm-scale-broker`;
    const controllerName = `${attestation.stack}_swarm-scale-controller`;
    const broker = await dockerJson(['service', 'inspect', brokerName, '--format', '{{json .}}']);
    const controller = await dockerJson(['service', 'inspect', controllerName, '--format', '{{json .}}']);
    const networkId = broker?.Spec?.TaskTemplate?.Networks?.[0]?.Target;
    if (!networkId) return false;
    const network = await dockerJson(['network', 'inspect', networkId, '--format', '{{json .}}']);
    const { stdout } = await exec('docker', ['service', 'ls', '--format', '{{.Name}}|{{.Replicas}}'],
      { timeout: 30000, maxBuffer: 64 * 1024, windowsHide: true });
    const services = new Map(stdout.trim().split(/\r?\n/).map(line => line.split('|')));
    return evaluateLocalDemoBoundary(attestation, broker, controller, network,
      { brokerRunning: services.get(brokerName), controllerRunning: services.get(controllerName) });
  } catch { return false; }
}
