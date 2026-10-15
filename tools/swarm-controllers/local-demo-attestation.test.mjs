import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateLocalDemoBoundary } from './local-demo-attestation.mjs';

const sha = letter => `ghcr.io/example/${letter}@sha256:${letter.repeat(64)}`;
const stack = 'funnelmetry-scale-control-test';
const networkId = 'private-network';
const attestation = { kind: 'LOCAL_DOCKER_DESKTOP_DEMO', stack,
  targetService: 'canonical-normalizer', brokerImage: sha('a'),
  controllerImage: sha('b'), negativeTestRef: 'swarm-overlay-boundary-20261015',
  riskAccepted: true };
const secret = [{ SecretID: 'same-secret' }];
const configs = [{ ConfigID: 'same-config' }];
const task = (image, mounts) => ({
  ContainerSpec: { Image: image, ReadOnly: true, Mounts: mounts, Secrets: secret,
    Configs: configs, Env: ['SWARM_CONTROLLER_APPLY=off'] },
  Networks: [{ Target: networkId }], Placement: { Constraints: ['node.role == manager'] },
});
const broker = { Spec: { Name: `${stack}_swarm-scale-broker`,
  Mode: { Replicated: { Replicas: 1 } }, TaskTemplate: task(sha('a'),
    [{ Type: 'bind', Source: '/run/host-services/docker.proxy.sock', Target: '/var/run/docker.sock' }]) } };
const controller = { Spec: { Name: `${stack}_swarm-scale-controller`,
  Mode: { Replicated: { Replicas: 0 } }, TaskTemplate: task(sha('b'),
    [{ Type: 'volume', Source: 'controller-state', Target: '/state' }]) } };
const network = { Id: networkId, Driver: 'overlay', Internal: true, Attachable: false };
const running = { brokerRunning: '1/1', controllerRunning: '0/0' };

test('local demo boundary accepts only pinned isolated broker and socket-free disabled controller', () => {
  assert.equal(evaluateLocalDemoBoundary(attestation, broker, controller, network, running), true);
  const linuxBroker = structuredClone(broker);
  linuxBroker.Spec.TaskTemplate.ContainerSpec.Mounts[0].Source = '/var/run/docker.sock';
  assert.equal(evaluateLocalDemoBoundary(attestation, linuxBroker, controller, network, running), true);
  assert.equal(evaluateLocalDemoBoundary({ ...attestation, riskAccepted: false },
    broker, controller, network, running), false);
});

test('boundary fails closed on public port, socket in controller or non-internal network', () => {
  assert.equal(evaluateLocalDemoBoundary(attestation,
    { ...broker, Endpoint: { Ports: [{ PublishedPort: 32130 }] } }, controller, network, running), false);
  const socketController = structuredClone(controller);
  socketController.Spec.TaskTemplate.ContainerSpec.Mounts.push(
    { Type: 'bind', Source: '/var/run/docker.sock', Target: '/var/run/docker.sock' });
  assert.equal(evaluateLocalDemoBoundary(attestation, broker, socketController, network, running), false);
  const broadBindController = structuredClone(controller);
  broadBindController.Spec.TaskTemplate.ContainerSpec.Mounts.push(
    { Type: 'bind', Source: '/var/run', Target: '/host-run' });
  assert.equal(evaluateLocalDemoBoundary(attestation, broker, broadBindController, network, running), false);
  const wrongBrokerSocket = structuredClone(broker);
  wrongBrokerSocket.Spec.TaskTemplate.ContainerSpec.Mounts[0].Source = '/host';
  assert.equal(evaluateLocalDemoBoundary(attestation, wrongBrokerSocket, controller, network, running), false);
  assert.equal(evaluateLocalDemoBoundary(attestation, broker, controller,
    { ...network, Internal: false }, running), false);
  assert.equal(evaluateLocalDemoBoundary(attestation, broker, controller, network,
    { ...running, brokerRunning: '0/1' }), false);
});
