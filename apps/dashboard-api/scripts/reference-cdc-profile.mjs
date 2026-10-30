// Operator-only publication of the retractable reference current-state profile.
// It never writes canonical events or the legacy funnel profile tables.
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { createReferenceProfileOperator } from '../src/lib/reference-cdc-profile-operator.js';

const mode = process.argv[2];
if (!['publish-shadow', 'activate', 'rollback'].includes(mode)) {
  throw Error('usage: reference-cdc-profile.mjs publish-shadow|activate|rollback');
}
if (mode === 'activate' && process.env.CDC_REFERENCE_ACTIVATION_ACK !==
    'ACTIVATE_REFERENCE_CURRENT_STATE_V2') {
  throw Error('reference_profile_activation_ack_missing');
}
const password = process.env.POSTGRES_PASSWORD_FILE
  ? readFileSync(process.env.POSTGRES_PASSWORD_FILE, 'utf8').trim()
  : process.env.POSTGRES_PASSWORD;
if (!password || (process.env.POSTGRES_PASSWORD_FILE && process.env.POSTGRES_PASSWORD)) {
  throw Error('reference_profile_db_credential_invalid');
}
const scope = {
  sourceId: process.env.CDC_REFERENCE_SOURCE_ID,
  coverageEpochId: process.env.CDC_REFERENCE_COVERAGE_EPOCH_ID,
  activationAt: process.env.CDC_REFERENCE_ACTIVATION_AT,
  decisionRef: process.env.CDC_REFERENCE_DECISION_REF,
};
const pool = new pg.Pool({
  host: process.env.POSTGRES_HOST, port: Number(process.env.POSTGRES_PORT || 5432),
  database: process.env.POSTGRES_DB, user: process.env.POSTGRES_USER,
  password, connectionTimeoutMillis: 10000, max: 1,
});
try {
  const operator = createReferenceProfileOperator({ pool });
  const result = await operator[mode === 'publish-shadow' ? 'publishShadow' : mode](scope);
  process.stdout.write(`${JSON.stringify(result)}\n`);
} finally { await pool.end(); }
