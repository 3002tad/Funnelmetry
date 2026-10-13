// Planning gate for a fresh, isolated DEC-126 Swarm candidate. This file never
// creates a stack, changes Docker state, or treats a green check as cutover approval.
import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = join(root, 'runtime', 'deploy.env');
const imagePattern = /^ghcr\.io\/[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)+(?::sha-[a-f0-9]{40}|@sha256:[a-f0-9]{64})$/;
const statefulImagePattern = /^(?:docker\.io\/)?(?:library\/)?(?:postgres|apache\/kafka):[a-z0-9._-]+@sha256:[a-f0-9]{64}$/;
const edgeImagePattern = /^(?:docker\.io\/)?(?:library\/)?traefik:[a-z0-9._-]+@sha256:[a-f0-9]{64}$/;

export function validateSwarmApp(env) {
  const domain = env.SWARM_PUBLIC_DOMAIN?.trim() || '';
  if (domain.length > 253 || !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)) {
    throw Error('SWARM_PUBLIC_DOMAIN must be a reviewed lowercase public DNS hostname');
  }
  const tlsMode = env.SWARM_TLS_MODE?.trim() || '';
  if (!['local', 'acme'].includes(tlsMode)) throw Error('SWARM_TLS_MODE must be local or acme');
  if (tlsMode === 'acme' && domain.endsWith('.local')) throw Error('ACME cannot issue a certificate for a .local hostname');
  if (!edgeImagePattern.test(env.SWARM_TRAEFIK_IMAGE?.trim() || '')) {
    throw Error('SWARM_TRAEFIK_IMAGE must pin the official Traefik image by tag and sha256 digest');
  }
  if (tlsMode === 'acme' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(env.SWARM_ACME_EMAIL?.trim() || '')) {
    throw Error('SWARM_ACME_EMAIL is required for ACME');
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(env.SWARM_ADMIN_EMAIL?.trim() || '')) {
    throw Error('SWARM_ADMIN_EMAIL must be a valid single-line email');
  }
  return Object.freeze({ domain, tlsMode, status: 'PLANNING_ONLY' });
}

export function validateSwarmCandidate(env) {
  const stackName = env.SWARM_STACK_NAME?.trim() || '';
  if (!/^[a-z][a-z0-9_-]{2,40}$/.test(stackName)) {
    throw Error('SWARM_STACK_NAME must be a new lowercase Swarm stack name (3..41 characters)');
  }
  if (stackName === env.HANDOFF_PROJECT?.trim()) {
    throw Error('Swarm candidate and existing Compose project must have different names');
  }
  if (env.SWARM_MIGRATION_MODE !== 'OFFLINE_DEMO') {
    throw Error('First Swarm migration phase supports an isolated OFFLINE_DEMO candidate only');
  }
  const images = {};
  for (const [name, key] of Object.entries({ api: 'SWARM_API_IMAGE', web: 'SWARM_WEB_IMAGE', workers: 'SWARM_WORKERS_IMAGE' })) {
    const ref = env[key]?.trim() || '';
    if (!imagePattern.test(ref)) throw Error(`${key} must pin a GHCR full Git SHA tag or sha256 digest`);
    images[name] = ref;
  }
  for (const [name, key] of Object.entries({ postgres: 'SWARM_POSTGRES_IMAGE', kafka: 'SWARM_KAFKA_IMAGE' })) {
    const ref = env[key]?.trim() || '';
    if (!statefulImagePattern.test(ref)) throw Error(`${key} must pin an official tagged image by sha256 digest`);
    images[name] = ref;
  }
  return Object.freeze({
    status: 'PLANNING_ONLY', stackName, mode: 'OFFLINE_DEMO', images,
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
