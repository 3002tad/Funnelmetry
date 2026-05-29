/**
 * Load infra/.env for pipeline services run locally (not in-cluster).
 * k3s pods still use deployment env + app-secrets.
 */
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const infraDir = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(infraDir, ".env");

const require = createRequire(import.meta.url);
const result = require("dotenv").config({ path: envPath });

if (result.error && process.env.NODE_ENV !== "test") {
  console.warn(`[infra/load-env] ${envPath}: ${result.error.message}`);
}

export { infraDir, envPath };
