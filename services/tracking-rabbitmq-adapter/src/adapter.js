import amqp from "amqplib";
import { config } from "./config.js";
import { normalizeBusinessEvent } from "./normalizers/ecommerce.normalizer.js";
import { postBusinessBatch } from "./sinks/tracking-api.sink.js";
import { assertAdapterTopology } from "./topology.js";

let buffer = [];
let flushTimer = null;

async function flushBuffer(channel) {
  if (!buffer.length) return;
  const batch = buffer.splice(0, buffer.length);
  const result = await postBusinessBatch(batch);
  if (!result.ok && result.retry) {
    buffer.unshift(...batch);
    throw new Error("ingest failed — will nack");
  }
}

function scheduleFlush(channel) {
  if (flushTimer) return;
  flushTimer = setTimeout(async () => {
    flushTimer = null;
    try {
      await flushBuffer(channel);
    } catch (err) {
      console.error("[adapter] flush error:", err.message);
    }
  }, config.flushMs);
}

async function enqueue(channel, canonical) {
  buffer.push(canonical);
  if (buffer.length >= config.batchSize) {
    await flushBuffer(channel);
  } else {
    scheduleFlush(channel);
  }
}

export async function runAdapter() {
  const conn = await amqp.connect(config.rabbitmqUrl);
  const channel = await conn.createConfirmChannel();
  await assertAdapterTopology(channel);
  await channel.prefetch(10);

  console.log("[adapter] listening queue=%s → %s", config.adapterQueue, config.ingestUrl);

  channel.consume(
    config.adapterQueue,
    async (msg) => {
      if (!msg) return;
      try {
        const raw = JSON.parse(msg.content.toString("utf8"));
        const canonical = normalizeBusinessEvent(raw);
        console.log(
          "[adapter] consumed %s order_id=%s",
          canonical.event_type,
          canonical.order_id
        );
        await enqueue(channel, canonical);
        channel.ack(msg);
      } catch (err) {
        console.error("[adapter] message failed:", err.message);
        channel.nack(msg, false, false);
      }
    },
    { noAck: false }
  );

  conn.on("close", () => {
    console.error("[adapter] rabbitmq closed");
    process.exit(1);
  });
}
