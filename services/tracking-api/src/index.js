import { createApp } from "./app.js";
import { config } from "./config.js";
import { disconnectProducer } from "./kafka.producer.js";

const app = createApp();

const server = app.listen(config.port, () => {
  console.log(`tracking-api listening on :${config.port}`);
});

async function shutdown() {
  console.log("shutting down tracking-api");
  await disconnectProducer();
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
