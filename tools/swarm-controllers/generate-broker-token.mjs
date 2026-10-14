import { randomBytes } from 'node:crypto';
import { mkdir, open } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const defaultPath = fileURLToPath(new URL('../../runtime/credentials/swarm-scale-broker-token', import.meta.url));

export async function createBrokerToken(path = defaultPath) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const file = await open(path, 'wx', 0o600); // never overwrite an existing credential
  try {
    await file.writeFile(`${randomBytes(48).toString('base64url')}\n`);
    await file.sync();
  } finally { await file.close(); }
  return path;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 2) throw Error('No arguments accepted');
    await createBrokerToken();
    console.log('Created independent ignored broker credential; value was not displayed.');
  } catch {
    console.error('Broker credential already exists or could not be created; not overwritten.');
    process.exitCode = 1;
  }
}
