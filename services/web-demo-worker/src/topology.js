import { config } from "./config.js";

/** Idempotent declare — Integration Guide §4. */
export async function assertTopology(channel) {
  const dlx = `${config.exchange}.dlx`;

  await channel.assertExchange(config.exchange, config.exchangeType, { durable: true });
  await channel.assertExchange(dlx, "topic", { durable: true });

  await channel.assertQueue(config.orderQueue, {
    durable: true,
    arguments: {
      "x-dead-letter-exchange": dlx,
      "x-dead-letter-routing-key": `${config.orderQueue}.failed`,
    },
  });
  await channel.bindQueue(config.orderQueue, config.exchange, config.orderBindingKey);

  const dlq = `${config.orderQueue}.dlq`;
  await channel.assertQueue(dlq, { durable: true });
  await channel.bindQueue(dlq, dlx, `${config.orderQueue}.failed`);

  console.log(
    "topology ready exchange=%s queue=%s bind=%s",
    config.exchange,
    config.orderQueue,
    config.orderBindingKey
  );
}
