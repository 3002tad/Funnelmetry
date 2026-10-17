import { setTimeout as delay } from 'node:timers/promises'
import { syncMetadataVectors } from '../src/lib/ai/metadata-vector.js'

let error
for (let attempt = 0; attempt < 12; attempt++) {
  try {
    const result = await syncMetadataVectors()
    console.log(`Indexed ${result.points} metadata definitions from ${result.catalog_id}@${result.catalog_version}`)
    process.exit(0)
  } catch (caught) {
    error = caught
    if (attempt < 11) await delay(3000)
  }
}
console.error(`Metadata vector indexing failed: ${error?.message ?? 'unknown error'}`)
process.exitCode = 1
