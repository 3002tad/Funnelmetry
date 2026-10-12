import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { parseProfiles, profileArgs, validateConfig } from './deploy.mjs';

const template = parseEnv(await readFile(new URL('deploy.env.example', import.meta.url), 'utf8'));
const base = {
  ...template,
  HANDOFF_DB_PASSWORD: 'fixture-db-only',
  HANDOFF_JWT_SECRET: 'fixture-jwt-only',
  HANDOFF_ADMIN_PASSWORD: 'fixture-admin-only',
};

test('core deployment requires no external credentials and selects no profile', () => {
  assert.deepEqual(validateConfig(base), []);
  assert.deepEqual(profileArgs([]), []);
});

test('all declared capabilities require independent credentials and explicit live boundary', () => {
  const full = {
    ...base,
    HANDOFF_DEPLOY_PROFILES: 'live,catalog,monitoring',
    HANDOFF_LIVE_ACK: 'FRESH_PARALLEL_LIVE',
    HANDOFF_CONNECTOR_ID: 'teammate-sandbox',
    HANDOFF_FEED_URL: 'https://source.example.test/v1/feed',
    HANDOFF_FEED_TOKEN: 'fixture-feed-only',
    HANDOFF_FEED_ID: 'feed-fixture',
    HANDOFF_INITIAL_AFTER_SEQ: '0',
    HANDOFF_CATALOG_URL: 'https://medusa.example.test',
    HANDOFF_CATALOG_KEY: 'fixture-catalog-only',
    HANDOFF_ENABLE_QWEN: 'true',
    HANDOFF_DASHSCOPE_API_KEY: 'fixture-qwen-only',
    HANDOFF_MONITORING_ENABLED: 'true',
  };
  assert.deepEqual(validateConfig(full), ['live', 'catalog', 'monitoring']);
  assert.deepEqual(profileArgs(['live', 'catalog']), ['--profile', 'live', '--profile', 'catalog']);
  for (const key of ['HANDOFF_FEED_TOKEN', 'HANDOFF_CATALOG_KEY', 'HANDOFF_DASHSCOPE_API_KEY']) {
    assert.throws(() => validateConfig({ ...full, [key]: '' }), new RegExp(key));
  }
  assert.throws(() => validateConfig({ ...full, HANDOFF_LIVE_ACK: '' }), /LIVE_ACK/);
  assert.throws(() => validateConfig({ ...full, HANDOFF_FEED_URL: 'http:\/\/source.example.test' }), /HTTPS/);
  assert.throws(() => validateConfig({ ...full, HANDOFF_INITIAL_AFTER_SEQ: '-1' }), /AFTER_SEQ/);
  assert.throws(() => validateConfig({ ...full, HANDOFF_MONITORING_ENABLED: 'false' }), /monitoring profile/);
  assert.throws(() => validateConfig({ ...full, MONITORING_GRAFANA_PORT: full.HANDOFF_UI_PORT }), /GRAFANA_PORT/);
  assert.throws(() => validateConfig({ ...full, HANDOFF_IMAGE_POLICY: 'always' }), /HANDOFF_API_IMAGE/);
});

test('profile list rejects typo and duplicate to avoid a partial deployment', () => {
  assert.throws(() => parseProfiles('live,live'), /at most once/);
  assert.throws(() => parseProfiles('live,analytics'), /at most once/);
  assert.throws(() => validateConfig({ ...base, COMPOSE_PROFILES: 'live' }), /COMPOSE_/);
});
