// Deterministic synthetic continuation of the pinned demo; never source history.
import { createHash } from 'node:crypto'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { DEFAULTS, generateExpanded, addCatalogLabels, hash, summarizeExpanded } from './expanded.mjs'

const [anchorPath, labelsPath, outPath] = process.argv.slice(2)
if (!anchorPath || !labelsPath || !outPath) throw Error('usage: node gap-seed.mjs <anchor> <labels> <new-directory>')
const sha = value => createHash('sha256').update(value).digest('hex')
const stable = x => Array.isArray(x) ? x.map(stable) : x && typeof x === 'object'
  ? Object.fromEntries(Object.keys(x).sort().map(k => [k, stable(x[k])])) : x
const [anchorRaw, labelsRaw, generatorRaw] = await Promise.all([
  readFile(resolve(anchorPath)), readFile(resolve(labelsPath)), readFile(new URL('./expanded.mjs', import.meta.url)),
])
const anchor = addCatalogLabels(JSON.parse(anchorRaw), JSON.parse(labelsRaw.toString('utf8').replace(/^\uFEFF/, '')))
const config = {...DEFAULTS, dataset_id:'demo-gap-20261101-20261105-v1', seed:20261106, sessions:1750,
  start:'2026-11-01T00:00:00.000Z', end:'2026-11-05T00:00:00.000Z', campaigns:[]}
const data = generateExpanded(anchor, config)
// Existing generated IDs restart at zero for each fixture. Namespace every
// occurrence (including embedded event data) so cross-dataset joins cannot alias.
const namespace = x => typeof x === 'string' ? x.replace(/demo-(session|event|cart|order|customer)-\d+/g, m => `gap-20261101-${m}`)
  : Array.isArray(x) ? x.map(namespace) : x && typeof x === 'object'
    ? Object.fromEntries(Object.entries(x).map(([k,v]) => [k,namespace(v)])) : x
data.rows = namespace(data.rows)
const raw = JSON.stringify(data)+'\n'
const checksums = Object.fromEntries(Object.entries(data.rows).map(([domain, rows]) => {
  const h=createHash('sha256'); for (const row of rows) h.update(JSON.stringify(stable(row))+'\n'); return [domain,h.digest('hex')]
}))
const manifest = {manifest_version:'demo-gap-manifest.v1',dataset_id:config.dataset_id,origin:'SYNTHETIC_BACKFILL',
  config, generator_sha256:sha(generatorRaw), anchor_sha256:sha(anchorRaw),labels_sha256:sha(labelsRaw),
  fixture_sha256:sha(raw),logical_sha256:hash(data),domain_canonical_sha256:checksums,counts:summarizeExpanded(data),
  scope:'Generated demo continuation; not recovered Medusa WAL',source_history_status:'INCOMPLETE'}
await mkdir(resolve(outPath),{recursive:false})
await writeFile(resolve(outPath,'fixture.json'),raw,{flag:'wx'})
await writeFile(resolve(outPath,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'})
console.log(JSON.stringify({dataset_id:config.dataset_id,fixture_sha256:manifest.fixture_sha256,logical_sha256:manifest.logical_sha256,counts:manifest.counts}))
