// Operator-only metadata release. Does not execute or register an Agent tool.
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { createReferenceOfferMetadataOperator } from
  '../src/lib/reference-cdc-offer-metadata.js';

const mode = process.argv[2];
if (!['publish-shadow', 'activate'].includes(mode)) {
  throw Error('usage: reference-current-offer-metadata.mjs publish-shadow|activate');
}
if (mode === 'activate' && process.env.CDC_OFFER_METADATA_ACTIVATION_ACK !==
    'ACTIVATE_REFERENCE_CURRENT_OFFER_METADATA_V1') {
  throw Error('reference_offer_metadata_activation_ack_missing');
}
const password = process.env.POSTGRES_PASSWORD_FILE
  ? readFileSync(process.env.POSTGRES_PASSWORD_FILE, 'utf8').trim()
  : process.env.POSTGRES_PASSWORD;
if (!password || (process.env.POSTGRES_PASSWORD_FILE && process.env.POSTGRES_PASSWORD)) {
  throw Error('reference_offer_metadata_db_credential_invalid');
}
const pool = new pg.Pool({
  host: process.env.POSTGRES_HOST, port: Number(process.env.POSTGRES_PORT || 5432),
  database: process.env.POSTGRES_DB, user: process.env.POSTGRES_USER,
  password, max: 1, connectionTimeoutMillis: 10000,
});
try {
  const operator = createReferenceOfferMetadataOperator({ pool });
  const result = await operator[mode === 'activate' ? 'activate' : 'publishShadow']({
    sourceId: process.env.CDC_OFFER_METADATA_SOURCE_ID,
    catalogEpochId: process.env.CDC_OFFER_METADATA_CATALOG_EPOCH_ID,
    stage2EpochId: process.env.CDC_OFFER_METADATA_STAGE2_EPOCH_ID,
    decisionRef: process.env.CDC_OFFER_METADATA_DECISION_REF,
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
} finally { await pool.end(); }
