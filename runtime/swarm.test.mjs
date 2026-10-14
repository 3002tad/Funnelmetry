import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dockerEnvironment, stackDeployArgs, stackFilesForCommand, validateAppSecrets, validateDbSecret, validateTlsFilePath } from './swarm.mjs';

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
});

test('parallel-live candidate includes connector/catalog/AI overlay before edge', () => {
  assert.deepEqual(stackFilesForCommand('deploy-app', { tlsMode: 'local' }, 'PARALLEL_LIVE').map(file => file.split(/[\\/]/).at(-1)),
    ['swarm-stack.yml', 'swarm-workers.yml', 'swarm-app.yml', 'swarm-live.yml', 'swarm-edge-local.yml']);
});

test('monitoring stays opt-in and joins the same Swarm stack when enabled', () => {
  assert.deepEqual(stackFilesForCommand('deploy-app', { tlsMode: 'local' }, 'PARALLEL_LIVE', true).map(file => file.split(/[\\/]/).at(-1)),
    ['swarm-stack.yml', 'swarm-workers.yml', 'swarm-app.yml', 'swarm-live.yml', 'swarm-monitoring.yml', 'swarm-edge-local.yml']);
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
