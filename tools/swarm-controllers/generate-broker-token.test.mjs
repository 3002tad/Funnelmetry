import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBrokerToken } from './generate-broker-token.mjs';

test('broker token is independent, random and never overwritten', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'funnelmetry-broker-secret-'));
  try {
    const path = join(dir, 'token');
    await createBrokerToken(path);
    const first = await readFile(path, 'utf8');
    assert.match(first, /^[a-zA-Z0-9_-]{64}\n$/);
    await assert.rejects(createBrokerToken(path), { code: 'EEXIST' });
    assert.equal(await readFile(path, 'utf8'), first);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
