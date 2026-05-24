import { Kafka, logLevel } from "kafkajs";
import { config } from "./config.js";

let producer;
let connectPromise;

export async function getProducer() {
  if (!producer) {
    const kafka = new Kafka({
      clientId: "tracking-api",
      brokers: config.kafkaBrokers,
      logLevel: logLevel.WARN,
    });
    producer = kafka.producer();
    connectPromise = producer.connect();
  }
  await connectPromise;
  return {
    async send({ key, value }) {
      await producer.send({
        topic: config.kafkaTopicRaw,
        messages: [{ key, value }],
      });
    },
    async sendBatch(messages) {
      await producer.send({
        topic: config.kafkaTopicRaw,
        messages: messages.map(({ key, value }) => ({ key, value })),
      });
    },
  };
}

export async function disconnectProducer() {
  if (producer) {
    await producer.disconnect();
    producer = null;
    connectPromise = null;
  }
}
