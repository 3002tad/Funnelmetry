// Execute through stdin inside a disposable fixture worker container only.
// Synthetic Raw Kafka records bypass Source Connector and must never use live topics.
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const require = createRequire('/workspace/workers/canonical-normalizer/package.json');
const { Kafka, logLevel } = require('kafkajs');
const [command, countArg, runId, startArg] = process.argv.slice(2);
const count = Number(countArg);
const startIndex = startArg === undefined ? 0 : Number(startArg);
if (!['produce', 'verify'].includes(command) || !Number.isSafeInteger(count) ||
  count < 1 || count > 10000 || !/^[a-z0-9-]{8,48}$/.test(runId || '') ||
  !Number.isSafeInteger(startIndex) || startIndex < 0 || startIndex + count > 10000 ||
  (command === 'verify' && startArg !== undefined) ||
  process.env.SWARM_SCALE_FIXTURE_ACK !== 'OFFLINE_DEMO_SYNTHETIC' ||
  process.env.KAFKA_TOPIC_RAW !== 'swarm.scale.raw.v1') {
  throw Error('Disposable Swarm scale fixture and explicit synthetic acknowledgement required');
}

const topics = {
  raw: 'swarm.scale.raw.v1', canonical: 'swarm.scale.canonical.v1',
  outcomes: 'swarm.scale.outcomes.v1', quarantine: 'swarm.scale.quarantine.v1',
};
const kafka = new Kafka({ brokers: ['kafka:9092'], clientId: `scale-smoke-${runId}`,
  logLevel: logLevel.ERROR });
const eventId = index => `browser:${runId}:${index}`;
const sumHigh = rows => rows.reduce((total, row) => total + BigInt(row.high), 0n);

if (command === 'produce') {
  const producer = kafka.producer({ idempotent: true, maxInFlightRequests: 1 });
  await producer.connect();
  try {
    for (let start = startIndex; start < startIndex + count; start += 100) {
      const messages = [];
      for (let index = start; index < Math.min(start + 100, startIndex + count); index++) {
        const now = new Date().toISOString();
        const event = {
          specversion: 'ingress-event.v1', source_id: 'medusa-reference',
          event_id: eventId(index), source_event_type: 'behavior.product_viewed',
          source_schema_version: '2.0', producer: 'browser_sdk', occurred_at: now,
          anonymous_id: `anonymous:${runId}`, session_id: `session:${runId}`,
          source_payload: { product_id: 'prod_scale_fixture',
            page_instance_id: `page:${runId}:${index}` },
        };
        messages.push({ key: JSON.stringify([event.source_id, event.event_id]),
          value: JSON.stringify({ ingestion_id: `scale-${runId}-${index}`, received_at: now,
            raw_body: JSON.stringify(event) }) });
      }
      await producer.send({ topic: topics.raw, acks: -1, messages });
    }
    console.log(JSON.stringify({ result: 'RAW_PUBLISHED', runId, count, startIndex }));
  } finally { await producer.disconnect(); }
} else {
  const admin = kafka.admin();
  await admin.connect();
  let consumer;
  try {
    const ends = Object.fromEntries(await Promise.all(Object.entries(topics).map(async ([name, topic]) =>
      [name, await admin.fetchTopicOffsets(topic)])));
    const commits = await admin.fetchOffsets({ groupId: 'swarm-scale-normalizer-v1', topics: [topics.raw] });
    const rawCommitted = commits.find(row => row.topic === topics.raw)?.partitions || [];
    const committed = rawCommitted.length === ends.raw.length && ends.raw.every(end =>
      rawCommitted.some(row => row.partition === end.partition && row.offset === end.high));
    const totals = Object.fromEntries(Object.entries(ends).map(([name, rows]) => [name, String(sumHigh(rows))]));
    // Transactional output topics include control-marker offsets. Their log-end
    // offsets are not record counts; count only read_committed messages below.
    if (!committed || totals.raw !== String(count) || totals.quarantine !== '0') {
      throw Error(`Offset/count mismatch: ${JSON.stringify({ committed, totals })}`);
    }

    // Each verification must start at the beginning; reusing a group resumes
    // committed offsets and can silently miss already-verified records.
    consumer = kafka.consumer({ groupId: `scale-verify-${runId}-${randomUUID()}`, readUncommitted: false });
    await consumer.connect();
    await consumer.subscribe({ topics: [topics.canonical, topics.outcomes], fromBeginning: true });
    const seen = { canonical: new Set(), outcomes: new Set() };
    const received = { canonical: 0, outcomes: 0 };
    let violation = null;
    let finish, fail;
    const complete = new Promise((resolve, reject) => { finish = resolve; fail = reject; });
    const timer = setTimeout(() => fail(Error('Timed out verifying canonical/outcome identities')), 45000);
    try {
      await consumer.run({ eachMessage: async ({ topic, message }) => {
        const kind = topic === topics.canonical ? 'canonical' : 'outcomes';
        const value = JSON.parse(message.value.toString('utf8'));
        const id = value.source_event_id;
        if (!id?.startsWith(`browser:${runId}:`) || seen[kind].has(id)) {
          violation = `Missing scope or duplicate ${kind} identity`;
          fail(Error(violation));
          return;
        }
        seen[kind].add(id);
        received[kind]++;
        if (received.canonical === count && received.outcomes === count) finish();
      } });
      await complete;
      await new Promise(resolve => setTimeout(resolve, 2000));
    } finally { clearTimeout(timer); }
    if (violation || received.canonical !== count || received.outcomes !== count ||
      seen.canonical.size !== count || seen.outcomes.size !== count ||
      [...seen.canonical].some(id => !seen.outcomes.has(id))) {
      throw Error(violation || 'Canonical/outcome identity sets differ');
    }
    console.log(JSON.stringify({ result: 'PASS', runId, count, totals, committed,
      uniqueCanonical: seen.canonical.size, uniqueOutcomes: seen.outcomes.size }));
  } finally {
    await consumer?.stop().catch(() => {});
    await consumer?.disconnect().catch(() => {});
    await admin.disconnect();
  }
}
