import { Kafka, logLevel, Partitioners } from "kafkajs"
import { validateFunnelUpdatedEnvelope } from "./contract.js"

export function createKafkaKpiRuntime({
  brokers, clientId, consumerGroupId, instanceId, funnelUpdatedTopic, kpiUpdatedTopic,
  transactionTimeoutMs = 30_000, repository, kafka,
  onError = (error) => console.error("kpi-projector Kafka runtime error", error),
} = {}) {
  if (!brokers?.length || !clientId || !consumerGroupId || !instanceId || !funnelUpdatedTopic || !kpiUpdatedTopic) {
    throw new Error("Complete kpi-projector Kafka configuration is required")
  }
  if (!repository || typeof repository.project !== "function") throw new Error("A KPI repository is required")
  const client = kafka ?? new Kafka({ brokers, clientId, logLevel: logLevel.WARN })
  const producer = client.producer({
    idempotent: true, maxInFlightRequests: 1,
    transactionalId: `${clientId}-${instanceId}`,
    transactionTimeout: transactionTimeoutMs,
    createPartitioner: Partitioners.DefaultPartitioner,
  })
  const consumer = client.consumer({ groupId: consumerGroupId, readUncommitted: false })
  let started = false
  let healthy = false
  let runPromise

  async function processMessage({ topic, partition, message }) {
    if (message.value === null) throw new Error("funnel updated topic must not contain tombstones")
    const kafkaKey = JSON.parse(message.key?.toString("utf8") ?? "null")
    const projectionInput = validateFunnelUpdatedEnvelope(JSON.parse(message.value.toString("utf8")), kafkaKey)
    const projection = await repository.project(projectionInput)
    const { status: projectionStatus, ...kpiProjection } = projection
    const transaction = await producer.transaction()
    try {
      await transaction.send({
        topic: kpiUpdatedTopic,
        messages: [{
          key: message.key,
          value: JSON.stringify({ status: "kpi_updated", projection_status: projectionStatus, ...kpiProjection }),
        }],
      })
      await transaction.sendOffsets({
        consumerGroupId,
        topics: [{ topic, partitions: [{ partition, offset: String(BigInt(message.offset) + 1n) }] }],
      })
      await transaction.commit()
    } catch (error) {
      await transaction.abort().catch(() => {})
      throw error
    }
  }

  const markFailed = (error) => { healthy = false; onError(error) }
  if (consumer.events?.CRASH && typeof consumer.on === "function") {
    consumer.on(consumer.events.CRASH, ({ payload }) => markFailed(payload?.error ?? new Error("KPI consumer crashed")))
  }
  return Object.freeze({
    isHealthy: () => healthy,
    async start() {
      if (started) return
      started = true
      try {
        await producer.connect()
        await consumer.connect()
        await consumer.subscribe({ topic: funnelUpdatedTopic, fromBeginning: true })
        runPromise = consumer.run({ autoCommit: false, partitionsConsumedConcurrently: 1, eachMessage: processMessage })
        runPromise.catch(markFailed)
        healthy = true
      } catch (error) {
        healthy = false
        await consumer.stop().catch(() => {})
        await Promise.allSettled([consumer.disconnect(), producer.disconnect()])
        started = false
        throw error
      }
    },
    async stop() {
      healthy = false
      if (!started) return
      await consumer.stop().catch(() => {})
      await Promise.allSettled([consumer.disconnect(), producer.disconnect()])
      await runPromise?.catch(() => {})
      started = false
    },
  })
}
