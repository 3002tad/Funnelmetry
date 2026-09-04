import { loadConfig } from "./config.js"
import { createKafkaNormalizerRuntime } from "./kafka-runtime.js"
import {
  createMappingRegistry,
  createMedusaOrderPlacedMappings,
  createPassthroughMappings,
} from "./mapping-registry.js"
import { createNormalizer } from "./normalizer.js"

const config = loadConfig()
const registry = createMappingRegistry([
  ...createPassthroughMappings(),
  ...createMedusaOrderPlacedMappings(config.medusaOrderCreatedSourceIds),
])
const runtime = createKafkaNormalizerRuntime({ ...config, normalizer: createNormalizer({ registry }) })
let shuttingDown = false

async function shutdown(signal) {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`canonical-normalizer received ${signal}; shutting down`)
  const forceExit = setTimeout(() => process.exit(1), config.shutdownTimeoutMs)
  forceExit.unref()
  await runtime.stop()
  clearTimeout(forceExit)
}

process.once("SIGINT", () => shutdown("SIGINT").catch((error) => {
  console.error("canonical-normalizer shutdown failed", error)
  process.exitCode = 1
}))
process.once("SIGTERM", () => shutdown("SIGTERM").catch((error) => {
  console.error("canonical-normalizer shutdown failed", error)
  process.exitCode = 1
}))

try {
  await runtime.start()
  console.log("canonical-normalizer is consuming raw events")
} catch (error) {
  console.error("canonical-normalizer startup failed", error)
  await runtime.stop()
  process.exitCode = 1
}
