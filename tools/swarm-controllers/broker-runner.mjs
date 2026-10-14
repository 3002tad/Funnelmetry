// Scale-only controller: no Docker socket, CLI invocation, or Level-2 actuator.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { brokerClient } from './broker-client.mjs';
import { run, validateConfig } from './controller.mjs';

export function runnerOptions(env) {
  if (env.SWARM_CONTROLLER_APPLY !== 'reviewed-live-autoscale') {
    throw Error('REVIEWED_LIVE_AUTOSCALE_ACK_REQUIRED');
  }
  return { endpoint: env.SWARM_BROKER_ENDPOINT || 'http://swarm-scale-broker:32130/',
    intervalMs: 30000 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [configPath, statePath, tokenPath] = process.argv.slice(2);
    if (!configPath || !statePath || !tokenPath || process.argv.length !== 5) throw Error('Invalid paths');
    const { endpoint, intervalMs } = runnerOptions(process.env);
    const config = JSON.parse(await readFile(configPath, 'utf8'));
    validateConfig(config);
    const token = (await readFile(tokenPath, 'utf8')).trim();
    const abort = new AbortController();
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => abort.abort());
    await run(config, statePath, brokerClient(config, endpoint, token), {
      apply: true, recoveryApply: false, intervalMs, signal: abort.signal,
    });
  } catch {
    console.error('Scale-only controller stopped safely; review release evidence, state and broker.');
    process.exitCode = 1;
  }
}
