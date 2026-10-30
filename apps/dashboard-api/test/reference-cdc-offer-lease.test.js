import test from 'node:test';
import assert from 'node:assert/strict';
import { offerLeaseUnchanged } from '../src/lib/reference-cdc-offer-lease.js';
import { STAGE2_TABLES } from '../src/lib/reference-cdc-offer.js';

const before = {
  catalog_epoch_id: 'catalog-epoch-1', stage2_epoch_id: 'stage2-epoch-1',
  catalog_verified_at: '2026-10-30T12:00:00Z',
  catalog_valid_until: '2026-10-30T12:02:00Z',
  stage2_verified_at: '2026-10-30T12:00:01Z',
  stage2_valid_until: '2026-10-30T12:02:01Z',
};
const current = {
  ...before, ready: true,
  stage2_source_row_counts: Object.fromEntries(STAGE2_TABLES.map(table => [table, 0])),
};

test('offer read blocks a revoked, replaced, or incomplete lease', () => {
  assert.equal(offerLeaseUnchanged(before, current), true);
  assert.equal(offerLeaseUnchanged(before, { ...current, ready: false }), false);
  assert.equal(offerLeaseUnchanged(before, { ...current,
    stage2_verified_at: '2026-10-30T12:00:02Z' }), false);
  assert.equal(offerLeaseUnchanged(before, { ...current,
    catalog_epoch_id: 'catalog-epoch-2' }), false);
  const missingCounts = { ...current.stage2_source_row_counts };
  delete missingCounts.reservation_item;
  assert.equal(offerLeaseUnchanged(before, { ...current,
    stage2_source_row_counts: missingCounts }), false);
});
