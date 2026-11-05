import { createHash } from 'node:crypto'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULTS, generateExpanded, hash, summarizeExpanded, addCatalogLabels } from './expanded.mjs'
import { generateExpanded as generatePreviousPilot } from './expanded-pilot-v2-snapshot.mjs'

const [command,anchorPath,outputPath,labelsPath]=process.argv.slice(2)
if(!['plan','generate','verify'].includes(command)||!anchorPath) throw Error('Usage: expanded-cli.mjs plan <anchor> | generate <anchor> <new-directory> | verify <anchor> <directory>')
const rawAnchor=await readFile(resolve(anchorPath)),rawLabels=labelsPath?await readFile(resolve(labelsPath)):null,anchor=rawLabels?addCatalogLabels(JSON.parse(rawAnchor),JSON.parse(rawLabels.toString('utf8').replace(/^\uFEFF/,''))):JSON.parse(rawAnchor),anchorHash=createHash('sha256').update(rawAnchor).digest('hex'),labelsHash=rawLabels?createHash('sha256').update(rawLabels).digest('hex'):null
const generator=await readFile(resolve(dirname(fileURLToPath(import.meta.url)),'expanded.mjs'))
const generatorHash=createHash('sha256').update(generator).digest('hex')
const generated=generateExpanded(anchor,DEFAULTS)
if(command==='plan') console.log(JSON.stringify({environment:'OFFLINE_DEMO',config:DEFAULTS,anchor_sha256:anchorHash,logical_sha256:hash(generated),counts:summarizeExpanded(generated)},null,2))
else {
  if(!outputPath) throw Error('output directory required')
  const dir=resolve(outputPath)
  if(command==='generate') {
    await mkdir(dir,{recursive:false})
    const payload=JSON.stringify(generated)+'\n',manifest={manifest_version:'demo-expanded-manifest.v2',environment:'OFFLINE_DEMO',dataset_id:DEFAULTS.dataset_id,seed_version:'expanded-pilot.v2',created_at:new Date().toISOString(),generator_sha256:generatorHash,anchor_sha256:anchorHash,labels_sha256:labelsHash,logical_sha256:hash(generated),fixture_sha256:createHash('sha256').update(payload).digest('hex'),counts:summarizeExpanded(generated),origin:'SYNTHETIC_BACKFILL',cutover_status:'PROVISIONAL_OFFLINE_ONLY',source_history_status:'INCOMPLETE',config:DEFAULTS,assumptions:{traffic:'seasonality and campaigns are illustrative scenarios',currency:'EUR',price_and_inventory:'synthetic scenario',labels:'separate later snapshot if supplied; not verified historical labels',payment_and_fulfillment:'demo-only; no observed CDC binding'},ingested_at:'assigned on actual DB load'}
    await writeFile(resolve(dir,'fixture.json'),payload,{flag:'wx'})
    await writeFile(resolve(dir,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'})
    console.log(JSON.stringify({generated:dir,counts:manifest.counts,logical_sha256:manifest.logical_sha256},null,2))
  } else {
    const fixture=await readFile(resolve(dir,'fixture.json')),manifest=JSON.parse(await readFile(resolve(dir,'manifest.json'),'utf8'))
    const previous=await readFile(resolve(dirname(fileURLToPath(import.meta.url)),'expanded-pilot-v2-snapshot.mjs')), generatorForFixture=manifest.generator_sha256===generatorHash?generateExpanded:manifest.generator_sha256===createHash('sha256').update(previous).digest('hex')?generatePreviousPilot:null
    const regenerated=generatorForFixture?generatorForFixture(anchor,JSON.parse(fixture).config):null
    if(manifest.environment!=='OFFLINE_DEMO'||!regenerated||manifest.anchor_sha256!==anchorHash||manifest.labels_sha256!==labelsHash||manifest.fixture_sha256!==createHash('sha256').update(fixture).digest('hex')||manifest.logical_sha256!==hash(JSON.parse(fixture))||manifest.logical_sha256!==hash(regenerated)||JSON.stringify(manifest.counts)!==JSON.stringify(summarizeExpanded(regenerated))) throw Error('fixture_verification_failed')
    console.log(JSON.stringify({verification:'PASS',counts:manifest.counts,logical_sha256:manifest.logical_sha256},null,2))
  }
}
