import { createApp } from "./app.js";
import { config } from "./config.js";
import { seedAdminUser } from "./seed.js";

const app = createApp();

seedAdminUser()
  .catch((err) => console.error("seed admin failed:", err.message))
  .finally(() => {
    app.listen(config.port, () =>
      console.log(`dashboard-api listening on :${config.port}`)
    );
  });
