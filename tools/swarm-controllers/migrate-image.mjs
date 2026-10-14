// Operator-only, one-time migration of an ignored local controller state.
// The new config must already be reviewed and pin the exact live service image.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { migrateImageState, validateConfig } from './controller.mjs';
import { dockerClient, verifyService } from './docker.mjs';

export async function migrateLiveImage(configPath, statePath, oldImage) {
  const newConfig = JSON.parse(await readFile(configPath, 'utf8'));
  validateConfig(newConfig);
  const oldConfig = { ...newConfig, image: oldImage };
  return migrateImageState(oldConfig, newConfig, statePath, {
    verifyRuntime: async scope => {
      const service = verifyService(scope, await dockerClient(scope).inspectService());
      return { image: scope.image, stack: scope.stack, service: scope.service,
        replicas: service.replicas };
    },
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [configPath, statePath, oldImage] = process.argv.slice(2);
    if (!configPath || !statePath || !oldImage || process.argv.length !== 5) {
      throw Error('Expected new-config, old-state, old-image');
    }
    console.log(JSON.stringify(await migrateLiveImage(configPath, statePath, oldImage)));
  } catch {
    console.error('Image state migration refused; inspect old state, live image and runner lease.');
    process.exitCode = 1;
  }
}
