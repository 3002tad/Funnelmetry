import test from 'node:test';
import assert from 'node:assert/strict';
import { assessEvidence, expectedFeedIngestionId, parseArgs } from './trace-event.mjs';

const accepted = { ingestion_id: 'ing_1' };
const normalized = { status: 'normalized', raw_record_id: 'ing_1', canonical_event_id: 'can_1' };
const canonical = { canonical_event_id: 'can_1', raw_record_id: 'ing_1' };

test('reports each observed stage without treating optional funnel/KPI as failed', () => {
  const result = assessEvidence({ receipt: accepted, outcome: normalized, canonical,
    journey: { journey_id: 'journey_1' }, funnel_applications: [], kpi_application: null });
  assert.equal(result.status, 'CANONICAL_JOURNEY_OBSERVED');
  assert.equal(result.stages.funnel_application, 'NOT_OBSERVED_OR_NOT_APPLICABLE');
  assert.equal(result.stages.kpi_application, 'NOT_OBSERVED_OR_NOT_APPLICABLE');
});

test('does not infer a lost event from absent asynchronous projection evidence', () => {
  assert.equal(assessEvidence({ receipt: accepted, outcome: null }).status, 'WAITING_FOR_OUTCOME');
  assert.equal(assessEvidence({ receipt: accepted, outcome: normalized, canonical: null }).status, 'WAITING_FOR_LEDGER');
  assert.equal(assessEvidence({ receipt: accepted, outcome: normalized, canonical, journey: null }).status,
    'WAITING_FOR_JOURNEY');
});

test('distinguishes unsupported terminal outcome and detects raw identity mismatch', () => {
  assert.equal(assessEvidence({ receipt: accepted, outcome: {
    status: 'unsupported', raw_record_id: 'ing_1', reason_code: 'UNKNOWN_EVENT',
  } }).status, 'TERMINAL_NON_NORMALIZED');
  const mismatch = assessEvidence({ receipt: accepted, outcome: { ...normalized, raw_record_id: 'ing_2' },
    canonical, journey: { journey_id: 'journey_1' } });
  assert.equal(mismatch.status, 'INCONSISTENT');
  assert.deepEqual(mismatch.mismatches, ['receipt/outcome raw identity differs']);
});

test('binds a supplied Source reference to receipt identity and Connector ACK prefix', () => {
  const sourceReference = { connectorId: 'demo-connector', eventFeedId: 'feed-1', ingressSeq: 42 };
  const ingestionId = expectedFeedIngestionId('feed-1', 42);
  const evidence = {
    receipt: { ingestion_id: ingestionId },
    outcome: { ...normalized, raw_record_id: ingestionId },
    canonical: { ...canonical, raw_record_id: ingestionId },
    journey: { journey_id: 'journey_1' },
    cursor: { connector_id: 'demo-connector', event_feed_id: 'feed-1', after_seq: 45 },
  };
  const matched = assessEvidence(evidence, sourceReference);
  assert.equal(matched.status, 'CANONICAL_JOURNEY_OBSERVED');
  assert.equal(matched.stages.source_handoff, 'RECEIPT_IDENTITY_AND_ACK_PREFIX_OBSERVED');
  const behind = assessEvidence({ ...evidence, cursor: { ...evidence.cursor, after_seq: 40 } }, sourceReference);
  assert.equal(behind.stages.source_handoff, 'CURSOR_BEHIND_SEQUENCE');
  const wrongFeed = assessEvidence({ ...evidence, cursor: { ...evidence.cursor, event_feed_id: 'feed-2' } }, sourceReference);
  assert.equal(wrongFeed.status, 'INCONSISTENT');
  assert.equal(wrongFeed.stages.source_handoff, 'FEED_LINEAGE_MISMATCH');
  const wrongSequence = assessEvidence(evidence, { ...sourceReference, ingressSeq: 43 });
  assert.equal(wrongSequence.status, 'INCONSISTENT');
  assert.equal(wrongSequence.stages.source_handoff, 'IDENTITY_MISMATCH');
});

test('CLI requires complete, safe Source reference without accepting secret flags', () => {
  assert.deepEqual(parseArgs(['--source-id', 'medusa-reference', '--event-id', 'event:1']), {
    sourceId: 'medusa-reference', eventId: 'event:1', sourceReference: null,
  });
  assert.deepEqual(parseArgs(['--event-id', 'event:1', '--ingress-seq', '42',
    '--event-feed-id', 'feed-1', '--source-id', 'medusa-reference', '--connector-id', 'connector-1']).sourceReference,
  { connectorId: 'connector-1', eventFeedId: 'feed-1', ingressSeq: 42 });
  assert.throws(() => parseArgs(['--source-id', 's', '--event-id', 'e', '--ingress-seq', '42']), /Usage/);
  assert.throws(() => parseArgs(['--source-id', 's', '--event-id', 'e', '--feed-token', 'secret']), /Usage/);
  assert.throws(() => parseArgs(['--source-id', 's', '--event-id', 'e\nother']), /single-line/);
  assert.throws(() => parseArgs(['--source-id', 's', '--event-id', 'e', '--connector-id', 'c',
    '--event-feed-id', 'f', '--ingress-seq', '9007199254740992']), /safe integer/);
});
