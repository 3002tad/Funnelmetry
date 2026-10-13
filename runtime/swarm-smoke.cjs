// Run inside the isolated API container through stdin: docker exec -i <id> node -
// Reads the candidate-only admin secret in-container; never prints credentials.
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { readFileSync } = require('node:fs');

const base = 'http://127.0.0.1:32000';
const source = 'medusa-reference';

async function request(path, { method = 'GET', token, body } = {}) {
  const response = await fetch(base + path, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, value: await response.json().catch(() => null) };
}

async function expect(path, token, status = 200) {
  const result = await request(path, { token });
  assert.equal(result.status, status, `${path} returned ${result.status}`);
  console.log(`PASS ${path}: ${result.status}`);
  return result.value;
}

async function main() {
  assert.equal(process.env.SWARM_SMOKE_ACK, 'OFFLINE_DEMO_INTERNAL', 'isolated smoke acknowledgement required');
  const password = readFileSync('/run/secrets/admin_password', 'utf8').trim();
  await expect('/health');
  const admin = await request('/api/auth/login', { method: 'POST',
    body: { email: process.env.DASHBOARD_ADMIN_EMAIL, password } });
  assert.equal(admin.status, 200, `admin login returned ${admin.status}`);
  const adminToken = admin.value?.token;
  assert.ok(adminToken, 'admin login did not return a token');
  console.log('PASS admin login: 200');
  await expect('/api/auth/me', adminToken);
  await expect('/api/v2/admin/registry', adminToken);
  const readiness = await expect('/api/v2/admin/worker-readiness', adminToken);
  assert.equal(readiness.workers?.length, 7, `worker probe unavailable: ${readiness.reason || 'unknown'}`);
  const notReady = readiness.workers.filter(worker => worker.status !== 'READY' || worker.ready !== true);
  assert.deepEqual(notReady, [], `workers not READY: ${notReady.map(worker => `${worker.worker}:${worker.status}`).join(', ')}`);
  console.log('PASS all 7 worker readiness probes: READY');
  await expect('/api/v2/admin/kafka-lag', adminToken);

  const suffix = randomBytes(8).toString('hex');
  const analystEmail = `swarm-smoke-${suffix}@funnelmetry.invalid`;
  const analystPassword = randomBytes(24).toString('base64url');
  const created = await request('/api/users', { method: 'POST', token: adminToken,
    body: { email: analystEmail, password: analystPassword, role: 'analyst' } });
  assert.equal(created.status, 201, `analyst create returned ${created.status}`);
  const analystId = created.value?.user?.id;
  assert.ok(analystId, 'analyst create did not return an id');
  console.log('PASS temporary analyst create: 201');
  try {
    const analyst = await request('/api/auth/login', { method: 'POST',
      body: { email: analystEmail, password: analystPassword } });
    assert.equal(analyst.status, 200, `analyst login returned ${analyst.status}`);
    const token = analyst.value?.token;
    assert.ok(token, 'analyst login did not return a token');
    console.log('PASS analyst login: 200');
    await expect('/api/v2/catalog', token);
    const overview = await expect(`/api/v2/analytics/overview?source_id=${source}`, token);
    if (process.env.SWARM_SMOKE_EXPECT_CONVERSION === 'true') {
      const conversion = overview.profiles?.find(profile => profile.funnel_profile_id === 'commerce-conversion');
      assert.ok(Number(conversion?.observed_converted) >= 1, 'API overview did not expose a converted commerce funnel');
      console.log('PASS API overview exposes converted commerce funnel');
    }
    await expect(`/api/v2/analytics/journeys?source_id=${source}`, token);
    await expect(`/api/v2/analytics/events?source_id=${source}`, token);
    await expect(`/api/v2/analytics/data-health?source_id=${source}`, token);
    await expect(`/api/v2/analytics/traffic-source-registry?source_id=${source}`, token);
    await expect('/api/v2/evidence', token);
  } finally {
    const disabled = await request(`/api/users/${analystId}`, { method: 'DELETE', token: adminToken });
    assert.equal(disabled.status, 200, `temporary analyst disable returned ${disabled.status}`);
    console.log('PASS temporary analyst disabled: 200');
  }
}

main().catch(error => { console.error(`FAIL Swarm internal API smoke: ${error.message}`); process.exitCode = 1; });
