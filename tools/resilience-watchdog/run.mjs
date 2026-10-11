// Host-only foreground scheduler. No Docker access is exposed to the API/Agent.
import { mkdir, rmdir, readFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { validateConfig, initialize, tick, dockerAdapter } from './controller.mjs';

export async function run(config, statePath, adapter, {
  intervalMs, apply = false, signal, onEvents = () => {}, cycle = tick,
  sleep = (ms, signal) => delay(ms, undefined, { signal }),
} = {}) {
  validateConfig(config);
  if (!Number.isSafeInteger(intervalMs) || intervalMs < 1000 || intervalMs > 300000) throw Error('INVALID_INTERVAL');
  // Held for the whole session; cycle's state lock also excludes concurrent manual ticks.
  const lease = `${statePath}.runner.lock`;
  await mkdir(lease);
  try {
    if (apply) {
      for (const service of config.services) {
        const target = await adapter.discover(service);
        if (!target || target.project !== config.project || target.service !== service ||
            !target.running || target.oneoff !== false ||
            (await adapter.probe(target)).liveness !== 'alive') throw Error('STARTUP_TARGET_NOT_VERIFIED');
      }
    }
    while (!signal?.aborted) {
      const events = await cycle(config, statePath, adapter, { apply });
      await onEvents(events);
      if (events.some(e => e.reason === 'CIRCUIT_OPEN_OPERATOR_REVIEW')) throw Error('CIRCUIT_REQUIRES_REVIEW');
      if (signal?.aborted) break;
      try { await sleep(intervalMs, signal); }
      catch (error) { if (!signal?.aborted) throw error; }
    }
  } finally { await rmdir(lease); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [configFile, stateFile, interval, ...flags] = process.argv.slice(2);
  const stop = new AbortController();
  const shutdown = () => stop.abort();
  process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
  try {
    if (!configFile || !stateFile || flags.some(f => !['--apply', '--initialize'].includes(f)) ||
        new Set(flags).size !== flags.length) throw Error('INVALID_ARGUMENTS');
    const config = JSON.parse(await readFile(resolve(configFile), 'utf8'));
    const path = resolve(stateFile);
    if (flags.includes('--initialize')) {
      let missing = false;
      try { await access(path); } catch (e) { if (e.code !== 'ENOENT') throw e; missing = true; }
      if (missing) await initialize(config, path);
    }
    console.log(JSON.stringify({ mode: flags.includes('--apply') ? 'APPLY' : 'OBSERVE_ONLY', project: config.project,
      services: config.services, stop: 'Ctrl+C; stop this runner before manual Docker maintenance' }));
    await run(config, path, dockerAdapter(config, process.env.WATCHDOG_DOCKER_EXE || 'docker'), {
      intervalMs: Number(interval), apply: flags.includes('--apply'), signal: stop.signal,
      onEvents: events => console.log(JSON.stringify({ at: new Date().toISOString(), events })),
    });
    console.log('Watchdog stopped; containers and recovery state retained.');
  } catch {
    console.error('Watchdog stopped safely. Check target health, config, state and lock; do not delete recovery state to bypass review.');
    process.exitCode = 1;
  } finally { process.off('SIGINT', shutdown); process.off('SIGTERM', shutdown); }
}
