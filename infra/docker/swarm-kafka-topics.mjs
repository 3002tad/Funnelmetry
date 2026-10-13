// Isolated Swarm topic bootstrap. Never repartitions existing topics.
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

export function topicSpecs(rawPartitions) {
  const raw = Number(rawPartitions);
  if (!Number.isSafeInteger(raw) || raw < 1 || raw > 64) throw Error('Invalid HANDOFF_RAW_PARTITIONS');
  const topic = (name, numPartitions, cleanup) => ({ topic: `funnelmetry.${name}.v1`,
    numPartitions, replicationFactor: 1, configEntries: [{ name: 'cleanup.policy', value: cleanup }] });
  return [topic('raw', raw, 'delete'),
    ...['canonical', 'quarantine', 'canonical.persisted', 'journey.resolved',
      'funnel.updated', 'kpi.updated'].map(name => topic(name, 1, 'delete')),
    ...['ingress.receipts', 'canonicalization.outcomes'].map(name => topic(name, 1, 'compact'))];
}

async function verifyTopics(admin, specs) {
  const metadata = await admin.fetchTopicMetadata({ topics: specs.map(spec => spec.topic) });
  const config = await admin.describeConfigs({ resources: specs.map(spec => ({ type: 2, name: spec.topic,
    configNames: ['cleanup.policy'] })), includeSynonyms: false });
  for (const spec of specs) {
    const topic = metadata.topics.find(item => item.name === spec.topic);
    const partitions = topic?.partitions;
    if (partitions?.length !== spec.numPartitions || partitions.some(item => item.replicas?.length !== spec.replicationFactor)) {
      throw Error(`Existing topic layout mismatch: ${spec.topic}; operator review required`);
    }
    const resource = config.resources.find(item => item.resourceName === spec.topic);
    const policy = resource?.configEntries.find(item => item.configName === 'cleanup.policy')?.configValue;
    if (resource?.errorCode !== 0 || policy !== spec.configEntries[0].value) {
      throw Error(`Existing topic cleanup policy mismatch: ${spec.topic}; operator review required`);
    }
  }
}

export async function ensureTopics(admin, specs) {
  const existing = new Set(await admin.listTopics());
  // Verify the whole existing set before writing anything.
  const present = specs.filter(spec => existing.has(spec.topic));
  if (present.length) await verifyTopics(admin, present);
  const missing = specs.filter(spec => !existing.has(spec.topic));
  if (missing.length) await admin.createTopics({ topics: missing, waitForLeaders: true });
  await verifyTopics(admin, specs);
}

async function main() {
  if (!['OFFLINE_DEMO', 'PARALLEL_LIVE'].includes(process.env.HANDOFF_MODE)) throw Error('Unsupported Swarm mode');
  const require = createRequire('/workspace/workers/source-connector/package.json');
  const { Kafka, logLevel } = require('kafkajs');
  const kafka = new Kafka({ clientId: 'funnelmetry-swarm-topics',
    brokers: ['kafka:9092'], logLevel: logLevel.ERROR,
    connectionTimeout: 3000, requestTimeout: 5000, retry: { retries: 3 } });
  const specs = topicSpecs(process.env.HANDOFF_RAW_PARTITIONS || '1');
  for (let attempt = 1; attempt <= 30; attempt++) {
    const admin = kafka.admin();
    try {
      await admin.connect();
      await ensureTopics(admin, specs);
      console.log('PASS: isolated Swarm topics ready; existing partition counts preserved');
      return;
    } catch (error) {
      if (/mismatch|Invalid/.test(error.message) || attempt === 30) throw error;
      await new Promise(resolve => setTimeout(resolve, 2000));
    } finally { await admin.disconnect().catch(() => {}); }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { await main(); }
  catch { console.error('Swarm Kafka topic initialization failed; inspect isolated broker. No repartition performed.'); process.exitCode = 1; }
}
