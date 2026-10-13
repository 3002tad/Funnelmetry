// Application startup gate. A Swarm task running is not evidence that its DB
// schema, analytical releases or Kafka topics are ready.
import { createRequire } from 'node:module';

export const requiredTopics = Object.freeze([
  'raw', 'canonical', 'quarantine', 'canonical.persisted', 'journey.resolved',
  'funnel.updated', 'kpi.updated', 'ingress.receipts', 'canonicalization.outcomes',
].map(name => `funnelmetry.${name}.v1`));

export class SwarmSchemaMismatch extends Error {}

export async function inspectSwarmReadiness({ query, topics }, expectedDigest = '') {
  const { rows: [bootstrap] } = await query('SELECT status, schema_digest FROM handoff_bootstrap WHERE id=1');
  if (bootstrap?.status !== 'READY') return false;
  if (expectedDigest && bootstrap.schema_digest !== expectedDigest) {
    throw new SwarmSchemaMismatch('Swarm schema digest differs from the approved deployment manifest');
  }
  const { rows: [release] } = await query('SELECT completed_at FROM swarm_release_bootstrap WHERE id=1');
  if (!release?.completed_at) return false;
  const metadata = await topics(requiredTopics);
  return requiredTopics.every(name => metadata.topics.some(topic => topic.name === name && topic.partitions?.length > 0));
}

export async function waitForSwarmReadiness(env, inspect = inspectRuntimeOnce,
  delay = ms => new Promise(resolve => setTimeout(resolve, ms))) {
  const max = Number(env.SWARM_READY_MAX_ATTEMPTS || '60');
  if (!Number.isSafeInteger(max) || max < 1 || max > 300) throw Error('Invalid SWARM_READY_MAX_ATTEMPTS');
  for (let attempt = 1; attempt <= max; attempt++) {
    try { if (await inspect(env)) return; }
    catch (error) {
      if (error instanceof SwarmSchemaMismatch) throw error;
      if (attempt === max) throw Error('Swarm dependencies did not become ready');
    }
    if (attempt < max) await delay(Math.min(3000, 250 * 2 ** Math.min(attempt, 4)));
  }
  throw Error('Swarm dependencies did not become ready');
}

async function inspectRuntimeOnce(env) {
  const require = createRequire(env.SWARM_WAIT_ROLE === 'api'
    ? '/workspace/apps/dashboard-api/package.json'
    : '/workspace/workers/source-connector/package.json');
  const { Client } = require('pg');
  const { Kafka, logLevel } = require('kafkajs');
  const client = new Client({ host: 'postgres', port: 5432, user: 'funnelmetry',
    database: 'funnelmetry_handoff', password: env.POSTGRES_PASSWORD, connectionTimeoutMillis: 3000 });
  let connected = false;
  try {
    await client.connect(); connected = true;
    const kafka = new Kafka({ clientId: 'funnelmetry-swarm-readiness', brokers: ['kafka:9092'],
      logLevel: logLevel.ERROR, connectionTimeout: 3000, requestTimeout: 5000,
      retry: { retries: 1 } });
    const admin = kafka.admin();
    return await inspectSwarmReadiness({ query: sql => client.query(sql), topics: async names => {
      try { await admin.connect(); return await admin.fetchTopicMetadata({ topics: names }); }
      finally { await admin.disconnect().catch(() => {}); }
    } }, env.SWARM_EXPECTED_SCHEMA_DIGEST || '');
  } finally { if (connected) await client.end().catch(() => {}); }
}
