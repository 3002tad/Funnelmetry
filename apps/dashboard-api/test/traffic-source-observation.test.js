import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import jwt from 'jsonwebtoken';

Object.assign(process.env, { PORT: '32000', CORS_ORIGIN_DASHBOARD: 'http://localhost:5180',
  JWT_SECRET: 'traffic-observation-test-only-secret', JWT_EXPIRES: '1h',
  DASHBOARD_ADMIN_EMAIL: 'admin@example.test', DASHBOARD_ADMIN_PASSWORD: 'test-only-password',
  POSTGRES_HOST: 'unused', POSTGRES_PORT: '5432', POSTGRES_DB: 'test',
  POSTGRES_USER: 'test', POSTGRES_PASSWORD: 'test' });
const { createAdminV2Router } = await import('../src/routes/admin-v2.js');
const { TRAFFIC_SOURCE_INPUT_SQL, summarizeTrafficSourceInput } =
  await import('../src/lib/traffic-source-observation.js');

test('traffic input observation has event grain and never selects or returns UTM/hash', () => {
  assert.match(TRAFFIC_SOURCE_INPUT_SQL, /WHERE source_id=\$1 AND source_event_id=\$2/);
  assert.ok(!/utm_source_hash|raw_body|source_payload/.test(TRAFFIC_SOURCE_INPUT_SQL));
  const result = summarizeTrafficSourceInput({ source_event_type: 'behavior.page_viewed',
    source_schema_version: '1.0', raw_record_id: 'ing_1', received_at: '2026-10-12T01:00:00Z',
    recorded_at: '2026-10-12T01:00:01Z', utm_source_state: 'PRESENT', synthetic: false,
    utm_source_hash: 'secret-hash', raw_body: 'secret-body' });
  assert.equal(result.state, 'PRESENT');
  assert.ok(!JSON.stringify(result).includes('secret'));
  assert.equal(summarizeTrafficSourceInput(null).state, 'NOT_OBSERVED');
  assert.throws(() => summarizeTrafficSourceInput({ utm_source_state: 'OTHER' }));
});

test('traffic input API is live-admin only and failure does not imply absence', async () => {
  let role = 'super_admin', version = 0, fail = false;
  let afterQuery = () => {};
  const calls = [];
  const execute = async (sql, params) => {
    if (sql.startsWith('SELECT role')) return [{ role, is_active: true, session_version: version }];
    calls.push({ sql, params });
    if (fail) throw Error('private database failure');
    afterQuery();
    return [{ source_event_type: 'behavior.page_viewed', source_schema_version: '1.0',
      raw_record_id: 'ing_1', received_at: '2026-10-12T01:00:00Z',
      recorded_at: '2026-10-12T01:00:01Z', utm_source_state: 'PRESENT', synthetic: false,
      utm_source_hash: 'must-not-leak' }];
  };
  const app = express(); app.use(createAdminV2Router(execute));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const token = jwt.sign({ sub: 'admin', role: 'super_admin', session_version: 0 }, process.env.JWT_SECRET);
  const get = (suffix = '?source_id=shop&event_id=browser%27--', auth = true) =>
    fetch(`http://127.0.0.1:${server.address().port}/api/v2/admin/traffic-source-input${suffix}`,
      { headers: auth ? { Authorization: `Bearer ${token}` } : {} });
  try {
    assert.equal((await get(undefined, false)).status, 401);
    assert.equal((await get('?source_id=shop')).status, 400);
    assert.equal((await get('?source_id=shop&event_id=e&raw=true')).status, 400);
    assert.equal(calls.length, 0);
    const response = await get();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const body = await response.json();
    assert.equal(body.state, 'PRESENT');
    assert.equal(body.attribution_verified, false);
    assert.equal(body.historical_coverage_verified, false);
    assert.equal(body.scope, 'retained_raw_kafka_projection');
    assert.ok(!JSON.stringify(body).includes('must-not-leak'));
    assert.deepEqual(calls[0].params, ['shop', "browser'--"]);
    assert.ok(!calls[0].sql.includes("browser'--"));
    role = 'analyst'; assert.equal((await get()).status, 403);
    role = 'super_admin'; afterQuery = () => { role = 'analyst'; };
    assert.equal((await get()).status, 403);
    role = 'super_admin'; afterQuery = () => { version++; };
    assert.equal((await get()).status, 401);
    version = 0; afterQuery = () => {}; fail = true;
    const failure = await get();
    assert.equal(failure.status, 503);
    assert.deepEqual(await failure.json(), { error: 'traffic_source_input_unavailable' });
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
