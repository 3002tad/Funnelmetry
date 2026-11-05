// Derive a new immutable synthetic fixture without changing business behavior.
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const INPUTS = {
  'demo-historical-100000-v2': { next: 'demo-historical-100000-v3-utm', manifest: 'b4316f664d333ae05b2a804ff63bd513c776462e4effe08a4b9a74b869058d0f', fixture: '5858034aa55353d166fb9c2eaeb21f84f0d966d96e79a69b78e6bc2041544e0b' },
  'demo-gap-20261101-20261105-v1': { next: 'demo-gap-20261101-20261105-v2-utm', manifest: '09a559d8fe7cdf051c3260e6a29370eab849cd910c265478f5ed3129f897ca30', fixture: '6089a21874defb09b7641166481b8261e4313604f700686fbe3a23d9f4a41bd8' },
}
const sha = x => createHash('sha256').update(x).digest('hex')
const stable = x => Array.isArray(x) ? x.map(stable) : x && typeof x === 'object' ? Object.fromEntries(Object.keys(x).sort().map(k => [k, stable(x[k])])) : x
const [manifestPath, fixturePath, outputPath, ...extra] = process.argv.slice(2)
if (!manifestPath || !fixturePath || !outputPath || extra.length) throw Error('usage: node utm-seed-v2.mjs <manifest> <fixture> <new-directory>')
const [manifestRaw, fixtureRaw, scriptRaw] = await Promise.all([readFile(resolve(manifestPath)), readFile(resolve(fixturePath)), readFile(new URL(import.meta.url))])
const input = JSON.parse(manifestRaw), data = JSON.parse(fixtureRaw), pin = INPUTS[input.dataset_id]
if (!pin || sha(manifestRaw) !== pin.manifest || sha(fixtureRaw) !== pin.fixture || data.config.dataset_id !== input.dataset_id || input.origin !== 'SYNTHETIC_BACKFILL') throw Error('input_fixture_not_approved')

// Weighted scenario assumptions, not measured attribution from real traffic.
const buckets = [[24,'facebook'],[44,'tiktok'],[64,'google'],[76,'zalo'],[84,'instagram'],[88,'newsletter'],[98,null],[100,'unmapped-example']]
const distribution = {}, sessions = new Map()
for (const row of data.rows.sessions) {
  const roll = createHash('sha256').update(`funnelmetry-demo-utm-v2\0${input.dataset_id}\0${row.session_id}`).digest().readUInt32BE(0) % 100
  const source = buckets.find(([end]) => roll < end)[1]
  if (sessions.has(row.session_id)) throw Error('duplicate_session')
  sessions.set(row.session_id, source)
  row.utm_source = source
  const key = source ?? '[absent]'
  distribution[key] = (distribution[key] ?? 0) + 1
}
for (const row of data.rows.browser_events) {
  if (!sessions.has(row.session_id)) throw Error('event_session_missing')
  row.utm_source = sessions.get(row.session_id)
}
data.config.dataset_id = pin.next
const raw = JSON.stringify(data) + '\n'
const domainHashes = Object.fromEntries(Object.entries(data.rows).map(([name, rows]) => {
  const digest = createHash('sha256'); for (const row of rows) digest.update(JSON.stringify(stable(row)) + '\n'); return [name, digest.digest('hex')]
}))
for (const [name, hash] of Object.entries(domainHashes)) {
  if (!['sessions','browser_events'].includes(name) && hash !== input.domain_canonical_sha256[name]) throw Error(`unexpected_domain_change:${name}`)
}
const manifest = {...input, manifest_version:'demo-utm-derived-manifest.v1', dataset_id:pin.next,
  seed_version:'demo-utm-sources.v2', config:data.config, source_dataset_id:input.dataset_id,
  source_manifest_sha256:sha(manifestRaw), source_fixture_sha256:sha(fixtureRaw),
  utm_generator_sha256:sha(scriptRaw), utm_distribution:distribution,
  utm_scenario:'synthetic weighted assumption; raw labels are not inferred observed sources',
  fixture_sha256:sha(raw), logical_sha256:sha(JSON.stringify(data)), domain_canonical_sha256:domainHashes}
await mkdir(resolve(outputPath), {recursive:false})
await writeFile(resolve(outputPath,'fixture.json'), raw, {flag:'wx'})
await writeFile(resolve(outputPath,'manifest.json'), JSON.stringify(manifest,null,2)+'\n', {flag:'wx'})
console.log(JSON.stringify({dataset_id:pin.next,fixture_sha256:manifest.fixture_sha256,logical_sha256:manifest.logical_sha256,utm_distribution:distribution}))
