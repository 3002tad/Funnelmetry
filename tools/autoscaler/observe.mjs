import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const exec = promisify(execFile);
const decimal = value => typeof value === 'string' && /^(0|[1-9][0-9]{0,39})$/.test(value);

// Offset -1 is unknown, not zero. Only a complete, read_committed, control-only
// tail may be excluded from lag; an absent/partial tail remains conservative.
export function summarizeOffsets(ends, commits, tails = []) {
  const unknown = partitions => ({ lag: null, rawOffsetLag: null, partitions, controlOnlyPartitions: 0 });
  if (!Array.isArray(ends) || !ends.length || !Array.isArray(commits) || ends.length !== commits.length) return unknown(null);
  const seen = new Set();
  let lag = 0n, rawOffsetLag = 0n, controlOnlyPartitions = 0;
  for (const end of ends) {
    if (!Number.isSafeInteger(end.partition) || end.partition < 0 || seen.has(end.partition)) return unknown(null);
    seen.add(end.partition);
    const matched = commits.filter(p => p.partition === end.partition);
    if (matched.length !== 1 || !decimal(end.high) || !decimal(end.low) || !decimal(matched[0].offset)) return unknown(ends.length);
    const offset = BigInt(matched[0].offset), low = BigInt(end.low), high = BigInt(end.high);
    if (low > high || offset < low || offset > high) return unknown(ends.length);
    const delta = high - offset;
    rawOffsetLag += delta;
    const matchingTails = Array.isArray(tails) ? tails.filter(t => t.partition === end.partition) : [];
    const tail = matchingTails.length === 1 ? matchingTails[0] : null;
    const controlOnly = delta > 0n && delta <= 16n && tail?.errorCode === 0 &&
      tail.fetchOffset === offset.toString() && tail.highWatermark === high.toString() &&
      tail.lastStableOffset === high.toString() && Array.isArray(tail.messages) &&
      tail.messages.length === Number(delta) && tail.messages.every((message, index) =>
        message.control === true && message.offset === (offset + BigInt(index)).toString());
    if (controlOnly) controlOnlyPartitions++;
    else lag += delta;
  }
  return { lag: lag.toString(), rawOffsetLag: rawOffsetLag.toString(),
    partitions: ends.length, controlOnlyPartitions };
}

export function validateScope(scope) {
  if (!scope || !/^[a-z0-9][a-z0-9_-]+$/.test(scope.project || '') || scope.service !== 'canonical-normalizer' ||
      !/^[a-zA-Z0-9._-]+$/.test(scope.groupId || '') || !/^[a-zA-Z0-9._-]+$/.test(scope.topic || '')) throw Error('Invalid observation scope');
}

const INSPECT = '{"id":{{json .Id}},"project":{{json (index .Config.Labels "com.docker.compose.project")}},"service":{{json (index .Config.Labels "com.docker.compose.service")}},"oneoff":{{json (index .Config.Labels "com.docker.compose.oneoff")}},"running":{{.State.Running}},"paused":{{.State.Paused}},"restarting":{{.State.Restarting}},"startedAt":{{json .State.StartedAt}}}';
const IDENTITY = `import {loadConfig} from './src/config.js'; const c=loadConfig();
let ready=false;try{const r=await fetch('http://127.0.0.1:'+process.env.WORKER_HEALTH_PORT+'/readyz',{signal:AbortSignal.timeout(2000)});const b=await r.json();ready=r.ok&&b.worker==='canonical-normalizer'&&b.scope==='local_kafka_runtime_flag'&&b.ready===true}catch{}
console.log(JSON.stringify({instanceId:c.instanceId,clientId:c.clientId,groupId:c.consumerGroupId,topic:c.rawTopic,mode:process.env.CANONICAL_NORMALIZER_INSTANCE_ID_MODE||'explicit',ready}));`;
export const KAFKA_PROBE = `import {createRequire} from 'node:module';
const deadline=setTimeout(()=>process.exit(2),20000);deadline.unref();
const require=createRequire('/workspace/workers/source-connector/package.json');
const {Kafka,logLevel,AssignerProtocol}=require('kafkajs');
const topic=process.argv[1],groupId=process.argv[2];
const client=new Kafka({brokers:process.env.KAFKA_BOOTSTRAP_SERVERS.split(','),logLevel:logLevel.NOTHING,requestTimeout:5000,retry:{retries:2,initialRetryTime:100,maxRetryTime:1000}});
const admin=client.admin();
const fingerprint=g=>JSON.stringify({state:g.state,members:g.members.map(m=>({id:m.memberId,a:m.memberAssignment.toString('base64')})).sort((a,b)=>a.id.localeCompare(b.id))});
let phase='connect';
try{await admin.connect();phase='describe';const before=(await admin.describeGroups([groupId])).groups[0];
phase='offsets';const ends=await admin.fetchTopicOffsets(topic);const groups=await admin.fetchOffsets({groupId,topics:[topic]});
const commits=groups.find(t=>t.topic===topic)?.partitions||[];
let tails=[];
// KafkaJS 2.2.4 has no public read_committed random-access API. Its pinned
// Cluster/Broker Fetch API is read-only; unsupported versions retain raw lag.
try{if(require('kafkajs/package.json').version==='2.2.4'){
const factory=Object.getOwnPropertySymbols(client).find(s=>s.description==='private:Kafka:createCluster');
if(factory){const cluster=client[factory]({allowAutoTopicCreation:false,isolationLevel:1});
try{await cluster.connect();await cluster.addTargetTopic(topic);await cluster.refreshMetadataIfNecessary();
for(const end of ends){const commit=commits.find(p=>p.partition===end.partition);
if(!commit||!/^(0|[1-9][0-9]*)$/.test(commit.offset))continue;
const gap=BigInt(end.high)-BigInt(commit.offset);if(gap<1n||gap>16n)continue;
const leader=Object.keys(cluster.findLeaderForPartitions(topic,[end.partition]))[0];
const broker=await cluster.findBroker({nodeId:leader});
const response=await broker.fetch({replicaId:-1,isolationLevel:1,maxWaitTime:100,minBytes:1,maxBytes:1048576,
topics:[{topic,partitions:[{partition:end.partition,fetchOffset:commit.offset,maxBytes:1048576}]}]});
const part=response.responses.find(t=>t.topicName===topic)?.partitions.find(p=>p.partition===end.partition);
if(part)tails.push({partition:end.partition,fetchOffset:commit.offset,errorCode:part.errorCode,
highWatermark:part.highWatermark,lastStableOffset:part.lastStableOffset,
messages:part.messages.map(m=>({offset:m.offset,control:m.isControlRecord===true}))});
}}finally{await cluster.disconnect().catch(()=>{})}}}
}catch{tails=[]}
phase='assignments';
const after=(await admin.describeGroups([groupId])).groups[0];
const assignments=after.members.map(m=>AssignerProtocol.MemberAssignment.decode(m.memberAssignment).assignment[topic]||[]);
console.log(JSON.stringify({ends,commits,tails,memberCount:after.members.length,
stable:before.state==='Stable'&&after.state==='Stable'&&fingerprint(before)===fingerprint(after),assignments}));
}catch{console.log(JSON.stringify({probeFailure:phase}))}finally{await admin.disconnect().catch(()=>{});clearTimeout(deadline)}`;

export function dockerReader(scope, docker = 'docker') {
  validateScope(scope);
  const run = async args => {
    try { return (await exec(docker, args, { timeout: 25000, maxBuffer: 131072, windowsHide: true })).stdout.trim(); }
    catch { throw Error('OBSERVATION_COMMAND_FAILED'); }
  };
  const containerId = id => { if (!/^[a-f0-9]{64}$/.test(id)) throw Error('Invalid container ID'); return id; };
  return {
    async discover() {
      const ids = (await run(['ps', '-aq', '--no-trunc', '--filter', `label=com.docker.compose.project=${scope.project}`,
        '--filter', `label=com.docker.compose.service=${scope.service}`])).split(/\s+/).filter(Boolean);
      if (ids.length > 32) throw Error('Observation replica bound exceeded');
      return Promise.all(ids.map(async id => JSON.parse(await run(['inspect', '--format', INSPECT, containerId(id)]))));
    },
    async identity(id) { return JSON.parse(await run(['exec', containerId(id), 'node', '--input-type=module', '-e', IDENTITY])); },
    async kafka(id) { return JSON.parse(await run(['exec', containerId(id), 'node', '--input-type=module', '-e', KAFKA_PROBE, scope.topic, scope.groupId])); },
  };
}

const topology = targets => JSON.stringify(targets.map(t => ({ id: t.id, startedAt: t.startedAt,
  running: t.running, paused: t.paused, restarting: t.restarting, project: t.project, service: t.service, oneoff: t.oneoff })).sort((a,b) => a.id.localeCompare(b.id)));
export async function observe(scope, reader, clock = Date.now) {
  validateScope(scope);
  const began = clock();
  let phase = 'discovery';
  const snapshot = { ...scope, observedAt: began, lag: null, rawOffsetLag: null,
    controlOnlyPartitions: 0, partitions: null, replicas: null,
    memberCount: null, groupStable: false, ready: false, identityVerified: false,
    hostReplicaLimit: null, replayVerified: false, gracefulDownVerified: false, recoveryActive: null };
  const result = reason => ({ snapshot, reason, phase, scope: 'READ_ONLY_OBSERVATION', elapsedMs: clock() - began,
    unresolved: ['HOST_CAPACITY', 'REPLAY_RELEASE_ATTESTATION', 'GRACEFUL_DRAIN_ATTESTATION', 'WATCHDOG_COORDINATION'] });
  try {
    const targets = await reader.discover();
    if (!Array.isArray(targets) || !targets.length) return result('NO_TARGET');
    if (targets.length > 32 || targets.some(t => t.project !== scope.project || t.service !== scope.service ||
      t.oneoff !== 'False' || !/^[a-f0-9]{64}$/.test(t.id))) return result('TARGET_SCOPE_UNVERIFIED');
    snapshot.replicas = targets.length;
    if (targets.some(t => !t.running || t.paused || t.restarting)) return result('TARGET_NOT_RUNNING');
    phase = 'identity';
    const ids = await Promise.all(targets.map(t => reader.identity(t.id)));
    if (ids.some(c => c.groupId !== scope.groupId || c.topic !== scope.topic)) return result('RUNTIME_BINDING_MISMATCH');
    phase = 'kafka';
    const kafka = await reader.kafka(targets[0].id);
    if (['connect', 'describe', 'offsets', 'assignments'].includes(kafka.probeFailure)) {
      phase = `kafka-${kafka.probeFailure}`;
      return result('OBSERVATION_UNAVAILABLE');
    }
    phase = 'topology-recheck';
    if (topology(targets) !== topology(await reader.discover())) return result('TOPOLOGY_CHANGED');
    phase = 'offsets';
    const offsets = summarizeOffsets(kafka.ends, kafka.commits, kafka.tails);
    snapshot.lag = offsets.lag;
    snapshot.rawOffsetLag = offsets.rawOffsetLag;
    snapshot.controlOnlyPartitions = offsets.controlOnlyPartitions;
    snapshot.partitions = offsets.partitions;
    snapshot.memberCount = Number.isSafeInteger(kafka.memberCount) && kafka.memberCount >= 0 ? kafka.memberCount : null;
    const assigned = Array.isArray(kafka.assignments) ? kafka.assignments.flat() : [];
    const ends = Array.isArray(kafka.ends) ? kafka.ends.map(p => p.partition) : [];
    snapshot.groupStable = kafka.stable === true && snapshot.memberCount === targets.length &&
      Array.isArray(kafka.assignments) && kafka.assignments.length === snapshot.memberCount && kafka.assignments.every(Array.isArray) &&
      assigned.length === ends.length && new Set(assigned).size === ends.length && ends.every(p => assigned.includes(p));
    snapshot.ready = ids.every(c => c.ready === true);
    const transactionalIds = ids.map(c => `${c.clientId}-${c.instanceId}`);
    snapshot.identityVerified = ids.every(c => c.mode === 'container' && typeof c.instanceId === 'string' && typeof c.clientId === 'string') &&
      new Set(transactionalIds).size === targets.length;
    return result(offsets.lag === null ? 'OFFSETS_UNVERIFIED' : 'OBSERVED_NOT_AUTHORIZED_TO_SCALE');
  } catch { return result('OBSERVATION_UNAVAILABLE'); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [project, groupId = 'funnelmetry-canonical-normalizer-v1', topic = 'funnelmetry.raw.v1'] = process.argv.slice(2);
  try {
    const scope = { project, service: 'canonical-normalizer', groupId, topic };
    const report = await observe(scope, dockerReader(scope, process.env.WATCHDOG_DOCKER_EXE || 'docker'));
    console.log(JSON.stringify(report));
    if (report.reason !== 'OBSERVED_NOT_AUTHORIZED_TO_SCALE') process.exitCode = 2;
  } catch { console.error('Invalid observer configuration'); process.exitCode = 1; }
}
