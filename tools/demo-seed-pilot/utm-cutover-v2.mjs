// Emit an atomic, replayable switch to the UTM-corrected synthetic fixtures.
import { readFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const replacements = [
  ['demo-historical-100000-v2','demo-historical-100000-v3-utm'],
  ['demo-gap-20261101-20261105-v1','demo-gap-20261101-20261105-v2-utm'],
  ['b4316f664d333ae05b2a804ff63bd513c776462e4effe08a4b9a74b869058d0f','395b7f6abcd4c405397dcc7db9b8ffac340c8b780d19303f06075ee1e47268e9'],
  ['5858034aa55353d166fb9c2eaeb21f84f0d966d96e79a69b78e6bc2041544e0b','efa33fde6f86d3c1651ea54e0b1873374d79436def7b3f753f39e31c17a250de'],
  ['074d25c357a598767e58175bd0b0b2932118b4f6461fdb85d99a50cdcd2b3230','5ce19fb7aff298c4779570ea09e5f5efc4da6c871d9f994e710b25f869a2e4a4'],
  ['09a559d8fe7cdf051c3260e6a29370eab849cd910c265478f5ed3129f897ca30','8262898adfb0c73ff3b108c98264dc87d93129e1fef7e2148b095c6b2ae46881'],
  ['6089a21874defb09b7641166481b8261e4313604f700686fbe3a23d9f4a41bd8','8df0119c34c5d13e71f506dcfbb9708e31b7f52fa50cadfc300fa91f18bfbdea'],
  ['785ecd32bcd98d973a9485dc1cbb0d18b7035c893f6d7f0bb6b3c0281f9fa587','ccf2011527e24068ad2037078f0f45378f6dcfdcc03f48d3934dfd49cde071ac'],
]
const body = sql => sql.replace(/^\\set ON_ERROR_STOP on\s*$/gm,'').replace(/^BEGIN;\s*$/gm,'').replace(/^COMMIT;\s*$/gm,'')
const parts = []
for (const name of ['pipeline-analytical-views-v1.sql','pipeline-gap-binding-v1.sql','pipeline-demo-coverage-v1.sql']) {
  let sql = await readFile(new URL(name,import.meta.url),'utf8')
  for (const [oldValue,newValue] of replacements) sql=sql.replaceAll(oldValue,newValue)
  parts.push(body(sql))
}
const semantic = spawnSync(process.execPath,[fileURLToPath(new URL('./demo-semantic-release.mjs',import.meta.url)),'emit-sql','1.2.0'],{encoding:'utf8'})
if (semantic.status!==0) throw Error(`semantic emission failed: ${semantic.stderr}`)
parts.push(body(semantic.stdout))
process.stdout.write(`\\set ON_ERROR_STOP on\nBEGIN;\nSELECT pg_advisory_xact_lock(hashtextextended('funnelmetry-demo-history-v1',0));\n`)
process.stdout.write(parts.join('\n'))
process.stdout.write(`
SET LOCAL statement_timeout='180s';
ANALYZE demo_history.sessions;
ANALYZE demo_history.browser_events;
DO $check$
BEGIN
 IF (SELECT count(*) FROM funnelmetry_demo.sessions) <> 101750 OR
    (SELECT count(*) FROM funnelmetry_demo.browser_events) <> 274414 THEN
   RAISE EXCEPTION 'unexpected switched counts'; END IF;
 IF EXISTS (SELECT 1 FROM funnelmetry_demo.browser_events e
   LEFT JOIN funnelmetry_demo.sessions s ON s.dataset_id=e.dataset_id AND s.session_id=e.session_id
   WHERE s.session_id IS NULL OR e.utm_source IS DISTINCT FROM s.utm_source) THEN
   RAISE EXCEPTION 'event/session UTM mismatch'; END IF;
 IF (SELECT count(*) FROM funnelmetry_demo.sessions WHERE utm_source IN ('facebook','tiktok','zalo','google')) = 0 THEN
   RAISE EXCEPTION 'platform UTM sources missing'; END IF;
END $check$;
COMMIT;
`)
