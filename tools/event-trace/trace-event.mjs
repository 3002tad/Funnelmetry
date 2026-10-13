// Read-only evidence lookup for one event in the current unified Compose stack.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const sql = `
WITH outcome AS (
  SELECT source_id, source_event_id, status, canonical_event_id, reason_code,
         mapping_version, raw_record_id, processed_at
  FROM canonicalization_latest_outcomes
  WHERE source_id = :'source_id' AND source_event_id = :'event_id'
), canonical AS (
  SELECT c.canonical_event_id, c.event_type, c.event_class, c.raw_record_id,
         c.occurred_at, c.persisted_at
  FROM canonical_events c JOIN outcome o ON c.canonical_event_id = o.canonical_event_id
)
SELECT json_build_object(
  'receipt', (SELECT row_to_json(r) FROM (
    SELECT ingestion_id, received_at, recorded_at FROM ingress_accepted_receipts
    WHERE source_id = :'source_id' AND event_id = :'event_id'
  ) r),
  'outcome', (SELECT row_to_json(o) FROM outcome o),
  'canonical', (SELECT row_to_json(c) FROM canonical c),
  'journey', (SELECT row_to_json(j) FROM (
    SELECT je.canonical_event_id, je.journey_id, je.linked_at, je.link_confidence
    FROM journey_events je JOIN canonical c USING (canonical_event_id)
  ) j),
  'funnel_applications', (SELECT coalesce(json_agg(row_to_json(f)), '[]'::json) FROM (
    SELECT fa.funnel_profile_id, fa.profile_version, fa.application_status, fa.applied_at
    FROM funnel_event_applications fa JOIN canonical c USING (canonical_event_id)
    ORDER BY fa.funnel_profile_id, fa.profile_version
  ) f),
  'kpi_application', (SELECT row_to_json(k) FROM (
    SELECT ka.changed_instance_count, ka.applied_at
    FROM kpi_projection_applications ka JOIN canonical c ON ka.trigger_event_id = c.canonical_event_id
  ) k),
  'cursor', (SELECT row_to_json(sc) FROM (
    SELECT connector_id, event_feed_id, after_seq, updated_at
    FROM source_connector_cursors WHERE connector_id = :'connector_id'
  ) sc)
);
`;

export function expectedFeedIngestionId(eventFeedId, ingressSeq) {
  return 'ing_feed_' + createHash('sha256')
    .update(JSON.stringify([eventFeedId, ingressSeq])).digest('hex');
}

export function assessEvidence(evidence, sourceReference = null) {
  const { receipt, outcome, canonical, journey } = evidence;
  const mismatches = [];
  if (receipt && outcome && receipt.ingestion_id !== outcome.raw_record_id) {
    mismatches.push('receipt/outcome raw identity differs');
  }
  if (receipt && canonical && receipt.ingestion_id !== canonical.raw_record_id) {
    mismatches.push('receipt/ledger raw identity differs');
  }
  if (outcome?.status === 'normalized' && canonical &&
      outcome.canonical_event_id !== canonical.canonical_event_id) {
    mismatches.push('outcome/ledger canonical identity differs');
  }
  let sourceHandoff = 'NOT_CHECKED';
  if (sourceReference) {
    const { connectorId, eventFeedId, ingressSeq } = sourceReference;
    if (!receipt) sourceHandoff = 'RECEIPT_NOT_OBSERVED';
    else if (receipt.ingestion_id !== expectedFeedIngestionId(eventFeedId, ingressSeq)) {
      mismatches.push('source reference/receipt ingestion identity differs');
      sourceHandoff = 'IDENTITY_MISMATCH';
    } else if (!evidence.cursor) sourceHandoff = 'CURSOR_NOT_OBSERVED';
    else if (evidence.cursor.connector_id !== connectorId || evidence.cursor.event_feed_id !== eventFeedId) {
      mismatches.push('connector/feed lineage differs from supplied source reference');
      sourceHandoff = 'FEED_LINEAGE_MISMATCH';
    } else if (Number(evidence.cursor.after_seq) < ingressSeq) sourceHandoff = 'CURSOR_BEHIND_SEQUENCE';
    else sourceHandoff = 'RECEIPT_IDENTITY_AND_ACK_PREFIX_OBSERVED';
  }
  let status;
  if (mismatches.length) status = 'INCONSISTENT';
  else if (!receipt) status = 'NO_RECEIPT_OBSERVED';
  else if (!outcome) status = 'WAITING_FOR_OUTCOME';
  else if (outcome.status !== 'normalized') status = 'TERMINAL_NON_NORMALIZED';
  else if (!canonical) status = 'WAITING_FOR_LEDGER';
  else if (!journey) status = 'WAITING_FOR_JOURNEY';
  else status = 'CANONICAL_JOURNEY_OBSERVED';
  return {
    status,
    mismatches,
    stages: {
      accepted_receipt: receipt ? 'OBSERVED' : 'NOT_OBSERVED',
      source_handoff: sourceHandoff,
      canonicalization: outcome?.status ?? 'NOT_OBSERVED',
      canonical_ledger: canonical ? 'OBSERVED' : 'NOT_OBSERVED',
      journey_projection: journey ? 'OBSERVED' : 'NOT_OBSERVED',
      funnel_application: evidence.funnel_applications?.length ? 'OBSERVED' : 'NOT_OBSERVED_OR_NOT_APPLICABLE',
      kpi_application: evidence.kpi_application ? 'OBSERVED' : 'NOT_OBSERVED_OR_NOT_APPLICABLE',
    },
  };
}

export function parseArgs(args) {
  const usage = 'Usage: node tools/event-trace/trace-event.mjs --source-id SOURCE --event-id EVENT [--connector-id ID --event-feed-id FEED --ingress-seq SEQ]';
  if (args.length % 2 !== 0) throw Error(usage);
  const values = new Map();
  const allowed = new Set(['--source-id', '--event-id', '--connector-id', '--event-feed-id', '--ingress-seq']);
  for (let i = 0; i < args.length; i += 2) {
    if (!allowed.has(args[i]) || values.has(args[i])) throw Error(usage);
    values.set(args[i], args[i + 1]);
  }
  const sourceId = values.get('--source-id');
  const eventId = values.get('--event-id');
  const optional = ['--connector-id', '--event-feed-id', '--ingress-seq'];
  if (optional.some(key => values.has(key)) && optional.some(key => !values.has(key))) throw Error(usage);
  for (const value of [sourceId, eventId, values.get('--connector-id'), values.get('--event-feed-id')].filter(v => v !== undefined)) {
    if (!value || value.length > 512 || /[\x00-\x1f\x7f]/.test(value)) {
      throw Error('Identifiers must be nonempty single-line strings of at most 512 characters');
    }
  }
  if (!sourceId || !eventId) throw Error(usage);
  let sourceReference = null;
  if (values.has('--ingress-seq')) {
    const text = values.get('--ingress-seq');
    const ingressSeq = Number(text);
    if (!/^[1-9][0-9]*$/.test(text) || !Number.isSafeInteger(ingressSeq)) {
      throw Error('ingress-seq must be a positive safe integer');
    }
    sourceReference = { connectorId: values.get('--connector-id'),
      eventFeedId: values.get('--event-feed-id'), ingressSeq };
  }
  return { sourceId, eventId, sourceReference };
}

export function traceEvent({ sourceId, eventId, sourceReference = null }) {
  // Keep Compose interpolation sourced from the reviewed env file, not ambient shell overrides.
  const childEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    !/^(HANDOFF_|MONITORING_|COMPOSE_)/i.test(key)));
  const command = 'PGPASSWORD="$POSTGRES_PASSWORD" exec psql -X -A -t -q -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" "$@"';
  const result = spawnSync('docker', [
    'compose', '--env-file', join(root, 'runtime', 'deploy.env'), '-f', join(root, 'infra', 'compose.yaml'),
    'exec', '-T', 'postgres', 'sh', '-c', command, 'sh',
    '-v', `source_id=${sourceId}`, '-v', `event_id=${eventId}`,
    '-v', `connector_id=${sourceReference?.connectorId ?? ''}`,
  ], { cwd: root, env: childEnv, input: sql, encoding: 'utf8', maxBuffer: 1024 * 1024, windowsHide: true });
  if (result.error || result.status !== 0) {
    throw Error('Evidence lookup failed; check Docker, Compose project, PostgreSQL readiness and schema (details withheld to avoid leaking env values)');
  }
  const line = result.stdout.split(/\r?\n/).find(item => item.startsWith('{'));
  if (!line) throw Error('Evidence lookup returned no JSON row');
  return JSON.parse(line);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const identifiers = parseArgs(process.argv.slice(2));
    const evidence = traceEvent(identifiers);
    const assessment = assessEvidence(evidence, identifiers.sourceReference);
    console.log(JSON.stringify({ ...identifiers, ...assessment, evidence,
      limitation: 'Source reference is operator-supplied, not fetched from Source Feed. Cursor is Kafka handoff progress, not a downstream processing-safe checkpoint.' }, null, 2));
    if (assessment.status !== 'CANONICAL_JOURNEY_OBSERVED') process.exitCode = 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
