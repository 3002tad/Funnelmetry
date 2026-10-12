import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const exec = promisify(execFile);
const docker = process.env.TEST_COMPOSE_EXE;
const args = ['compose', '--env-file', 'runtime/deploy.env.example', '-f', 'infra/compose.yaml'];
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  !/^(HANDOFF_|MONITORING_|COMPOSE_)/i.test(key)));
Object.assign(env, {
  HANDOFF_DB_PASSWORD: 'test-placeholder-only',
  HANDOFF_JWT_SECRET: 'test-placeholder-only',
  HANDOFF_ADMIN_PASSWORD: 'test-placeholder-only',
});

test('unified template keeps isolated build defaults and no real credentials', async () => {
  const source = await readFile(join(root, 'runtime/deploy.env.example'), 'utf8');
  const pairs = Object.fromEntries(source.split(/\r?\n/).filter(line => /^[A-Z][A-Z0-9_]*=/.test(line))
    .map(line => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]));
  assert.equal(pairs.HANDOFF_IMAGE_POLICY, 'build');
  assert.equal(pairs.HANDOFF_ENABLE_POLARS, 'true');
  assert.equal(pairs.HANDOFF_ENABLE_QWEN, 'false');
  assert.equal(pairs.HANDOFF_DEPLOY_PROFILES, '');
  assert.equal(pairs.HANDOFF_LIVE_ACK, '');
  for (const key of ['HANDOFF_DB_PASSWORD', 'HANDOFF_JWT_SECRET', 'HANDOFF_ADMIN_PASSWORD',
    'HANDOFF_FEED_TOKEN', 'HANDOFF_CATALOG_KEY', 'HANDOFF_DASHSCOPE_API_KEY']) {
    assert.equal(pairs[key], '', key);
  }
});

test('default unified Compose starts core services and enabled internal tools only',
  { skip: !docker }, async () => {
    const { stdout } = await exec(docker, [...args, 'config', '--format', 'json'],
      { cwd: root, env, timeout: 30000, windowsHide: true });
    const services = JSON.parse(stdout).services;
    assert.equal(Object.keys(services).length, 15);
    for (const name of ['postgres', 'kafka', 'bootstrap', 'analytical-releases',
      'dashboard-api', 'dashboard-web', 'canonical-normalizer', 'canonical-ledger-writer',
      'ingress-telemetry-writer', 'journey-processor', 'funnel-processor',
      'funnel-maturity-scheduler', 'kpi-projector']) {
      assert.ok(services[name], name);
    }
    for (const name of ['source-connector', 'catalog-sync', 'monitoring-schema', 'prometheus', 'grafana']) {
      assert.equal(services[name], undefined, name);
    }
    const api = services['dashboard-api'];
    assert.equal(api.environment.DASHBOARD_ENABLE_POLARS, 'true');
    assert.equal(api.environment.DASHBOARD_ENABLE_ORDER_SUMMARY_STAGING, 'true');
    assert.equal(api.environment.DASHBOARD_ENABLE_ORDER_RANKING_STAGING, 'true');
    assert.equal(api.environment.DASHBOARD_ENABLE_PRODUCT_RANKING_STAGING, 'true');
    assert.equal(api.environment.DASHBOARD_ENABLE_QWEN, 'false');
    assert.equal(services['dashboard-web'].ports[0].host_ip, '127.0.0.1');
    assert.deepEqual(services['dashboard-web'].tmpfs, ['/tmp:rw,noexec,nosuid,size=32m']);
    assert.equal(api.pull_policy, 'build');
    assert.equal(api.build.context, root);
    assert.equal(api.build.dockerfile, 'infra/docker/dashboard-api.Dockerfile');
    assert.equal(services['dashboard-web'].build.context, root);
    assert.equal(services['dashboard-web'].build.dockerfile, 'infra/docker/dashboard-web.Dockerfile');
    assert.equal(services['funnel-maturity-scheduler'].environment.MATURITY_SCHEDULER_FINALIZATION_ENABLED, 'false');
  });

test('external integration profiles remain separately selectable in same YAML',
  { skip: !docker }, async () => {
    const { stdout } = await exec(docker,
      [...args, '--profile', 'live', '--profile', 'catalog', '--profile', 'monitoring', 'config', '--format', 'json'],
      { cwd: root, env, timeout: 30000, windowsHide: true });
    const services = JSON.parse(stdout).services;
    for (const name of ['source-connector', 'catalog-sync', 'monitoring-schema', 'prometheus', 'grafana']) {
      assert.ok(services[name], name);
    }
    assert.equal(services['source-connector'].environment.HANDOFF_LIVE_ACK, '');
    assert.equal(services.prometheus.volumes[0].source, join(root, 'infra/observability/prometheus.yml.example'));
    assert.equal(services.grafana.volumes[1].source, join(root, 'infra/observability/provisioning'));
    assert.equal(services['monitoring-schema'].volumes[0].source,
      join(root, 'infra/postgres/011_monitoring_credentials.sql'));
    assert.equal(services['monitoring-schema'].entrypoint[0], 'psql');
    assert.equal(services['monitoring-schema'].depends_on.bootstrap.condition, 'service_completed_successfully');
    assert.equal(services.prometheus.depends_on['monitoring-schema'].condition, 'service_completed_successfully');
  });
