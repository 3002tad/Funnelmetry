// Swarm-only Node entrypoint: resolve mounted secret files before launching an
// existing application command. No secret value is placed in the stack spec.
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { waitForSwarmReadiness } from './swarm-readiness.mjs';

const allowed = new Set([
  'POSTGRES_PASSWORD', 'JWT_SECRET', 'DASHBOARD_ADMIN_PASSWORD',
  'DASHSCOPE_API_KEY', 'SOURCE_EVENT_FEED_TOKEN', 'CATALOG_MEDUSA_SECRET_KEY',
]);

export async function resolveSecretFiles(env, read = readFile) {
  const result = { ...env };
  for (const [name, path] of Object.entries(env)) {
    if (!name.endsWith('_FILE')) continue;
    const target = name.slice(0, -5);
    if (!allowed.has(target)) throw Error(`Unsupported secret file variable: ${name}`);
    if (env[target]) throw Error(`Do not set both ${target} and ${name}`);
    if (!/^\/run\/secrets\/[a-z0-9][a-z0-9_-]*$/.test(path || '')) throw Error(`Invalid secret mount for ${name}`);
    const value = (await read(path, 'utf8')).replace(/\r?\n$/, '');
    if (!value || value.includes('\n') || value.includes('\r')) throw Error(`Invalid secret value for ${name}`);
    result[target] = value;
    delete result[name];
  }
  return result;
}

async function main(args = process.argv.slice(2)) {
  if (!args.length || args.some(arg => typeof arg !== 'string' || arg.length > 4096)) {
    throw Error('Swarm Node command is required');
  }
  const env = await resolveSecretFiles(process.env);
  if (env.SWARM_WAIT_ROLE) {
    if (!['api', 'worker'].includes(env.SWARM_WAIT_ROLE)) throw Error('Invalid SWARM_WAIT_ROLE');
    await waitForSwarmReadiness(env);
  }
  const child = spawn(process.execPath, args, { env, stdio: 'inherit', windowsHide: true });
  for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => child.kill(signal));
  const result = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
  process.exitCode = result.code ?? (result.signal ? 1 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { await main(); }
  catch (error) { console.error(`Swarm entrypoint stopped: ${error.message}`); process.exitCode = 1; }
}
