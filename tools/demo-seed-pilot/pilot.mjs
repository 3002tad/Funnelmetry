import { createHash } from 'node:crypto'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CONFIG, generate, logicalHash, summarize } from './generator.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const command = process.argv[2]
const data = generate()
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
if (command === 'plan') {
  console.log(JSON.stringify({ environment: 'OFFLINE_DEMO', destination: 'local files only', configuration: CONFIG, expected: summarize(data), logical_sha256: logicalHash(data) }, null, 2))
} else if (command === 'generate') {
  // Use a fresh directory; never delete/overwrite data or connect to a database.
  const output = process.argv[3]
  if (!output) throw Error('Pass a new output directory; e.g. node pilot.mjs generate ../../runtime/demo-seed-pilot-01')
  const dir = resolve(output)
  await mkdir(dir, { recursive: false })
  const payload = JSON.stringify(data) + '\n'
  const generator = await readFile(resolve(here, 'generator.mjs'))
  const manifest = { manifest_version: 'demo-pilot-manifest.v1', dataset_id: CONFIG.dataset_id, seed_version: '1.0.0-pilot', environment: 'OFFLINE_DEMO', provenance: 'synthetic', generated_at: new Date().toISOString(), generator_sha256: sha256(generator), source_id: CONFIG.source_id, config: CONFIG, reference_analysis: 'DEMO_SEED_REFERENCE_DATASET_ANALYSIS_2026-11-04.md', source_data_used: 'aggregate reference distributions and explicit scenario assumptions; no source records', canonical_schema: 'canonical-event.v1', behavior_catalog: 'behavior-event-catalog.v4', cdc_contract: 'reference.medusa.order_recorded_state.v2', metadata_version: 'not-published', quality_status: 'UNVERIFIED', historical_gap_status: 'INCOMPLETE', expected: summarize(data), logical_sha256: logicalHash(data), fixture_file_sha256: sha256(payload), ingestion_time: 'assigned at database load; no ingestion has occurred' }
  await writeFile(resolve(dir, 'fixture.json'), payload, { flag: 'wx' })
  await writeFile(resolve(dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' })
  console.log(`Generated ${dir}`)
} else if (command === 'verify') {
  const dir = resolve(process.argv[3] ?? '')
  const [raw, manifestRaw] = await Promise.all([readFile(resolve(dir, 'fixture.json')), readFile(resolve(dir, 'manifest.json'), 'utf8')])
  const fixture = JSON.parse(raw), manifest = JSON.parse(manifestRaw)
  const generator = await readFile(resolve(here, 'generator.mjs'))
  if (sha256(generator) !== manifest.generator_sha256 || sha256(raw) !== manifest.fixture_file_sha256 || logicalHash(fixture) !== manifest.logical_sha256 || logicalHash(generate(fixture.config)) !== manifest.logical_sha256 || JSON.stringify(summarize(fixture)) !== JSON.stringify(manifest.expected)) throw Error('pilot fixture verification failed')
  console.log(JSON.stringify({ fixture_consistency: 'PASS', quality_status: 'UNVERIFIED', logical_sha256: manifest.logical_sha256, expected: manifest.expected }, null, 2))
} else throw Error('Usage: node pilot.mjs plan | generate <new-directory> | verify <directory>')
