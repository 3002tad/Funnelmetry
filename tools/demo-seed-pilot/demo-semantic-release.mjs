// Publish an immutable demo semantic release after validating physical bindings.
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
const [command, version = '1.2.0'] = process.argv.slice(2)
const releases = {
  '1.0.0': { file: './demo-semantic-v1.json', sha256: '37649d69560cc9c7a3442ab20ba502a995bc274998e1b6901661bc7adb643e3e' },
  '1.1.0': { file: './demo-semantic-v1.1.json', sha256: 'f06625d65311170c0af26b9d1d1304fec6800b55c8a2d426743dce11d53c6f3a' },
  '1.2.0': { file: './demo-semantic-v1.2.json', sha256: '2bb4829a13acb231d5b5ce4f7ba77a3ee7259ea68de745048e4435befb691c9f' },
}
if (!['check','emit-sql'].includes(command) || !releases[version]) throw Error('usage: node demo-semantic-release.mjs check|emit-sql [1.0.0|1.1.0|1.2.0]')
const file = await readFile(new URL(releases[version].file, import.meta.url))
// Git may check out JSON with CRLF on Windows; pin canonical LF bytes.
const raw = Buffer.from(file.toString('utf8').replaceAll('\r\n','\n'))
const digest = createHash('sha256').update(raw).digest('hex')
if (digest !== releases[version].sha256) throw Error('demo_semantic_definition_changed_without_version')
const release = JSON.parse(raw)
if (release.release_id !== `demo-commerce-analysis@${version}` || release.status !== 'ACTIVE_DEMO' ||
  release.assets.length !== 17 || release.golden_questions !== 15) throw Error('demo_semantic_release_invalid')
if (command === 'check') { console.log(JSON.stringify({status:'PASS',release_id:release.release_id,sha256:digest,assets:release.assets.length}));process.exit(0) }
const q = value => "'" + String(value).replaceAll("'","''") + "'"
process.stdout.write(`\\set ON_ERROR_STOP on
BEGIN;
SET LOCAL statement_timeout='30s';
SELECT pg_advisory_xact_lock(hashtextextended('funnelmetry-demo-semantic-release-v1',0));
DO $guard$
DECLARE definition jsonb := ${q(raw.toString('utf8'))}::jsonb; a jsonb; field text;
BEGIN
 IF current_database()<>'funnelmetry_handoff' THEN RAISE EXCEPTION 'wrong database'; END IF;
 IF to_regclass('funnelmetry_demo.binding_version') IS NULL THEN RAISE EXCEPTION 'demo binding missing'; END IF;
 IF (SELECT demo_status FROM funnelmetry_demo.dataset_coverage)<>'READY_FOR_DEMO'
    OR (SELECT demo_status FROM funnelmetry_demo.gap_dataset_coverage)<>'READY_FOR_DEMO'
    OR (SELECT observed_overlap_count FROM funnelmetry_demo.gap_overlap_status)<>0
 THEN RAISE EXCEPTION 'demo coverage mismatch or source overlap'; END IF;
 FOR a IN SELECT value FROM jsonb_array_elements(definition->'assets') LOOP
   IF to_regclass(a->>'view') IS NULL THEN RAISE EXCEPTION 'asset view missing: %',a->>'view'; END IF;
   FOR field IN SELECT jsonb_array_elements_text(a->'fields') LOOP
     IF NOT EXISTS (SELECT 1 FROM information_schema.columns
       WHERE table_schema=split_part(a->>'view','.',1)
       AND table_name=split_part(a->>'view','.',2) AND column_name=field)
     THEN RAISE EXCEPTION 'asset binding missing: %.%',a->>'view',field; END IF;
   END LOOP;
 END LOOP;
END $guard$;
CREATE TABLE IF NOT EXISTS funnelmetry_demo.semantic_releases (
 release_id text PRIMARY KEY, definition jsonb NOT NULL, sha256 text NOT NULL,
 status text NOT NULL CHECK(status='ACTIVE_DEMO'), published_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
DO $version_guard$ BEGIN
 IF ${q(version)} <> '1.2.0' AND EXISTS
   (SELECT 1 FROM funnelmetry_demo.semantic_releases WHERE release_id='demo-commerce-analysis@1.2.0')
 THEN RAISE EXCEPTION 'refusing semantic release downgrade'; END IF;
 IF ${q(version)} = '1.0.0' AND EXISTS
   (SELECT 1 FROM funnelmetry_demo.semantic_releases WHERE release_id='demo-commerce-analysis@1.1.0')
 THEN RAISE EXCEPTION 'refusing semantic release downgrade'; END IF;
END $version_guard$;
INSERT INTO funnelmetry_demo.semantic_releases(release_id,definition,sha256,status)
VALUES (${q(release.release_id)},${q(raw.toString('utf8'))}::jsonb,${q(digest)},'ACTIVE_DEMO')
ON CONFLICT (release_id) DO NOTHING;
DO $check$ BEGIN IF NOT EXISTS (SELECT 1 FROM funnelmetry_demo.semantic_releases
 WHERE release_id=${q(release.release_id)} AND sha256=${q(digest)}
 AND definition=${q(raw.toString('utf8'))}::jsonb AND status='ACTIVE_DEMO')
 THEN RAISE EXCEPTION 'demo semantic release conflict'; END IF; END $check$;
CREATE OR REPLACE VIEW funnelmetry_demo.semantic_release AS
 SELECT release_id,definition,sha256,status,published_at
 FROM funnelmetry_demo.semantic_releases WHERE release_id=${q(release.release_id)} AND status='ACTIVE_DEMO';
GRANT SELECT ON funnelmetry_demo.semantic_release TO funnelmetry_ai_agent;
COMMIT;
`)
