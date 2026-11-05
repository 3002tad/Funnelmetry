import { createHash } from 'node:crypto'
import { readFile,writeFile } from 'node:fs/promises'
import { reconcileCatalog } from './catalog-anchor.mjs'

const [sourcePath,projectionPath,outputPath]=process.argv.slice(2)
if(!sourcePath || !projectionPath || !outputPath) throw Error('Usage: catalog-anchor-cli.mjs <source-snapshot.json> <projection-snapshot.json> <new-output.json>')
const [s,p]=await Promise.all([readFile(sourcePath),readFile(projectionPath)])
const sha=x=>createHash('sha256').update(x).digest('hex')
const result=reconcileCatalog(JSON.parse(s),JSON.parse(p),{source_sha256:sha(s),projection_sha256:sha(p)})
const raw=JSON.stringify(result,null,2)+'\n'
await writeFile(outputPath,raw,{flag:'wx',mode:0o600})
console.log(JSON.stringify({result:result.status,scope:result.scope,counts:result.counts,wal_lsn:result.wal_lsn,cutover:result.live_cutover_status,sha256:sha(raw)}))
