import amqp from "amqplib";
import { config } from "./config.js";

let channel = null;
let connectPromise = null;

async function connect() {
  const conn = await amqp.connect(config.rabbitmqUrl);
  const ch = await conn.createConfirmChannel();
  await ch.assertExchange(config.exchange, config.exchangeType, { durable: true });
  conn.on("error", () => {
    channel = null;
    connectPromise = null;
  });
  conn.on("close", () => {
    channel = null;
    connectPromise = null;
  });
  channel = ch;
  console.log(
    "rabbitmq connected — exchange=%s type=%s",
    config.exchange,
    config.exchangeType
  );
}

async function getChannel() {
  if (!channel) {
    if (!connectPromise) connectPromise = connect();
    await connectPromise;
  }
  return channel;
}

/**
 * Publish with routing key (topic exchange per Integration Guide).
 */
export async function publishBusinessEvent(routingKey, event) {
  const ch = await getChannel();
  const body = Buffer.from(JSON.stringify(event));
  return new Promise((resolve, reject) => {
    ch.publish(config.exchange, routingKey, body, {
      persistent: true,
      contentType: "application/json",
      messageId: event.event_id,
      timestamp: Date.now(),
    }, (err) => {
      if (err) reject(err);
      else resolve(true);
    });
  });
}
