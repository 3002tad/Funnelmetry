/**
 * Đồng bộ super_admin theo DASHBOARD_ADMIN_EMAIL / DASHBOARD_ADMIN_PASSWORD.
 * k3s: kubectl -n realtime exec deploy/dashboard-api -- node scripts/sync-admin.mjs
 * local: node --env-file=../../infra/.env scripts/sync-admin.mjs
 */
import { seedAdminUser } from "../src/seed.js";

await seedAdminUser();
console.log("sync-admin done");
