import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import jwt from 'jsonwebtoken';

Object.assign(process.env, { PORT: '32000', CORS_ORIGIN_DASHBOARD: 'http://localhost:5180',
  JWT_SECRET: 'event-trace-test-only-secret', JWT_EXPIRES: '1h', DASHBOARD_ADMIN_EMAIL: 'admin@example.test',
  DASHBOARD_ADMIN_PASSWORD: 'test-only-password', POSTGRES_HOST: 'unused', POSTGRES_PORT: '5432',
  POSTGRES_DB: 'test', POSTGRES_USER: 'test', POSTGRES_PASSWORD: 'test' });
const { createAdminV2Router } = await import('../src/routes/admin-v2.js');
const { EVENT_TRACE_SQL, parseEventTraceQuery, summarizeEventTrace } = await import('../src/lib/event-trace.js');

test('event trace validates IDs, uses parameterized retained tables and never returns payload', () => {
  assert.deepEqual(parseEventTraceQuery({ source_id: ' medusa-reference ', event_id: "order'--" }),
    { sourceId: 'medusa-reference', eventId: "order'--" });
  assert.throws(() => parseEventTraceQuery({ source_id: 's', event_id: 'e', raw: 'true' }));
  assert.throws(() => parseEventTraceQuery({ source_id: 's', event_id: ['e'] }));
  assert.match(EVENT_TRACE_SQL, /canonicalization_latest_outcomes/);
  assert.match(EVENT_TRACE_SQL, /WHERE source_id=\$1 AND event_id=\$2/);
  assert.ok(!EVENT_TRACE_SQL.includes('raw_body'));
  const result = summarizeEventTrace({ receipt: { ingestion_id: 'ing_1', raw_body: 'private' },
    outcome: { status: 'normalized', raw_record_id: 'ing_1', canonical_event_id: 'can_1' },
    canonical: { canonical_event_id: 'can_1', raw_record_id: 'ing_1', data: { secret: 'private' } },
    journey: { journey_id: 'journey_1' }, funnel_applications: [], kpi_application: null });
  assert.equal(result.state, 'CANONICAL_JOURNEY_OBSERVED');
  assert.ok(!JSON.stringify(result).includes('private'));
  assert.equal(result.source_feed_verified, false);
  assert.equal(result.kafka_ack_verified, false);
});

test('event trace endpoint is admin-only, read-only, and rechecks grants after query', async () => {
  let role = 'super_admin';
  let version = 0;
  let fail = false;
  let afterQuery = () => {};
  const calls = [];
  const execute = async (sql, params) => {
    if (sql.startsWith('SELECT role')) return [{ role, is_active: true, session_version: version }];
    calls.push({ sql, params });
    if (fail) throw Error('secret database detail');
    afterQuery();
    return [{ receipt: { ingestion_id: 'ing_1' }, outcome: null, canonical: null,
      journey: null, funnel_applications: [], kpi_application: null }];
  };
  const app = express(); app.use(createAdminV2Router(execute));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const token = jwt.sign({ sub: 'admin', role: 'super_admin', session_version: 0 }, process.env.JWT_SECRET);
  const get = (suffix = '?source_id=shop&event_id=order%27--', auth = true) =>
    fetch(`http://127.0.0.1:${server.address().port}/api/v2/admin/event-trace${suffix}`,
      { headers: auth ? { Authorization: `Bearer ${token}` } : {} });
  try {
    assert.equal((await get(undefined, false)).status, 401);
    assert.equal((await get('?source_id=shop')).status, 400);
    assert.equal((await get('?source_id=shop&event_id=e&url=http://evil')).status, 400);
    assert.equal(calls.length, 0);
    const response = await get();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const body = await response.json();
    assert.equal(body.state, 'WAITING_FOR_OUTCOME');
    assert.equal(body.kafka_ack_verified, false);
    assert.deepEqual(calls[0].params, ['shop', "order'--"]);
    assert.ok(!calls[0].sql.includes("order'--"));
    role = 'analyst'; assert.equal((await get()).status, 403);
    role = 'super_admin'; afterQuery = () => { role = 'analyst'; };
    assert.equal((await get()).status, 403);
    role = 'super_admin'; afterQuery = () => { version++; };
    assert.equal((await get()).status, 401);
    version = 0; afterQuery = () => {}; fail = true;
    const failure = await get(); assert.equal(failure.status, 503);
    assert.deepEqual(await failure.json(), { error: 'event_trace_unavailable' });
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
