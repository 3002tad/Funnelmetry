// One-time, operator-reviewed evidence migration for the exact live image.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { attestReleaseState, collect, validateConfig } from './controller.mjs';
import { dockerClient } from './docker.mjs';

export async function attestLiveRelease(configPath, statePath) {
  const newConfig = JSON.parse(await readFile(configPath, 'utf8'));
  validateConfig(newConfig);
  const oldConfig = structuredClone(newConfig);
  delete oldConfig.evidence;
  return attestReleaseState(oldConfig, newConfig, statePath, {
    verifyRuntime: async scope => {
      const observation = await collect(scope, dockerClient(scope));
      return { image: scope.image, stack: scope.stack, service: scope.service,
        replicas: observation.service.replicas, ready: observation.autoscale.ready,
        groupStable: observation.autoscale.groupStable,
        identityVerified: observation.autoscale.identityVerified,
        consumableLag: observation.autoscale.lag };
    },
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 4) throw Error('Expected reviewed config and old state paths');
    console.log(JSON.stringify(await attestLiveRelease(process.argv[2], process.argv[3])));
  } catch {
    console.error('Release attestation refused; inspect evidence, old state, live image and runner lease.');
    process.exitCode = 1;
  }
}
