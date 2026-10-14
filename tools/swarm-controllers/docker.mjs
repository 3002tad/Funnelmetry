import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { KAFKA_PROBE, summarizeOffsets } from '../autoscaler/observe.mjs';

const exec = promisify(execFile);
const SERVICE = /^[a-z0-9][a-z0-9_-]+$/;
const KAFKA_NAME = /^[a-zA-Z0-9][a-zA-Z0-9._-]+$/;
const DIGEST = /@sha256:[a-f0-9]{64}$/;
// Docker format templates intentionally omit Env, SecretRefs, mounts and health logs.
// A freshly deployed service may have no UpdateStatus yet. Keep the projection
// narrow so Docker inspect never emits environment values or secret references.
export const SERVICE_VIEW = '{"ID":{{json .ID}},"Version":{{json .Version}},"Spec":{"Name":{{json .Spec.Name}},"Labels":{{json .Spec.Labels}},"Mode":{{json .Spec.Mode}},"TaskTemplate":{"ContainerSpec":{"Image":{{json .Spec.TaskTemplate.ContainerSpec.Image}}},"Resources":{"Reservations":{{json .Spec.TaskTemplate.Resources.Reservations}}}}},"UpdateStatus":{{with .UpdateStatus}}{{json .}}{{else}}null{{end}}}';
const CONTAINER_VIEW = '{"Id":{{json .Id}},"Config":{"Labels":{{json .Config.Labels}}},"State":{"Running":{{.State.Running}},"Paused":{{.State.Paused}},"Restarting":{{.State.Restarting}},"StartedAt":{{json .State.StartedAt}}}}';
const NODE_VIEW = '{"Status":{"State":{{json .Status.State}}},"Spec":{"Availability":{{json .Spec.Availability}}},"Description":{"Resources":{{json .Description.Resources}}}}';
const RESERVATION_VIEW = '{"Spec":{"Mode":{{json .Spec.Mode}},"TaskTemplate":{"Resources":{"Reservations":{{json .Spec.TaskTemplate.Resources.Reservations}}}}}}';
const HEALTH = `const http=require('node:http');
const worker=process.argv[1];
async function probe(path){return new Promise(resolve=>{
 const req=http.get({host:'127.0.0.1',port:32110,path,timeout:2500},r=>{
  let body='';r.on('data',c=>{body+=c;if(body.length>4096)req.destroy()});
  r.on('end',()=>{try{const b=JSON.parse(body);resolve({ok:r.statusCode===200&&b.worker===worker&&b.scope==='local_kafka_runtime_flag',ready:b.ready===true})}catch{resolve({ok:false})}})
 });req.on('timeout',()=>req.destroy());req.on('error',()=>resolve({ok:false}));
})}
(async()=>{const live=await probe('/healthz');const ready=live.ok?await probe('/readyz'):{ready:false};
 console.log(JSON.stringify({liveness:live.ok?'alive':'unknown',readiness:ready.ready===true}));})()`;
const IDENTITY = `import {loadConfig} from '/workspace/workers/canonical-normalizer/src/config.js';const c=loadConfig();
console.log(JSON.stringify({instanceId:c.instanceId,clientId:c.clientId,groupId:c.consumerGroupId,topic:c.rawTopic,
 mode:process.env.CANONICAL_NORMALIZER_INSTANCE_ID_MODE||'explicit'}))`;

export function validateScope(scope) {
  if (!scope || !SERVICE.test(scope.stack || '') || !SERVICE.test(scope.service || '') ||
    !DIGEST.test(scope.image || '') || !KAFKA_NAME.test(scope.groupId || '') || !KAFKA_NAME.test(scope.topic || '')) {
    throw Error('Explicit stack/service/image/group/topic required');
  }
}

export function verifyService(scope, service) {
  validateScope(scope);
  const name = `${scope.stack}_${scope.service}`;
  if (service?.Spec?.Name !== name || service.Spec.Labels?.['com.docker.stack.namespace'] !== scope.stack ||
    service.Spec.TaskTemplate?.ContainerSpec?.Image !== scope.image ||
    !Number.isSafeInteger(service.Spec.Mode?.Replicated?.Replicas) ||
    service.Spec.Mode.Replicated.Replicas < 1 || service.UpdateStatus?.State === 'updating' ||
    service.UpdateStatus?.State === 'rollback_started') throw Error('SERVICE_SCOPE_OR_UPDATE_UNVERIFIED');
  return { id: service.ID, name, version: service.Version.Index,
    replicas: service.Spec.Mode.Replicated.Replicas,
    reservation: service.Spec.TaskTemplate.Resources?.Reservations || {} };
}

export function parseMemoryPercent(value) {
  if (typeof value !== 'string' || !/^(?:100(?:\.0+)?|[0-9]{1,2}(?:\.[0-9]{1,4})?)%$/.test(value.trim())) {
    return null;
  }
  const percent = Number(value.trim().slice(0, -1));
  return Number.isFinite(percent) && percent >= 0 && percent <= 100 ? percent : null;
}

export function dockerClient(scope, executable = 'docker') {
  validateScope(scope);
  const run = async args => {
    try {
      return (await exec(executable, args, { timeout: 30000, maxBuffer: 1024 * 1024,
        windowsHide: true })).stdout.trim();
    } catch { throw Error('DOCKER_COMMAND_FAILED'); }
  };
  const json = async args => JSON.parse(await run(args));
  const serviceName = `${scope.stack}_${scope.service}`;
  return {
    async inspectService() { return json(['service', 'inspect', serviceName, '--format', SERVICE_VIEW]); },
    async discover() {
      const service = verifyService(scope, await this.inspectService());
      const names = (await run(['ps', '--filter', `label=com.docker.swarm.service.name=${serviceName}`,
        '--format', '{{.ID}}'])).split(/\s+/).filter(Boolean);
      if (names.length > 32) throw Error('REPLICA_BOUND_EXCEEDED');
      const containers = await Promise.all(names.map(id => json(['inspect', id, '--format', CONTAINER_VIEW])));
      const targets = containers.map(c => ({ id: c.Id, taskId: c.Config?.Labels?.['com.docker.swarm.task.id'],
        service: c.Config?.Labels?.['com.docker.swarm.service.name'],
        running: c.State?.Running === true && !c.State?.Paused && !c.State?.Restarting,
        startedAt: Date.parse(c.State?.StartedAt) }));
      if (targets.some(t => t.service !== serviceName || !/^[a-f0-9]{64}$/.test(t.id) ||
        !/^[a-z0-9]{20,}$/.test(t.taskId || ''))) throw Error('TASK_SCOPE_UNVERIFIED');
      return { service, targets };
    },
    async health(target) {
      if (!/^[a-f0-9]{64}$/.test(target.id)) throw Error('Invalid container ID');
      try { return await json(['exec', target.id, 'node', '-e', HEALTH, scope.service]); }
      catch { return { liveness: 'unknown', readiness: false }; }
    },
    async identity(target) {
      return json(['exec', target.id, 'node', '--input-type=module', '-e', IDENTITY]);
    },
    async memory(target) {
      if (!/^[a-f0-9]{64}$/.test(target.id)) throw Error('Invalid container ID');
      const value = parseMemoryPercent(await run(['stats', '--no-stream', '--format', '{{.MemPerc}}', target.id]));
      if (value === null) throw Error('MEMORY_PROBE_UNAVAILABLE');
      return value;
    },
    async kafka(target) {
      return json(['exec', target.id, 'node', '--input-type=module', '-e', KAFKA_PROBE,
        scope.topic, scope.groupId]);
    },
    async capacity(reservation, currentReplicas) {
      // Conservative single-node guard. Multi-node placement is deliberately unsupported.
      const nodes = (await run(['node', 'ls', '--format', '{{.ID}}'])).split(/\s+/).filter(Boolean);
      if (nodes.length !== 1) return null;
      const node = await json(['node', 'inspect', 'self', '--format', NODE_VIEW]);
      if (node.Status?.State !== 'ready' || node.Spec?.Availability !== 'active') return null;
      const serviceIds = (await run(['service', 'ls', '-q'])).split(/\s+/).filter(Boolean);
      const services = await Promise.all(serviceIds.map(id => json(['service', 'inspect', id, '--format', RESERVATION_VIEW])));
      let usedCpu = 0, usedMem = 0;
      for (const item of services) {
        const replicas = item.Spec?.Mode?.Replicated?.Replicas;
        if (!Number.isSafeInteger(replicas) || replicas < 0) return null;
        usedCpu += replicas * (item.Spec.TaskTemplate?.Resources?.Reservations?.NanoCPUs || 0);
        usedMem += replicas * (item.Spec.TaskTemplate?.Resources?.Reservations?.MemoryBytes || 0);
      }
      const cpu = reservation.NanoCPUs, mem = reservation.MemoryBytes;
      if (!Number.isSafeInteger(cpu) || cpu < 1 || !Number.isSafeInteger(mem) || mem < 1) return null;
      // Headroom is explicit in controller config, supplied by caller, not guessed here.
      return { nodeCpu: node.Description?.Resources?.NanoCPUs,
        nodeMem: node.Description?.Resources?.MemoryBytes, usedCpu, usedMem,
        cpuPerReplica: cpu, memPerReplica: mem, currentReplicas };
    },
    async forceUpdate() { await run(['service', 'update', '--force', '--detach=true', serviceName]); },
    async scale(replicas) {
      if (!Number.isSafeInteger(replicas) || replicas < 1 || replicas > 32) throw Error('Invalid replicas');
      await run(['service', 'scale', `${serviceName}=${replicas}`]);
    },
  };
}

export function capacityLimit(capacity, cpuHeadroom, memoryHeadroom) {
  if (!capacity || !Number.isSafeInteger(cpuHeadroom) || cpuHeadroom < 0 ||
    !Number.isSafeInteger(memoryHeadroom) || memoryHeadroom < 0 ||
    !Number.isSafeInteger(capacity.nodeCpu) || !Number.isSafeInteger(capacity.nodeMem)) return null;
  const freeCpu = capacity.nodeCpu - capacity.usedCpu - cpuHeadroom;
  const freeMem = capacity.nodeMem - capacity.usedMem - memoryHeadroom;
  return Math.max(0, capacity.currentReplicas + Math.min(Math.floor(freeCpu / capacity.cpuPerReplica),
    Math.floor(freeMem / capacity.memPerReplica)));
}

export function kafkaSummary(probe) {
  if (probe?.probeFailure || !Array.isArray(probe?.assignments)) return null;
  const offsets = summarizeOffsets(probe.ends, probe.commits, probe.tails);
  const assigned = probe.assignments.flat();
  const partitions = probe.ends?.map(p => p.partition) || [];
  return { ...offsets, memberCount: probe.memberCount,
    stable: probe.stable === true && assigned.length === partitions.length &&
      new Set(assigned).size === partitions.length && partitions.every(p => assigned.includes(p)) };
}
