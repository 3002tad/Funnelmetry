import amqp from "amqplib";
import { config } from "./config.js";

let channel = null;
let connectPromise = null;

async function connect() {
  const conn = await amqp.connect(config.rabbitmqUrl);
  const ch = await conn.createChannel();
  await ch.assertExchange(config.exchange, "fanout", { durable: true });
  conn.on("error", () => { channel = null; connectPromise = null; });
  conn.on("close", () => { channel = null; connectPromise = null; });
  channel = ch;
  console.log("rabbitmq connected — exchange=%s", config.exchange);
}

async function getChannel() {
  if (!channel) {
    if (!connectPromise) connectPromise = connect();
    await connectPromise;
  }
  return channel;
}

export async function publish(event) {
  const ch = await getChannel();
  ch.publish(
    config.exchange, "",
    Buffer.from(JSON.stringify(event)),
    { persistent: true, contentType: "application/json" }
  );
}
