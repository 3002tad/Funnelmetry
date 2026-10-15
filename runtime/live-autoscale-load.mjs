// Bounded local-live acceptance traffic. Credentials stay in ignored deploy.env.
// This deliberately uses the source-owned HTTPS ingress, never live Kafka writes.
import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseOptions, runBot } from '../tools/medusa-reference-simulator/funnelmetry-api-bot.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = join(root, 'runtime', 'deploy.env');
const REQUIRED = ['FUNNELMETRY_SOURCE_INGRESS_URL', 'FUNNELMETRY_SOURCE_ID',
  'FUNNELMETRY_SOURCE_KEY_ID', 'FUNNELMETRY_BROWSER_WRITE_KEY', 'SWARM_FEED_ID'];

export function prepareLiveLoad(env, { command, journeys = 150 } = {}) {
  if (!['check', 'run'].includes(command) || !Number.isSafeInteger(journeys) || journeys < 1 || journeys > 150) {
    throw Error('Use check or run with 1..150 journeys');
  }
  const missing = REQUIRED.filter(key => !env[key]?.trim());
  if (missing.length) throw Error(`Missing local deploy.env variables: ${missing.join(', ')}`);
  if (env.FUNNELMETRY_SOURCE_ID !== 'medusa-reference') throw Error('Only medusa-reference live test is allowed');
  if (command === 'run' && env.SWARM_LIVE_LOAD_ACK !== 'LABELED_BEHAVIOR_ONLY') {
    throw Error('Set SWARM_LIVE_LOAD_ACK=LABELED_BEHAVIOR_ONLY for the bounded live test');
  }
  const options = parseOptions(['--mode', 'behavior', '--journeys', String(journeys),
    '--concurrency', '4', '--step-delay-ms', '20', '--request-timeout-ms', '5000',
    '--max-attempts', '2'], env);
  if (new URL(options.sourceIngressUrl).protocol !== 'https:') {
    throw Error('Live Source Ingress must use HTTPS');
  }
  return { options, expectedFeedId: env.SWARM_FEED_ID.trim() };
}

export async function verifySourceIngress(options, expectedFeedId, fetchImpl = fetch) {
  const url = new URL(options.sourceIngressUrl);
  url.pathname = '/readyz';
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw Error('Source Ingress readiness failed; no events sent');
  const body = await response.json();
  if (body?.event_feed_id !== expectedFeedId) {
    throw Error('Source Event Feed identity mismatch; no events sent');
  }
  return true;
}

export async function liveAutoscaleLoad(env, { command, journeys, fetchImpl = fetch,
  bot = runBot, log = console.log } = {}) {
  const { options, expectedFeedId } = prepareLiveLoad(env, { command, journeys });
  await verifySourceIngress(options, expectedFeedId, fetchImpl);
  if (command === 'check') {
    const report = { ready: true, sourceId: options.sourceId, eventFeedMatches: true,
      syntheticBehaviorOnly: true, maxJourneys: 150, writes: 0 };
    log(JSON.stringify(report));
    return report;
  }
  const summary = await bot(options, { fetchImpl, log: () => {}, errorLog: () => {} });
  const report = { sourceId: options.sourceId, syntheticBehaviorOnly: true,
    journeysRequested: summary.journeys_requested,
    journeysSucceeded: summary.journeys_succeeded,
    journeysFailed: summary.journeys_failed,
    eventsSourceAccepted: summary.events_source_accepted,
    medusaOrdersCreated: summary.medusa_orders_created,
    durationMs: summary.duration_ms };
  log(JSON.stringify(report));
  if (report.journeysFailed > 0 || report.medusaOrdersCreated !== 0) {
    throw Error('Live load did not fully accept; inspect Source Ingress without exposing credentials');
  }
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [command, journeysFlag] = process.argv.slice(2);
    if (process.argv.length > 4 || (journeysFlag && !/^--journeys=\d+$/.test(journeysFlag))) {
      throw Error('Use: node runtime/live-autoscale-load.mjs check|run [--journeys=1..150]');
    }
    const env = parseEnv(await readFile(envPath, 'utf8'));
    await liveAutoscaleLoad(env, { command,
      journeys: journeysFlag ? Number(journeysFlag.slice('--journeys='.length)) : 150 });
  } catch (error) {
    // Never print server response bodies, credentials, or the private env line.
    const message = error instanceof Error ? error.message : 'Unexpected live load failure';
    console.error(message.startsWith('Missing local deploy.env variables:') ||
      message.startsWith('Set SWARM_LIVE_LOAD_ACK=') ||
      message.startsWith('Source Event Feed identity mismatch') ||
      message.startsWith('Source Ingress readiness failed') ||
      message.startsWith('Use:') || message.startsWith('Use check or run') ||
      message.startsWith('Only medusa-reference') || message.startsWith('Live Source Ingress') ||
      message.startsWith('Live load did not fully accept')
      ? message : 'Live load failed; check local Source Ingress configuration and service health');
    process.exitCode = 1;
  }
}
