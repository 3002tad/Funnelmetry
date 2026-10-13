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

test('single-node Kafka controller registration does not depend on its own Swarm VIP', () => {
  const stack = readFileSync(fileURLToPath(new URL('../infra/swarm-stack.yml', import.meta.url)), 'utf8');
  assert.match(stack, /KAFKA_CONTROLLER_QUORUM_VOTERS: 1@127\.0\.0\.1:9093/);
  assert.match(stack, /echo > \/dev\/tcp\/127\.0\.0\.1\/9092/);
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
});

test('Docker environment renders only selected deploy keys and strips inherited secrets', () => {
  const env = dockerEnvironment({ Path: 'C:\\bin', HANDOFF_DB_PASSWORD: 'old', GH_TOKEN: 'sensitive' },
    { SWARM_STACK_NAME: 'fresh-stack', SWARM_DB_PASSWORD: 'new-secret', HANDOFF_RAW_PARTITIONS: '2' });
  assert.equal(env.Path, 'C:\\bin');
  assert.equal(env.SWARM_STACK_NAME, 'fresh-stack');
  assert.equal(env.HANDOFF_RAW_PARTITIONS, '2');
  assert.equal(env.HANDOFF_DB_PASSWORD, undefined);
  assert.equal(env.GH_TOKEN, undefined);
  assert.equal(env.SWARM_DB_PASSWORD, undefined);
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
