import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveSecretFiles } from './swarm-entrypoint.mjs';

test('secret file adapter maps only allowlisted mounted paths and does not mutate input', async () => {
  const input = { POSTGRES_PASSWORD_FILE: '/run/secrets/db_password', PORT: '32000' };
  const mapped = await resolveSecretFiles(input, async path => {
    assert.equal(path, '/run/secrets/db_password');
    return 'long-demo-secret\n';
  });
  assert.equal(mapped.POSTGRES_PASSWORD, 'long-demo-secret');
  assert.equal(mapped.POSTGRES_PASSWORD_FILE, undefined);
  assert.equal(input.POSTGRES_PASSWORD, undefined);
  assert.equal(mapped.PORT, '32000');
});

test('secret file adapter rejects env override, arbitrary files and unknown secret names', async () => {
  const read = async () => 'secret';
  await assert.rejects(resolveSecretFiles({ POSTGRES_PASSWORD: 'plain',
    POSTGRES_PASSWORD_FILE: '/run/secrets/db_password' }, read), /both/);
  await assert.rejects(resolveSecretFiles({ POSTGRES_PASSWORD_FILE: '/workspace/runtime/deploy.env' }, read), /Invalid secret mount/);
  await assert.rejects(resolveSecretFiles({ EVIL_FILE: '/run/secrets/evil' }, read), /Unsupported/);
  await assert.rejects(resolveSecretFiles({ JWT_SECRET_FILE: '/run/secrets/jwt' }, async () => 'line1\nline2'), /Invalid secret value/);
});
