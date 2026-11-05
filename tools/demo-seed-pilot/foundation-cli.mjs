import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildFoundation, foundationHash } from './foundation.mjs'
import { generate, logicalHash } from './generator.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const sha = value => createHash('sha256').update(value).digest('hex')
const [command, fixtureDir, outputDir, anchorFile] = process.argv.slice(2)
if (!['generate','verify'].includes(command) || !fixtureDir || !outputDir || (command === 'verify' && anchorFile)) throw Error('Usage: foundation-cli.mjs generate <fixture-dir> <new-output-dir> [anchor-json] | verify <fixture-dir> <output-dir>')
const [fixtureRaw, pilotManifestRaw, generatorRaw, foundationSource] = await Promise.all([
  readFile(resolve(fixtureDir,'fixture.json')), readFile(resolve(fixtureDir,'manifest.json'),'utf8'),
  readFile(resolve(here,'generator.mjs')), readFile(resolve(here,'foundation.mjs')),
])
const fixture = JSON.parse(fixtureRaw), pilotManifest = JSON.parse(pilotManifestRaw)
if (pilotManifest.environment !== 'OFFLINE_DEMO' || pilotManifest.generator_sha256 !== sha(generatorRaw) || pilotManifest.fixture_file_sha256 !== sha(fixtureRaw) || pilotManifest.logical_sha256 !== logicalHash(fixture) || logicalHash(generate(fixture.config)) !== pilotManifest.logical_sha256) throw Error('pilot_fixture_mismatch')
const dir = resolve(outputDir)
if (command === 'generate') {
  const anchors = anchorFile ? JSON.parse(await readFile(resolve(anchorFile),'utf8')) : []
  const foundation = buildFoundation(fixture, anchors)
  const foundationRaw = JSON.stringify(foundation) + '\n', anchorsRaw = JSON.stringify(anchors) + '\n'
  const manifest = { manifest_version:'demo-foundation-manifest.v1', dataset_id:foundation.dataset_id, environment:'OFFLINE_DEMO', cutover_at:foundation.cutover_at, cutover_status:foundation.cutover_status, generated_at:new Date().toISOString(), seed_version:pilotManifest.seed_version, seed:fixture.config.seed, fixture_logical_sha256:pilotManifest.logical_sha256, fixture_file_sha256:sha(fixtureRaw), generator_sha256:sha(generatorRaw), foundation_source_sha256:sha(foundationSource), anchors_sha256:sha(anchorsRaw), foundation_sha256:sha(foundationRaw), foundation_logical_sha256:foundationHash(foundation), counts:{ crosswalk:foundation.crosswalk.length, coverage:foundation.coverage.length, unverified_anchors:anchors.length }, coverage_scope:'SYNTHETIC_FIXTURE_ONLY', live_coverage:'UNVERIFIED', semantic_metadata:'NOT_PUBLISHED' }
  await mkdir(dir,{recursive:false})
  await writeFile(resolve(dir,'anchors.json'),anchorsRaw,{flag:'wx'})
  await writeFile(resolve(dir,'foundation.json'),foundationRaw,{flag:'wx'})
  await writeFile(resolve(dir,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'})
  console.log(JSON.stringify({ result:'PASS', output:dir, ...manifest.counts, cutover_status:foundation.cutover_status, logical_sha256:manifest.foundation_logical_sha256 }))
} else {
  const [anchorsRaw, foundationRaw, manifestRaw] = await Promise.all([readFile(resolve(dir,'anchors.json')), readFile(resolve(dir,'foundation.json')), readFile(resolve(dir,'manifest.json'),'utf8')])
  const manifest=JSON.parse(manifestRaw), foundation=JSON.parse(foundationRaw), anchors=JSON.parse(anchorsRaw)
  const regenerated=buildFoundation(fixture,anchors)
  if (manifest.manifest_version !== 'demo-foundation-manifest.v1' || manifest.environment !== 'OFFLINE_DEMO' || manifest.dataset_id !== fixture.config.dataset_id || manifest.cutover_at !== foundation.cutover_at || manifest.cutover_status !== foundation.cutover_status || manifest.seed_version !== pilotManifest.seed_version || manifest.seed !== fixture.config.seed || manifest.coverage_scope !== 'SYNTHETIC_FIXTURE_ONLY' || manifest.live_coverage !== 'UNVERIFIED' || manifest.semantic_metadata !== 'NOT_PUBLISHED' || manifest.fixture_logical_sha256 !== pilotManifest.logical_sha256 || manifest.fixture_file_sha256 !== sha(fixtureRaw) || manifest.generator_sha256 !== sha(generatorRaw) || manifest.foundation_source_sha256 !== sha(foundationSource) || manifest.anchors_sha256 !== sha(anchorsRaw) || manifest.foundation_sha256 !== sha(foundationRaw) || manifest.foundation_logical_sha256 !== foundationHash(foundation) || foundationHash(regenerated) !== manifest.foundation_logical_sha256 || manifest.counts?.crosswalk !== foundation.crosswalk.length || manifest.counts?.coverage !== foundation.coverage.length || manifest.counts?.unverified_anchors !== anchors.length) throw Error('foundation_verification_failed')
  console.log(JSON.stringify({ result:'PASS', fixture_scope:'SYNTHETIC_FIXTURE_ONLY', live_coverage:'UNVERIFIED', ...manifest.counts, logical_sha256:manifest.foundation_logical_sha256 }))
}
