// Read-only aggregate audit of non-normalized outcomes against the Source Feed.
// Never logs credentials, event IDs or raw payloads.
import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseEnv } from 'node:util';

const exec = promisify(execFile);
const env = parseEnv(await readFile(new URL('./deploy.env', import.meta.url), 'utf8'));
if (!/^[a-z][a-z0-9_-]{2,40}$/.test(env.SWARM_STACK_NAME || '') ||
    env.SWARM_MIGRATION_MODE !== 'PARALLEL_LIVE') throw Error('A reviewed live stack is required');
const run = async args => (await exec('docker', args, { windowsHide: true, maxBuffer: 65536 })).stdout.trim();
const ids = (await run(['ps', '--filter', `label=com.docker.swarm.service.name=${env.SWARM_STACK_NAME}_postgres`,
  '--format', '{{.ID}}'])).split(/\s+/).filter(Boolean);
if (ids.length !== 1) throw Error('Exactly one Postgres task is required');
const rows = await run(['exec', ids[0], 'psql', '-U', 'funnelmetry', '-d', 'funnelmetry_handoff',
  '-AtF', '\t', '-c', "select source_event_id,status,coalesce(reason_code,'') from canonicalization_outcomes where status <> 'normalized'"]);
const pending = new Map(rows.split(/\r?\n/).filter(Boolean).map(line => {
  const [id, status, reason] = line.split('\t');
  return [id, { status, reason }];
}));
const totals = new Map();
let after = Number(env.SWARM_INITIAL_AFTER_SEQ), pages = 0, matched = 0;
if (!Number.isSafeInteger(after) || after < 0) throw Error('Invalid initial cursor');
while (pages++ < 50) {
  const url = new URL(env.SWARM_FEED_URL);
  url.search = new URLSearchParams({ after_seq: String(after), limit: '100', wait: '0' }).toString();
  const response = await fetch(url, { headers: { Authorization: `Bearer ${env.HANDOFF_FEED_TOKEN}`,
    Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw Error(`Feed HTTP ${response.status}`);
  const feed = await response.json();
  if (feed.event_feed_id !== env.SWARM_FEED_ID || !Array.isArray(feed.events) ||
      !Number.isSafeInteger(feed.next_after_seq) || feed.next_after_seq < after) throw Error('Feed lineage or cursor mismatch');
  for (const event of feed.events) {
    const issue = pending.get(event.event_id);
    if (!issue) continue;
    const key = `${issue.status}|${issue.reason}|${event.source_event_type}|schema=${event.source_schema_version || 'unspecified'}`;
    totals.set(key, (totals.get(key) || 0) + 1);
    matched++;
    pending.delete(event.event_id);
  }
  after = feed.next_after_seq;
  if (after >= feed.latest_available_seq || !feed.events.length) break;
}
console.log(JSON.stringify({ inspected_through_seq: after, non_normalized_count: matched + pending.size,
  matched, unmatched: pending.size,
  by_status_reason_source_type: Object.fromEntries([...totals].sort((a, b) => a[0].localeCompare(b[0]))) }));
