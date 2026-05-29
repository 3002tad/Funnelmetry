import { runAdapter } from "./adapter.js";

runAdapter().catch((err) => {
  console.error("[adapter] fatal:", err);
  process.exit(1);
});
