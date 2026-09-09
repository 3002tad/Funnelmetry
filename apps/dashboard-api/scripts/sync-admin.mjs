/**
 * Compatibility command: bootstrap only an empty account store, never reset existing users.
 * Run locally: node --env-file=../../infra/.env scripts/sync-admin.mjs
 */
import { seedAdminUser } from "../src/seed.js";
import { query, closeDatabase } from '../src/db.js';
import { assertAccountSchema, AccountSchemaError } from '../src/lib/account-schema.js';

try {
  await assertAccountSchema(query);
  await seedAdminUser();
  console.log('bootstrap check complete; existing accounts were not changed');
} catch (error) {
  console.error(error instanceof AccountSchemaError ? error.message : 'bootstrap failed');
  process.exitCode = 1;
} finally { await closeDatabase(); }
