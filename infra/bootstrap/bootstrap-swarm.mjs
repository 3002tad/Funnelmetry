// Fresh isolated Swarm database only. Never upgrades or resets an existing DB.
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { bootstrap, validateTarget } from './bootstrap-handoff.mjs';
import { baselineV2SchemaFiles } from './baseline-v2-schema.mjs';

export async function schemaFiles(root = '/workspace') {
  const postgres = `${root}/infra/postgres`;
  return [
    ...baselineV2SchemaFiles(root),
    ...['003_dashboard_users.sql', '006_dashboard_staff.sql', '007_dashboard_sessions.sql',
      '008_dashboard_account_audit.sql', '009_dashboard_audit_pagination.sql',
      '010_dashboard_preferences.sql'].map(name => `${postgres}/${name}`),
    ...['fact-order-v1.sql', 'catalog-v1.sql', 'evidence-v1.sql', 'evidence-notes-v1.sql',
      'evidence-notes-v2.sql', 'product-value-v1.sql'].map(name => `${root}/analytics/sql/${name}`),
    `${postgres}/traffic/001_raw_utm_source.sql`,
    `${postgres}/traffic/002_source_registry.sql`,
    `${postgres}/011_monitoring_credentials.sql`,
  ];
}

export function schemaDigest(files, sql, localRoot = '/workspace') {
  if (files.length !== sql.length) throw Error('Schema files/content length mismatch');
  const canonical = files.map((file, index) => {
    if (!file.startsWith(`${localRoot}/`)) throw Error('Schema path outside deployment root');
    return [`/workspace/${file.slice(localRoot.length + 1)}`, sql[index]];
  });
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

export async function connectWithRetry(createClient, attempts = 30, delay = ms => new Promise(resolve => setTimeout(resolve, ms))) {
  for (let count = 1; count <= attempts; count++) {
    const client = createClient();
    try { await client.connect(); return client; }
    catch (error) {
      await client.end().catch(() => {});
      if (count === attempts) throw Error('SWARM_POSTGRES_NOT_READY');
      await delay(2000);
    }
  }
}

// The Compose-era release job must not be a hidden dependency of a Swarm stack.
// These installers are idempotent and reject a release ID bound to other metadata.
export async function installAnalyticalReleases(pool, installers) {
  for (const install of installers) await install(pool);
}

async function main() {
  if (process.env.HANDOFF_MODE === 'OFFLINE_DEMO') validateTarget(process.env);
  else if (process.env.HANDOFF_MODE !== 'PARALLEL_LIVE' || process.env.POSTGRES_HOST !== 'postgres'
    || process.env.POSTGRES_DB !== 'funnelmetry_handoff') throw Error('HANDOFF_TARGET_REJECTED');
  const require = createRequire('/workspace/apps/dashboard-api/package.json');
  const { Client, Pool } = require('pg');
  const options = { host: 'postgres', port: 5432, database: 'funnelmetry_handoff',
    user: process.env.POSTGRES_USER, password: process.env.POSTGRES_PASSWORD,
    connectionTimeoutMillis: 3000 };
  const files = await schemaFiles();
  const sql = await Promise.all(files.map(file => readFile(file, 'utf8')));
  if (process.env.SWARM_EXPECTED_SCHEMA_DIGEST !== schemaDigest(files, sql)) {
    throw Error('SWARM_SCHEMA_MANIFEST_MISMATCH');
  }
  const client = await connectWithRetry(() => new Client(options));
  try {
    await bootstrap(client, files, sql);
  } finally { await client.end().catch(() => {}); }
  const { installStagingOrderCatalog } = await import('/workspace/analytics/src/semantic-registry.mjs');
  const { installRankingCatalog } = await import('/workspace/analytics/src/order-ranking.mjs');
  const { installProductRankingCatalog } = await import('/workspace/analytics/src/product-ranking.mjs');
  const pool = new Pool(options);
  try {
    await installAnalyticalReleases(pool, [installStagingOrderCatalog, installRankingCatalog, installProductRankingCatalog]);
    // A distinct completion marker prevents API/workers from treating schema
    // installation as analytical-catalog readiness after a partial failure.
    await pool.query(`CREATE TABLE IF NOT EXISTS swarm_release_bootstrap (
      id integer PRIMARY KEY CHECK (id=1), completed_at timestamptz NOT NULL DEFAULT now())`);
    await pool.query(`INSERT INTO swarm_release_bootstrap(id) VALUES (1)
      ON CONFLICT (id) DO UPDATE SET completed_at=now()`);
    console.log('PASS: isolated Swarm schema and analytical releases installed');
  } finally { await pool.end(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { await main(); }
  catch { console.error('Swarm offline bootstrap failed; review isolated DB and schema before proceeding. No reset performed.'); process.exitCode = 1; }
}
