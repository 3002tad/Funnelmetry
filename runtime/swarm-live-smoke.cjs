// Run through stdin inside the PARALLEL_LIVE API task. No fixture injection.
// A temporary analyst account is disabled in finally; credentials stay private.
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { readFileSync } = require('node:fs');

const base = 'http://127.0.0.1:32000';
async function call(path, { method = 'GET', token, body } = {}) {
  const response = await fetch(base + path, { method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: response.status, value: await response.json().catch(() => null) };
}
async function expect(path, token) {
  const result = await call(path, { token });
  assert.equal(result.status, 200, `${path} returned ${result.status}`);
  console.log(`PASS ${path}: 200`);
  return result.value;
}
async function main() {
  assert.equal(process.env.SWARM_LIVE_SMOKE_ACK, 'PARALLEL_LIVE_READONLY');
  await expect('/health');
  const admin = await call('/api/auth/login', { method: 'POST', body: {
    email: process.env.DASHBOARD_ADMIN_EMAIL,
    password: readFileSync('/run/secrets/admin_password', 'utf8').trim(),
  } });
  assert.equal(admin.status, 200);
  const adminToken = admin.value?.token;
  assert.ok(adminToken);
  await expect('/api/auth/me', adminToken);
  const registry = await expect('/api/v2/admin/registry', adminToken);
  assert.ok(registry.items?.some(item => item.provider_enabled === true), 'Qwen provider not configured');
  const readiness = await expect('/api/v2/admin/worker-readiness', adminToken);
  assert.equal(readiness.workers?.length, 7);
  assert.deepEqual(readiness.workers.filter(w => w.status !== 'READY' || !w.ready), []);
  await expect('/api/v2/admin/kafka-lag', adminToken);

  const suffix = randomBytes(8).toString('hex');
  const analystPassword = randomBytes(24).toString('base64url');
  const created = await call('/api/users', { method: 'POST', token: adminToken,
    body: { email: `swarm-live-smoke-${suffix}@funnelmetry.invalid`, password: analystPassword, role: 'analyst' } });
  assert.equal(created.status, 201);
  const analystId = created.value?.user?.id;
  assert.ok(analystId);
  try {
    const analyst = await call('/api/auth/login', { method: 'POST', body: {
      email: `swarm-live-smoke-${suffix}@funnelmetry.invalid`, password: analystPassword } });
    assert.equal(analyst.status, 200);
    const token = analyst.value?.token;
    assert.ok(token);
    await expect('/api/v2/catalog', token);
    await expect('/api/v2/analytics/overview?source_id=medusa-reference', token);
    await expect('/api/v2/analytics/events?source_id=medusa-reference', token);
    await expect('/api/v2/analytics/data-health?source_id=medusa-reference', token);
    await expect('/api/v2/analytics/traffic-source-registry?source_id=medusa-reference', token);
    await expect('/api/v2/evidence', token);
    if (process.env.SWARM_LIVE_TEST_QWEN === 'true') {
      const chat = await call('/api/v2/chat', { method: 'POST', token, body: {
        message: 'Có bao nhiêu sự kiện order.placed trong khoảng thời gian này?',
        source_id: 'medusa-reference',
        from: '2026-09-01T00:00:00.000Z', to: '2026-10-14T00:00:00.000Z',
      } });
      assert.equal(chat.status, 200, `Qwen chat returned ${chat.status}: ${chat.value?.error || 'unknown'}`);
      assert.ok(['generated', 'no_evidence'].includes(chat.value?.status));
      console.log(`PASS Qwen chat: ${chat.value.status}; model=${chat.value.model || 'deterministic'}`);
    }
  } finally {
    const disabled = await call(`/api/users/${analystId}`, { method: 'DELETE', token: adminToken });
    assert.equal(disabled.status, 200, 'temporary analyst was not disabled');
    console.log('PASS temporary analyst disabled');
  }
}
main().catch(error => { console.error(`FAIL live API smoke: ${error.message}`); process.exitCode = 1; });
