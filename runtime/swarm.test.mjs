import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { dockerEnvironment, stackDeployArgs, stackFilesForCommand, validateAppSecrets, validateDbSecret, validateTlsFilePath, validateTunnelDeploymentAck } from './swarm.mjs';
import { validateSwarmApp, validateSwarmCandidate } from './swarm-preflight.mjs';

test('fresh independent machine can start from the nonsecret pinned release example', () => {
  const example = parseEnv(readFileSync(fileURLToPath(new URL('./deploy.env.example', import.meta.url)), 'utf8'));
  assert.equal(validateSwarmCandidate({ ...example, SWARM_STACK_NAME: 'teammate-demo' }).mode, 'OFFLINE_DEMO');
  assert.equal(validateSwarmApp({ ...example, SWARM_ADMIN_EMAIL: 'admin@example.com' }).tlsMode, 'local');
  for (const key of ['SWARM_DB_PASSWORD', 'SWARM_JWT_SECRET', 'SWARM_ADMIN_PASSWORD',
    'SWARM_FEED_TOKEN', 'SWARM_CATALOG_KEY', 'SWARM_DASHSCOPE_API_KEY']) {
    assert.equal(example[key], '', `${key} must not be shared in the example`);
  }
});

test('Swarm deploy forwards client registry credentials for pinned private images', () => {
  assert.deepEqual(stackDeployArgs(['data.yml', 'app.yml'], 'candidate'), [
    'stack', 'deploy', '--with-registry-auth', '--compose-file', 'data.yml',
    '--compose-file', 'app.yml', 'candidate',
  ]);
});

test('internal-only candidate adds API and workers without publishing an edge', () => {
  assert.deepEqual(stackFilesForCommand('deploy-internal', { tlsMode: 'local' }).map(file => file.split(/[\\/]/).at(-1)),
    ['swarm-stack.yml', 'swarm-workers.yml', 'swarm-app.yml']);
  assert.deepEqual(stackFilesForCommand('deploy-app', { tlsMode: 'local' }).map(file => file.split(/[\\/]/).at(-1)),
    ['swarm-stack.yml', 'swarm-workers.yml', 'swarm-app.yml', 'swarm-edge-local.yml']);
  assert.deepEqual(stackFilesForCommand('deploy-app', { tlsMode: 'tunnel' }).map(file => file.split(/[\\/]/).at(-1)),
    ['swarm-stack.yml', 'swarm-workers.yml', 'swarm-app.yml', 'swarm-edge-tunnel.yml']);
});

test('tunnel edge serves HTTP origin without Swarm TLS secrets or ACME', () => {
  const edge = readFileSync(fileURLToPath(new URL('../infra/swarm-edge-tunnel.yml', import.meta.url)), 'utf8');
  const route = readFileSync(fileURLToPath(new URL('../infra/swarm/traefik-tunnel.yml', import.meta.url)), 'utf8');
  assert.match(edge, /published: \$\{SWARM_TUNNEL_ORIGIN_PORT:-31080\}/);
  assert.match(edge, /mode: host/);
  assert.doesNotMatch(edge, /tls_cert|tls_key|certResolver/);
  assert.match(route, /entryPoints: \[web\]/);
  assert.doesNotMatch(route, /\btls:/);
});

test('tunnel deployment requires an explicit external firewall verification', () => {
  assert.throws(() => validateTunnelDeploymentAck({}), /blocked from external networks/);
  assert.throws(() => validateTunnelDeploymentAck({ SWARM_TUNNEL_ORIGIN_RESTRICTED_ACK: 'yes' }),
    /blocked from external networks/);
  assert.doesNotThrow(() => validateTunnelDeploymentAck({
    SWARM_TUNNEL_ORIGIN_RESTRICTED_ACK: 'ORIGIN_FIREWALL_VERIFIED',
  }));
});

test('parallel-live candidate includes connector/catalog/AI overlay before edge', () => {
  assert.deepEqual(stackFilesForCommand('deploy-app', { tlsMode: 'local' }, 'PARALLEL_LIVE').map(file => file.split(/[\\/]/).at(-1)),
    ['swarm-stack.yml', 'swarm-workers.yml', 'swarm-app.yml', 'swarm-live.yml', 'swarm-edge-local.yml']);
});

test('catalog CDC provider can be rendered for live canary and rolled back without changing source sync', () => {
  const app = readFileSync(fileURLToPath(new URL('../infra/swarm-app.yml', import.meta.url)), 'utf8');
  const live = readFileSync(fileURLToPath(new URL('../infra/swarm-live.yml', import.meta.url)), 'utf8');
  assert.match(app, /PRODUCT_REFERENCE_PROVIDER: \$\{SWARM_PRODUCT_REFERENCE_PROVIDER:-admin_api\}/);
  assert.match(live, /catalog-sync:[\s\S]*?replicas: \$\{SWARM_CATALOG_SYNC_REPLICAS:-1\}/);
  const base = { SWARM_TLS_MODE: 'local', SWARM_PUBLIC_DOMAIN: 'demo.example.com',
    SWARM_ADMIN_EMAIL: 'admin@example.com', SWARM_TRAEFIK_IMAGE: 'traefik:v3.6.0@sha256:' + 'a'.repeat(64),
    SWARM_MIGRATION_MODE: 'PARALLEL_LIVE' };
  assert.equal(validateSwarmApp(base).productReferenceProvider, 'admin_api');
  assert.equal(validateSwarmApp({ ...base, SWARM_PRODUCT_REFERENCE_PROVIDER: 'catalog_cdc' }).productReferenceProvider, 'catalog_cdc');
  assert.equal(validateSwarmApp({ ...base, SWARM_PRODUCT_REFERENCE_PROVIDER: 'catalog_cdc',
    SWARM_CATALOG_SYNC_REPLICAS: '0' }).catalogSyncReplicas, 0);
  assert.throws(() => validateSwarmApp({ ...base, SWARM_CATALOG_SYNC_REPLICAS: '0' }), /requires catalog_cdc/);
  assert.throws(() => validateSwarmApp({ ...base, SWARM_PRODUCT_REFERENCE_PROVIDER: 'catalog_cdc',
    SWARM_CATALOG_SYNC_REPLICAS: '2' }), /SWARM_CATALOG_SYNC_REPLICAS/);
  assert.throws(() => validateSwarmApp({ ...base, SWARM_PRODUCT_REFERENCE_PROVIDER: 'catalog_cdc',
    SWARM_MIGRATION_MODE: 'OFFLINE_DEMO' }), /PARALLEL_LIVE/);
  assert.throws(() => validateSwarmApp({ ...base, SWARM_PRODUCT_REFERENCE_PROVIDER: 'unknown' }), /SWARM_PRODUCT_REFERENCE_PROVIDER/);
  assert.equal(dockerEnvironment({}, { SWARM_PRODUCT_REFERENCE_PROVIDER: 'catalog_cdc' }).SWARM_PRODUCT_REFERENCE_PROVIDER, 'catalog_cdc');
  assert.equal(dockerEnvironment({}, { SWARM_CATALOG_SYNC_REPLICAS: '0' }).SWARM_CATALOG_SYNC_REPLICAS, '0');
});

test('reference current-offer endpoint requires an explicit CDC live deployment flag', () => {
  const app = readFileSync(fileURLToPath(new URL('../infra/swarm-app.yml', import.meta.url)), 'utf8');
  assert.match(app, /DASHBOARD_ENABLE_CDC_REFERENCE_OFFER: \$\{SWARM_ENABLE_CDC_REFERENCE_OFFER:-false\}/);
  const base = { SWARM_TLS_MODE: 'local', SWARM_PUBLIC_DOMAIN: 'demo.example.com',
    SWARM_ADMIN_EMAIL: 'admin@example.com', SWARM_TRAEFIK_IMAGE: 'traefik:v3.6.0@sha256:' + 'a'.repeat(64),
    SWARM_MIGRATION_MODE: 'PARALLEL_LIVE', SWARM_PRODUCT_REFERENCE_PROVIDER: 'catalog_cdc' };
  assert.equal(validateSwarmApp(base).cdcReferenceOffer, false);
  assert.equal(validateSwarmApp({ ...base, SWARM_ENABLE_CDC_REFERENCE_OFFER: 'true' }).cdcReferenceOffer, true);
  assert.throws(() => validateSwarmApp({ ...base, SWARM_ENABLE_CDC_REFERENCE_OFFER: 'maybe' }),
    /SWARM_ENABLE_CDC_REFERENCE_OFFER/);
  assert.throws(() => validateSwarmApp({ ...base, SWARM_PRODUCT_REFERENCE_PROVIDER: 'admin_api',
    SWARM_ENABLE_CDC_REFERENCE_OFFER: 'true' }), /requires PARALLEL_LIVE and catalog_cdc/);
});

test('order-v2 current-state read path requires an explicit scoped deployment', () => {
  const app = readFileSync(fileURLToPath(new URL('../infra/swarm-app.yml', import.meta.url)), 'utf8');
  assert.match(app, /DASHBOARD_ENABLE_CDC_REFERENCE_CANDIDATE: \$\{SWARM_ENABLE_CDC_REFERENCE_CANDIDATE:-false\}/);
  assert.match(app, /DASHBOARD_ENABLE_CDC_REFERENCE_ACTIVE: \$\{SWARM_ENABLE_CDC_REFERENCE_ACTIVE:-false\}/);
  for (const key of ['SOURCE_ID', 'COVERAGE_EPOCH_ID', 'ACTIVATION_AT']) {
    assert.ok(app.includes('CDC_REFERENCE_' + key + ': ${SWARM_CDC_REFERENCE_' + key + ':-}'));
  }
  const base = { SWARM_TLS_MODE: 'local', SWARM_PUBLIC_DOMAIN: 'demo.example.com',
    SWARM_ADMIN_EMAIL: 'admin@example.com', SWARM_TRAEFIK_IMAGE: 'traefik:v3.6.0@sha256:' + 'a'.repeat(64),
    SWARM_MIGRATION_MODE: 'PARALLEL_LIVE' };
  assert.equal(validateSwarmApp(base).cdcReferenceCandidate, false);
  const enabled = { ...base, SWARM_ENABLE_CDC_REFERENCE_CANDIDATE: 'true',
    SWARM_CDC_REFERENCE_SOURCE_ID: 'medusa-reference',
    SWARM_CDC_REFERENCE_COVERAGE_EPOCH_ID: 'cdc11_order_epoch1',
    SWARM_CDC_REFERENCE_ACTIVATION_AT: '2026-10-30T04:29:31.042Z' };
  assert.equal(validateSwarmApp(enabled).cdcReferenceCandidate, true);
  assert.equal(validateSwarmApp({ ...enabled, SWARM_ENABLE_CDC_REFERENCE_ACTIVE: 'true' }).cdcReferenceActive, true);
  assert.throws(() => validateSwarmApp({ ...base, SWARM_ENABLE_CDC_REFERENCE_ACTIVE: 'true' }),
    /requires the scoped candidate/);
  assert.throws(() => validateSwarmApp({ ...enabled, SWARM_MIGRATION_MODE: 'OFFLINE_DEMO' }), /PARALLEL_LIVE/);
  assert.throws(() => validateSwarmApp({ ...enabled, SWARM_CDC_REFERENCE_COVERAGE_EPOCH_ID: '' }), /coverage epoch/);
  assert.throws(() => validateSwarmApp({ ...enabled, SWARM_CDC_REFERENCE_ACTIVATION_AT: '2026-10-30' }), /activation instant/);
});

test('monitoring stays opt-in and joins the same Swarm stack when enabled', () => {
  assert.deepEqual(stackFilesForCommand('deploy-app', { tlsMode: 'local' }, 'PARALLEL_LIVE', true).map(file => file.split(/[\\/]/).at(-1)),
    ['swarm-stack.yml', 'swarm-workers.yml', 'swarm-app.yml', 'swarm-live.yml', 'swarm-monitoring.yml', 'swarm-edge-local.yml']);
});

test('Qdrant knowledge overlay is opt-in, private and rebuildable', () => {
  assert.deepEqual(stackFilesForCommand('deploy-app', { tlsMode: 'local' }, 'PARALLEL_LIVE', false, true)
    .map(file => file.split(/[\\/]/).at(-1)),
  ['swarm-stack.yml', 'swarm-workers.yml', 'swarm-app.yml', 'swarm-live.yml',
    'swarm-knowledge.yml', 'swarm-edge-local.yml']);
  const knowledge = readFileSync(fileURLToPath(new URL('../infra/swarm-knowledge.yml', import.meta.url)), 'utf8');
  assert.match(knowledge, /qdrant:[\s\S]*?node\.labels\.funnelmetry\.stateful == true/);
  assert.match(knowledge, /qdrant:[\s\S]*?healthcheck:[\s\S]*?\/readyz/);
  assert.match(knowledge, /knowledge-index:[\s\S]*?sync-metadata-vectors\.mjs/);
  assert.match(knowledge, /DASHBOARD_ENABLE_VECTOR_KNOWLEDGE: 'true'/);
  assert.doesNotMatch(knowledge, /\bports:/);
});

test('single-node Kafka controller registration does not depend on its own Swarm VIP', () => {
  const stack = readFileSync(fileURLToPath(new URL('../infra/swarm-stack.yml', import.meta.url)), 'utf8');
  assert.match(stack, /KAFKA_CONTROLLER_QUORUM_VOTERS: 1@127\.0\.0\.1:9093/);
  assert.match(stack, /echo > \/dev\/tcp\/127\.0\.0\.1\/9092/);
  assert.match(stack, /HANDOFF_RAW_PARTITIONS: \$\{SWARM_RAW_PARTITIONS:-1\}/);
});

test('stateful Swarm tasks restart after a clean Docker shutdown', () => {
  const stack = readFileSync(fileURLToPath(new URL('../infra/swarm-stack.yml', import.meta.url)), 'utf8');
  assert.match(stack, /x-stateful-deploy:[\s\S]*?restart_policy:\s*\n(?:\s*#[^\n]*\n)*\s*condition: any/);
});

test('Swarm API readiness probes worker health endpoints instead of returning NOT_CONFIGURED', () => {
  const app = readFileSync(fileURLToPath(new URL('../infra/swarm-app.yml', import.meta.url)), 'utf8');
  const workers = readFileSync(fileURLToPath(new URL('../infra/swarm-workers.yml', import.meta.url)), 'utf8');
  assert.match(app, /DASHBOARD_WORKER_HEALTH_ENABLED: 'true'/);
  assert.match(app, /type: tmpfs\s+target: \/tmp\s+tmpfs:\s+size: 33554432/);
  assert.match(workers, /WORKER_HEALTH_PORT: '32110'/);
  assert.match(workers, /CANONICAL_NORMALIZER_INSTANCE_ID_MODE: \$\{SWARM_NORMALIZER_ID_MODE:-explicit\}/);
  assert.match(workers, /CANONICAL_NORMALIZER_TRANSACTION_BATCH_SIZE: \$\{SWARM_NORMALIZER_TRANSACTION_BATCH_SIZE:-64\}/);
  assert.match(workers, /canonical-normalizer:[\s\S]*?image: \$\{SWARM_NORMALIZER_IMAGE:\?Pin the Normalizer image digest\}/);
});

test('continuous Swarm workers have liveness-only healthchecks; jobs and scheduler do not inherit them', () => {
  const workers = readFileSync(fileURLToPath(new URL('../infra/swarm-workers.yml', import.meta.url)), 'utf8');
  assert.match(workers, /x-worker-liveness: &worker-liveness[\s\S]*?\/healthz/);
  assert.doesNotMatch(workers.match(/x-worker-liveness: &worker-liveness([\s\S]*?)(?=\nservices:)/)?.[1] ?? '', /\/readyz/);
  const serviceBlock = name => workers.match(new RegExp(`\\n  ${name}:\\n([\\s\\S]*?)(?=\\n  [a-z-]+:\\n|$)`))?.[1] ?? '';
  for (const name of ['canonical-normalizer', 'canonical-ledger-writer', 'ingress-telemetry-writer',
    'traffic-source-writer', 'journey-processor', 'funnel-processor', 'kpi-projector']) {
    assert.match(serviceBlock(name), /healthcheck: \*worker-liveness/, name);
  }
  for (const name of ['profile-publisher', 'funnel-maturity-scheduler']) {
    assert.doesNotMatch(serviceBlock(name), /healthcheck:/, name);
  }
});

test('long-running Swarm workers replace even clean exits; one-shot publisher does not restart', () => {
  const workers = readFileSync(fileURLToPath(new URL('../infra/swarm-workers.yml', import.meta.url)), 'utf8');
  const fixture = readFileSync(fileURLToPath(new URL('../tools/swarm-controllers/fixtures/swarm-scale.yml', import.meta.url)), 'utf8');
  assert.match(workers, /x-worker: &worker[\s\S]*?restart_policy: \{condition: any, delay: 5s\}/);
  assert.match(workers, /profile-publisher:[\s\S]*?restart_policy: \{condition: none\}/);
  assert.match(fixture, /canonical-normalizer:[\s\S]*?restart_policy: \{condition: any, delay: 5s\}/);
});

test('continuous workers reserve 256 MiB and cap at 516 MiB; one-shot job stays separate', () => {
  const workers = readFileSync(fileURLToPath(new URL('../infra/swarm-workers.yml', import.meta.url)), 'utf8');
  const common = workers.match(/x-worker: &worker([\s\S]*?)(?=\nx-worker-liveness:)/)?.[1] ?? '';
  const oneShot = workers.match(/\n  profile-publisher:([\s\S]*?)(?=\n  canonical-normalizer:)/)?.[1] ?? '';
  assert.match(common, /reservations: \{cpus: '0\.10', memory: 256M\}/);
  assert.match(common, /limits: \{cpus: '1\.00', memory: 516M\}/);
  assert.match(oneShot, /reservations: \{cpus: '0\.10', memory: 128M\}/);
  assert.match(oneShot, /limits: \{cpus: '0\.50', memory: 256M\}/);
});

test('continuous app, edge and live services replace clean exits without treating feed readiness as liveness', () => {
  const app = readFileSync(fileURLToPath(new URL('../infra/swarm-app.yml', import.meta.url)), 'utf8');
  const live = readFileSync(fileURLToPath(new URL('../infra/swarm-live.yml', import.meta.url)), 'utf8');
  const localEdge = readFileSync(fileURLToPath(new URL('../infra/swarm-edge-local.yml', import.meta.url)), 'utf8');
  const acmeEdge = readFileSync(fileURLToPath(new URL('../infra/swarm-edge-acme.yml', import.meta.url)), 'utf8');
  assert.equal((app.match(/restart_policy: \{condition: any, delay: 5s\}/g) ?? []).length, 2);
  assert.equal((live.match(/restart_policy: \{condition: any, delay: 10s\}/g) ?? []).length, 2);
  assert.match(live, /source-connector:[\s\S]*?healthcheck:[\s\S]*?\/healthz/);
  assert.doesNotMatch(live.match(/source-connector:([\s\S]*?)(?=\n  catalog-sync:)/)?.[1] ?? '', /\/readyz/);
  for (const edge of [localEdge, acmeEdge]) assert.match(edge, /restart_policy: \{condition: any, delay: 5s\}/);
});

test('Docker environment renders only selected deploy keys and strips inherited secrets', () => {
  const env = dockerEnvironment({ Path: 'C:\\bin', HANDOFF_DB_PASSWORD: 'old', GH_TOKEN: 'sensitive' },
    { SWARM_STACK_NAME: 'fresh-stack', SWARM_DB_PASSWORD: 'new-secret', SWARM_RAW_PARTITIONS: '2',
      SWARM_NORMALIZER_ID_MODE: 'container', SWARM_NORMALIZER_TRANSACTION_BATCH_SIZE: '32' });
  assert.equal(env.Path, 'C:\\bin');
  assert.equal(env.SWARM_STACK_NAME, 'fresh-stack');
  assert.equal(env.SWARM_RAW_PARTITIONS, '2');
  assert.equal(env.HANDOFF_RAW_PARTITIONS, undefined);
  assert.equal(env.SWARM_NORMALIZER_ID_MODE, 'container');
  assert.equal(env.SWARM_NORMALIZER_TRANSACTION_BATCH_SIZE, '32');
  assert.equal(env.HANDOFF_DB_PASSWORD, undefined);
  assert.equal(env.GH_TOKEN, undefined);
  assert.equal(env.SWARM_DB_PASSWORD, undefined);
  assert.equal(env.SWARM_NORMALIZER_IMAGE, undefined);
});

test('normalizer rollout image is rendered independently, with Workers as default', () => {
  const workers = 'ghcr.io/example/workers@sha256:' + 'a'.repeat(64);
  const next = 'ghcr.io/example/workers@sha256:' + 'b'.repeat(64);
  assert.equal(dockerEnvironment({}, { SWARM_WORKERS_IMAGE: workers }).SWARM_NORMALIZER_IMAGE, workers);
  assert.equal(dockerEnvironment({}, { SWARM_WORKERS_IMAGE: workers, SWARM_NORMALIZER_IMAGE: '  ' }).SWARM_NORMALIZER_IMAGE, workers);
  const env = dockerEnvironment({}, { SWARM_WORKERS_IMAGE: workers, SWARM_NORMALIZER_IMAGE: next });
  assert.equal(env.SWARM_WORKERS_IMAGE, workers);
  assert.equal(env.SWARM_NORMALIZER_IMAGE, next);
});

test('Swarm DB secret must be new, independent and single-line', () => {
  const secret = 'a'.repeat(24);
  assert.equal(validateDbSecret({ SWARM_DB_PASSWORD: secret, HANDOFF_DB_PASSWORD: 'other' }), secret);
  assert.throws(() => validateDbSecret({ SWARM_DB_PASSWORD: secret, HANDOFF_DB_PASSWORD: secret }), /independent/);
  assert.throws(() => validateDbSecret({ SWARM_DB_PASSWORD: 'short' }), /24/);
  assert.throws(() => validateDbSecret({ SWARM_DB_PASSWORD: secret + '\n' }), /single-line/);
});

test('Swarm app secrets are independent and never passed to stack renderer', () => {
  const values = { SWARM_JWT_SECRET: 'j'.repeat(32), SWARM_ADMIN_PASSWORD: 'a'.repeat(16),
    HANDOFF_JWT_SECRET: 'old-jwt', HANDOFF_ADMIN_PASSWORD: 'old-admin',
    SWARM_PUBLIC_DOMAIN: 'demo.example.com', SWARM_ADMIN_EMAIL: 'admin@example.com' };
  assert.deepEqual(validateAppSecrets(values), { jwt: values.SWARM_JWT_SECRET, admin: values.SWARM_ADMIN_PASSWORD });
  const rendered = dockerEnvironment({}, values);
  assert.equal(rendered.SWARM_PUBLIC_DOMAIN, values.SWARM_PUBLIC_DOMAIN);
  assert.equal(rendered.SWARM_ADMIN_EMAIL, values.SWARM_ADMIN_EMAIL);
  assert.equal(rendered.SWARM_JWT_SECRET, undefined);
  assert.equal(rendered.SWARM_ADMIN_PASSWORD, undefined);
  assert.throws(() => validateAppSecrets({ ...values, SWARM_JWT_SECRET: values.HANDOFF_JWT_SECRET }), /32/);
  assert.throws(() => validateAppSecrets({ ...values, HANDOFF_ADMIN_PASSWORD: values.SWARM_ADMIN_PASSWORD }), /independent/);
});

test('local TLS private key path cannot be inside repository', () => {
  assert.throws(() => validateTlsFilePath('relative/key.pem'), /absolute/);
  assert.throws(() => validateTlsFilePath(fileURLToPath(new URL('../infra/swarm-stack.yml', import.meta.url))), /outside the repository/);
});
