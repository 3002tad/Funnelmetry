import { runWorker } from "./worker.js";

runWorker().catch((err) => {
  console.error("web-demo-worker fatal:", err);
  process.exit(1);
});
