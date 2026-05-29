import { createApp } from "./app.js";
import { config } from "./config.js";
import { startEventPoller } from "./lib/event-poller.js";
import { seedAdminUser } from "./seed.js";

const app = createApp();

const SEED_RETRIES = 8;
const SEED_DELAY_MS = 3000;

async function seedWithRetry() {
  for (let attempt = 1; attempt <= SEED_RETRIES; attempt += 1) {
    try {
      await seedAdminUser();
      return;
    } catch (err) {
      console.error(
        `seed admin failed (attempt ${attempt}/${SEED_RETRIES}):`,
        err.message
      );
      if (attempt === SEED_RETRIES) throw err;
      await new Promise((r) => setTimeout(r, SEED_DELAY_MS));
    }
  }
}

seedWithRetry()
  .catch((err) => {
    console.error("seed admin gave up — login will fail until Postgres is up:", err.stack || err.message);
  })
  .finally(() => {
    app.listen(config.port, () => {
      console.log(`dashboard-api listening on :${config.port}`);
      startEventPoller();
    });
  });
