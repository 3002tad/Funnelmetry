// Planning gate for a fresh, isolated DEC-126 Swarm candidate. This file never
// creates a stack, changes Docker state, or treats a green check as cutover approval.
import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { normalizeSwarmEnv } from './swarm-config.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = join(root, 'runtime', 'deploy.env');
const imagePattern = /^ghcr\.io\/[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)+(?::sha-[a-f0-9]{40}|@sha256:[a-f0-9]{64})$/;
const statefulImagePattern = /^(?:docker\.io\/)?(?:library\/)?(?:postgres|apache\/kafka):[a-z0-9._-]+@sha256:[a-f0-9]{64}$/;
const edgeImagePattern = /^(?:docker\.io\/)?(?:library\/)?traefik:[a-z0-9._-]+@sha256:[a-f0-9]{64}$/;
const monitoringImagePattern = /^(?:docker\.io\/)?(?:prom\/prometheus|grafana\/grafana):[a-z0-9._-]+@sha256:[a-f0-9]{64}$/;
const qdrantImagePattern = /^(?:docker\.io\/)?qdrant\/qdrant:[a-z0-9._-]+@sha256:[a-f0-9]{64}$/;

export function validateSwarmApp(env) {
  const productReferenceProvider = env.SWARM_PRODUCT_REFERENCE_PROVIDER?.trim() || 'admin_api';
  if (!['admin_api', 'catalog_cdc'].includes(productReferenceProvider)) {
    throw Error('SWARM_PRODUCT_REFERENCE_PROVIDER must be admin_api or catalog_cdc');
  }
  if (productReferenceProvider === 'catalog_cdc' && env.SWARM_MIGRATION_MODE !== 'PARALLEL_LIVE') {
    throw Error('catalog_cdc product references require PARALLEL_LIVE mode');
  }
  const domain = env.SWARM_PUBLIC_DOMAIN?.trim() || '';
  if (domain.length > 253 || !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)) {
    throw Error('SWARM_PUBLIC_DOMAIN must be a reviewed lowercase public DNS hostname');
  }
  const tlsMode = env.SWARM_TLS_MODE?.trim() || '';
  if (!['local', 'acme', 'tunnel'].includes(tlsMode)) throw Error('SWARM_TLS_MODE must be local, acme or tunnel');
  if (tlsMode === 'acme' && domain.endsWith('.local')) throw Error('ACME cannot issue a certificate for a .local hostname');
  if (!edgeImagePattern.test(env.SWARM_TRAEFIK_IMAGE?.trim() || '')) {
    throw Error('SWARM_TRAEFIK_IMAGE must pin the official Traefik image by tag and sha256 digest');
  }
  if (tlsMode === 'acme' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(env.SWARM_ACME_EMAIL?.trim() || '')) {
    throw Error('SWARM_ACME_EMAIL is required for ACME');
  }
  if (tlsMode === 'tunnel') {
    const port = env.SWARM_TUNNEL_ORIGIN_PORT?.trim() || '31080';
    if (!/^[1-9]\d*$/.test(port) || Number(port) < 1024 || Number(port) > 65535) {
      throw Error('SWARM_TUNNEL_ORIGIN_PORT must be an unprivileged TCP port (1024..65535)');
    }
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(env.SWARM_ADMIN_EMAIL?.trim() || '')) {
    throw Error('SWARM_ADMIN_EMAIL must be a valid single-line email');
  }
  return Object.freeze({ domain, tlsMode, productReferenceProvider, status: 'PLANNING_ONLY' });
}

export function validateSwarmCandidate(env) {
  env = normalizeSwarmEnv(env);
  const stackName = env.SWARM_STACK_NAME?.trim() || '';
  if (!/^[a-z][a-z0-9_-]{2,40}$/.test(stackName)) {
    throw Error('SWARM_STACK_NAME must be a new lowercase Swarm stack name (3..41 characters)');
  }
  if (stackName === env.HANDOFF_PROJECT?.trim()) {
    throw Error('Swarm candidate and existing Compose project must have different names');
  }
  if (!['OFFLINE_DEMO', 'PARALLEL_LIVE'].includes(env.SWARM_MIGRATION_MODE)) {
    throw Error('SWARM_MIGRATION_MODE must be OFFLINE_DEMO or PARALLEL_LIVE');
  }
  const rawPartitions = env.SWARM_RAW_PARTITIONS?.trim() || '1';
  if (!/^[1-9]\d*$/.test(rawPartitions) || !Number.isSafeInteger(Number(rawPartitions)) || Number(rawPartitions) > 64) {
    throw Error('SWARM_RAW_PARTITIONS must be an integer from 1 to 64 for a fresh Kafka topic');
  }
  const normalizerIdMode = env.SWARM_NORMALIZER_ID_MODE?.trim() || 'explicit';
  if (!['explicit', 'container'].includes(normalizerIdMode)) {
    throw Error('SWARM_NORMALIZER_ID_MODE must be explicit or container');
  }
  if (Number(rawPartitions) > 1 && normalizerIdMode !== 'container') {
    throw Error('Multiple Raw partitions require SWARM_NORMALIZER_ID_MODE=container before deploying a fresh stack');
  }
  const batchSize = env.SWARM_NORMALIZER_TRANSACTION_BATCH_SIZE?.trim() || '64';
  if (!/^(?:[1-9]|[1-9][0-9]|1[0-9][0-9]|2[0-4][0-9]|25[0-6])$/.test(batchSize)) {
    throw Error('SWARM_NORMALIZER_TRANSACTION_BATCH_SIZE must be an integer from 1 to 256');
  }
  if (env.SWARM_MIGRATION_MODE === 'PARALLEL_LIVE') {
    if (env.SWARM_LIVE_ACK !== 'FRESH_PARALLEL_LIVE') throw Error('Fresh parallel-live acknowledgement required');
    if (!/^[a-z0-9-]{1,100}$/.test(env.SWARM_CONNECTOR_ID || '') || env.SWARM_CONNECTOR_ID === env.HANDOFF_CONNECTOR_ID) {
      throw Error('SWARM_CONNECTOR_ID must be unique and different from the Compose connector');
    }
    const feed = (() => { try { return new URL(env.SWARM_FEED_URL); } catch { return null; } })();
    if (!feed || feed.protocol !== 'https:' || feed.username || feed.password || feed.hash) throw Error('SWARM_FEED_URL must be HTTPS without embedded credentials');
    if (!/^[0-9a-f-]{36}$/i.test(env.SWARM_FEED_ID || '')) throw Error('SWARM_FEED_ID is required');
    if (!/^(0|[1-9]\d*)$/.test(env.SWARM_INITIAL_AFTER_SEQ || '') || !Number.isSafeInteger(Number(env.SWARM_INITIAL_AFTER_SEQ))) {
      throw Error('SWARM_INITIAL_AFTER_SEQ must be a safe nonnegative integer');
    }
    if (!env.SWARM_FEED_TOKEN || !env.SWARM_CATALOG_KEY || !env.SWARM_DASHSCOPE_API_KEY) {
      throw Error('Feed, catalog and Qwen credentials are required for isolated Swarm secrets');
    }
    for (const [key, protocols] of [['SWARM_CATALOG_URL', ['https:']], ['SWARM_DASHSCOPE_BASE_URL', ['https:']]]) {
      let url;
      try { url = new URL(env[key]); } catch { throw Error(`${key} must be a reviewed HTTPS URL`); }
      if (!protocols.includes(url.protocol) || url.username || url.password || url.hash) throw Error(`${key} must be a reviewed HTTPS URL`);
    }
  }
  if (env.SWARM_MONITORING_ENABLED && !['true', 'false'].includes(env.SWARM_MONITORING_ENABLED)) {
    throw Error('SWARM_MONITORING_ENABLED must be true or false');
  }
  if (env.SWARM_MONITORING_ENABLED === 'true') {
    for (const key of ['MONITORING_PROMETHEUS_IMAGE', 'MONITORING_GRAFANA_IMAGE']) {
      if (!monitoringImagePattern.test(env[key] || '')) throw Error(`${key} must pin an official image digest`);
    }
  }
  if (env.SWARM_VECTOR_KNOWLEDGE_ENABLED && !['true', 'false'].includes(env.SWARM_VECTOR_KNOWLEDGE_ENABLED)) {
    throw Error('SWARM_VECTOR_KNOWLEDGE_ENABLED must be true or false');
  }
  if (env.SWARM_VECTOR_KNOWLEDGE_ENABLED === 'true'
    && !qdrantImagePattern.test(env.SWARM_QDRANT_IMAGE || '')) {
    throw Error('SWARM_QDRANT_IMAGE must pin the official Qdrant image by tag and sha256 digest');
  }
  const images = {};
  for (const [name, key] of Object.entries({ api: 'SWARM_API_IMAGE', web: 'SWARM_WEB_IMAGE', workers: 'SWARM_WORKERS_IMAGE' })) {
    const ref = env[key]?.trim() || '';
    if (!imagePattern.test(ref)) throw Error(`${key} must pin a GHCR full Git SHA tag or sha256 digest`);
    images[name] = ref;
  }
  const normalizer = env.SWARM_NORMALIZER_IMAGE?.trim() || images.workers;
  if (!imagePattern.test(normalizer)) throw Error('SWARM_NORMALIZER_IMAGE must pin a GHCR full Git SHA tag or sha256 digest');
  images.normalizer = normalizer;
  for (const [name, key] of Object.entries({ postgres: 'SWARM_POSTGRES_IMAGE', kafka: 'SWARM_KAFKA_IMAGE' })) {
    const ref = env[key]?.trim() || '';
    if (!statefulImagePattern.test(ref)) throw Error(`${key} must pin an official tagged image by sha256 digest`);
    images[name] = ref;
  }
  return Object.freeze({
    status: 'PLANNING_ONLY', stackName, mode: env.SWARM_MIGRATION_MODE, images,
    unverified: Object.freeze([
      'IMAGE_DIGEST_SOURCE_MATCH', 'PRIVATE_REGISTRY_PULL', 'SWARM_SECRETS',
      'STATE_AND_PORT_ISOLATION', 'CAPACITY_AND_PLACEMENT', 'STACK_RUNTIME',
      'REPLAY_AND_CUTOVER',
    ]),
  });
}

export async function main() {
  let env;
  try { env = parseEnv(await readFile(envPath, 'utf8')); }
  catch { throw Error('Create ignored runtime/deploy.env before Swarm planning'); }
  env = normalizeSwarmEnv(env);
  const plan = validateSwarmCandidate(env);
  // Do not print image references or values from the ignored env; a digest is not
  // proof that the matching image is available or safe to deploy.
  console.log(`PASS: isolated Swarm candidate configuration for ${plan.stackName}; PLANNING_ONLY.`);
  console.log(`UNVERIFIED: ${plan.unverified.join(', ')}`);
  return plan;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { await main(); }
  catch (error) { console.error(`Swarm preflight stopped: ${error.message}`); process.exitCode = 1; }
}
