/**
 * Đồng bộ super_admin theo DASHBOARD_ADMIN_EMAIL / DASHBOARD_ADMIN_PASSWORD.
 * Run locally: node --env-file=../../infra/.env scripts/sync-admin.mjs
 */
import { seedAdminUser } from "../src/seed.js";

await seedAdminUser();
console.log("sync-admin done");
