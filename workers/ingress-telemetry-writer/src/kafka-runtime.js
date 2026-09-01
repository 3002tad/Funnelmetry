import { Kafka, logLevel } from "kafkajs"
import { validateCanonicalizationOutcome } from "@funnelmetry/canonical-contract"
import { validateIngressReceipt } from "@funnelmetry/input-contract"

function parseKey(message) {
  let key
  try {
    key = JSON.parse(message.key?.toString("utf8") ?? "null")
  } catch {}
  if (!Array.isArray(key) || key.length !== 2 || key.some((value) => typeof value !== "string" || !value)) {
    throw new Error("telemetry Kafka key must contain [source_id,event_id]")
  }
  return key
}

export function createKafkaIngressTelemetryRuntime({
  brokers,
  clientId,
  consumerGroupId,
  receiptTopic,
  outcomeTopic,
  repository,
  kafka,
  onError = (error) => console.error("ingress-telemetry-writer Kafka runtime error", error),
} = {}) {
  if (!brokers?.length || !clientId || !consumerGroupId || !receiptTopic || !outcomeTopic) {
    throw new Error("Complete ingress telemetry Kafka configuration is required")
  }
  if (receiptTopic === outcomeTopic) throw new Error("receipt and outcome topics must be different")
  if (!repository || typeof repository.persistReceipt !== "function" || typeof repository.persistOutcome !== "function") {
    throw new Error("An ingress telemetry repository is required")
  }

  const client = kafka ?? new Kafka({ brokers, clientId, logLevel: logLevel.WARN })
  const consumer = client.consumer({ groupId: consumerGroupId, readUncommitted: false })
  let started = false
  let healthy = false
  let runPromise

  async function processMessage({ topic, partition, message }) {
    if (message.value === null) throw new Error("telemetry topics must not contain tombstones")
    const [keySourceId, keyEventId] = parseKey(message)
    const document = JSON.parse(message.value.toString("utf8"))
    if (topic === receiptTopic) {
      const receipt = validateIngressReceipt(document)
      if (receipt.source_id !== keySourceId || receipt.event_id !== keyEventId) {
        throw new Error("receipt Kafka key does not match document identity")
      }
      await repository.persistReceipt(receipt)
    } else if (topic === outcomeTopic) {
      const outcome = validateCanonicalizationOutcome(document)
      if (outcome.source_id !== keySourceId || outcome.source_event_id !== keyEventId) {
        throw new Error("outcome Kafka key does not match document identity")
      }
      await repository.persistOutcome(outcome)
    } else {
      throw new Error(`unsupported telemetry topic ${topic}`)
    }
    await consumer.commitOffsets([{ topic, partition, offset: String(BigInt(message.offset) + 1n) }])
  }

  const markFailed = (error) => {
    healthy = false
    onError(error)
  }
  if (consumer.events?.CRASH && typeof consumer.on === "function") {
    consumer.on(consumer.events.CRASH, ({ payload }) => markFailed(payload?.error ?? new Error("telemetry consumer crashed")))
  }

  return Object.freeze({
    isHealthy: () => healthy,
    async start() {
      if (started) return
      started = true
      try {
        await consumer.connect()
        await consumer.subscribe({ topics: [receiptTopic, outcomeTopic], fromBeginning: true })
        runPromise = consumer.run({ autoCommit: false, partitionsConsumedConcurrently: 1, eachMessage: processMessage })
        runPromise.catch(markFailed)
        healthy = true
      } catch (error) {
        healthy = false
        await consumer.stop().catch(() => {})
        await consumer.disconnect().catch(() => {})
        started = false
        throw error
      }
    },
    async stop() {
      healthy = false
      if (!started) return
      await consumer.stop().catch(() => {})
      await consumer.disconnect().catch(() => {})
      await runPromise?.catch(() => {})
      started = false
    },
  })
}
