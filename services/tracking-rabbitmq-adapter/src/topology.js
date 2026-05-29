import { config } from "./config.js";

export async function assertAdapterTopology(channel) {
  const dlx = `${config.exchange}.dlx`;

  await channel.assertExchange(config.exchange, config.exchangeType, { durable: true });
  await channel.assertExchange(dlx, "topic", { durable: true });

  const dlq = `${config.adapterQueue}.dlq`;
  await channel.assertQueue(config.adapterQueue, {
    durable: true,
    arguments: {
      "x-dead-letter-exchange": dlx,
      "x-dead-letter-routing-key": `${config.adapterQueue}.failed`,
    },
  });
  await channel.assertQueue(dlq, { durable: true });
  await channel.bindQueue(dlq, dlx, `${config.adapterQueue}.failed`);

  for (const key of config.bindingKeys) {
    await channel.bindQueue(config.adapterQueue, config.exchange, key);
  }

  console.log(
    "[adapter] topology exchange=%s queue=%s bindings=%s",
    config.exchange,
    config.adapterQueue,
    config.bindingKeys.join(", ")
  );
}
