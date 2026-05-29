import amqp from "amqplib";
import { config } from "./config.js";
import { assertTopology } from "./topology.js";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function childEvent(parent, eventType, eventSource, metadataExtra = {}) {
  return {
    event_id: `${eventType.replace(/\./g, "_")}_${parent.order_id}_${Date.now()}`,
    event_type: eventType,
    event_source: eventSource,
    occurred_at: new Date().toISOString(),
    anonymous_id: parent.anonymous_id,
    session_id: parent.session_id,
    user_id: parent.user_id ?? null,
    order_id: parent.order_id,
    metadata: { ...parent.metadata, ...metadataExtra },
  };
}

async function publish(channel, routingKey, event) {
  const body = Buffer.from(JSON.stringify(event));
  return new Promise((resolve, reject) => {
    channel.publish(config.exchange, routingKey, body, {
      persistent: true,
      contentType: "application/json",
      messageId: event.event_id,
    }, (err) => (err ? reject(err) : resolve()));
  });
}

async function processOrderCreated(channel, event) {
  console.log("Consumed event: order.created %s", event.order_id);
  await sleep(config.processDelayMs);

  const reserved = childEvent(event, "inventory.reserved", "web_demo_worker", {
    status: "inventory_reserved",
  });
  await publish(channel, "inventory.reserved", reserved);
  console.log("Published event: inventory.reserved %s", event.order_id);

  await sleep(config.processDelayMs);

  const payment = childEvent(event, "payment.succeeded", "web_demo_worker", {
    status: "succeeded",
    payment_method: event.metadata?.payment_method || "cod",
    amount: event.metadata?.total_amount || 0,
    currency: "VND",
  });
  await publish(channel, "payment.succeeded", payment);
  console.log("Published event: payment.succeeded %s", event.order_id);

  await sleep(config.processDelayMs);

  const completed = childEvent(event, "order.completed", "web_demo_worker", {
    status: "completed",
    total_amount: event.metadata?.total_amount || 0,
    payment_method: event.metadata?.payment_method || "cod",
    item_count: event.metadata?.item_count || 0,
    items: event.metadata?.items || [],
  });
  await publish(channel, "order.completed", completed);
  console.log("Published event: order.completed %s", event.order_id);
}

export async function runWorker() {
  const conn = await amqp.connect(config.rabbitmqUrl);
  const channel = await conn.createConfirmChannel();
  await assertTopology(channel);
  await channel.prefetch(5);

  console.log("web-demo-worker listening queue=%s", config.orderQueue);

  channel.consume(
    config.orderQueue,
    async (msg) => {
      if (!msg) return;
      try {
        const event = JSON.parse(msg.content.toString("utf8"));
        if (event.event_type !== "order.created") {
          console.warn("skip unexpected event_type=%s", event.event_type);
          channel.ack(msg);
          return;
        }
        await processOrderCreated(channel, event);
        channel.ack(msg);
      } catch (err) {
        console.error("worker failed:", err.message);
        channel.nack(msg, false, false);
      }
    },
    { noAck: false }
  );

  conn.on("close", () => {
    console.error("rabbitmq connection closed — exiting");
    process.exit(1);
  });
}
