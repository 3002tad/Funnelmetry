// Read-only diagnostic for KafkaJS 2.2.4. Run through stdin inside a Worker
// container; never joins or commits to the target consumer group.
import { createRequire } from 'node:module';

const require = createRequire('/workspace/workers/source-connector/package.json');
const { Kafka, logLevel } = require('kafkajs');
const { version } = require('kafkajs/package.json');
if (version !== '2.2.4') throw Error('Unsupported KafkaJS version');
const [topic, groupId] = process.argv.slice(2);
if (!/^[a-zA-Z0-9._-]+$/.test(topic || '') || !/^[a-zA-Z0-9._-]+$/.test(groupId || '')) throw Error('Invalid topic/group');
const client = new Kafka({ brokers: process.env.KAFKA_BOOTSTRAP_SERVERS.split(','),
  logLevel: logLevel.NOTHING, requestTimeout: 5000, retry: { retries: 1 } });
const admin = client.admin();
const clusterFactory = Object.getOwnPropertySymbols(client)
  .find(symbol => symbol.description === 'private:Kafka:createCluster');
if (!clusterFactory) throw Error('KafkaJS cluster API unavailable');
const cluster = client[clusterFactory]({ allowAutoTopicCreation: false, isolationLevel: 1 });
try {
  await admin.connect();
  await cluster.connect();
  const ends = await admin.fetchTopicOffsets(topic);
  const commits = (await admin.fetchOffsets({ groupId, topics: [topic] }))
    .find(item => item.topic === topic)?.partitions || [];
  await cluster.addTargetTopic(topic);
  await cluster.refreshMetadataIfNecessary();
  const rows = [];
  for (const end of ends) {
    const commit = commits.find(item => item.partition === end.partition);
    const leaders = cluster.findLeaderForPartitions(topic, [end.partition]);
    const [leader] = Object.keys(leaders);
    const broker = await cluster.findBroker({ nodeId: leader });
    const result = await broker.fetch({ replicaId: -1, isolationLevel: 1,
      maxWaitTime: 100, minBytes: 1, maxBytes: 1048576,
      topics: [{ topic, partitions: [{ partition: end.partition,
        fetchOffset: commit.offset, maxBytes: 1048576 }] }] });
    const partition = result.responses.find(item => item.topicName === topic)
      ?.partitions.find(item => item.partition === end.partition);
    rows.push({ partition: end.partition, committed: commit.offset, high: end.high,
      errorCode: partition?.errorCode, highWatermark: partition?.highWatermark,
      lastStableOffset: partition?.lastStableOffset,
      messages: partition?.messages.map(message => ({ offset: message.offset,
        control: message.isControlRecord, transactional: message.batchContext?.inTransaction })) });
  }
  console.log(JSON.stringify(rows));
} finally {
  await cluster.disconnect().catch(() => {});
  await admin.disconnect().catch(() => {});
}
