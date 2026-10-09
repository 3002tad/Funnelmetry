import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = name => readFileSync(new URL(name, import.meta.url), 'utf8')
const dashboard = JSON.parse(read('pipeline-dashboard.json'))
// JSON is valid YAML; keep fixtures dependency-free for this artifact check.
const fixtures = JSON.parse(read('dashboard-promql.test.yml'))

test('dashboard has importable datasource and unique panel IDs', () => {
  assert.equal(dashboard.id, null)
  assert.equal(dashboard.__inputs[0].name, 'DS_PROMETHEUS')
  assert.equal(new Set(dashboard.panels.map(p => p.id)).size, dashboard.panels.length)
  for (const panel of dashboard.panels.filter(p => p.targets)) {
    assert.equal(panel.datasource.uid, '${DS_PROMETHEUS}')
    assert.equal(panel.fieldConfig.defaults.noValue, 'Unknown')
    for (const target of panel.targets) {
      assert.match(target.expr, /job="funnelmetry-monitoring"/)
      assert.doesNotMatch(target.expr, /or\s+vector\s*\(0\)/)
      if (target.expr !== 'up{job="funnelmetry-monitoring"}') {
        assert.match(target.expr, /and on\(job,instance\) \(up.* == 1\)/)
      }
    }
  }
})

test('promtool regression expressions match actual dashboard queries', () => {
  const expressions = dashboard.panels.flatMap(p => (p.targets ?? []).map(t => t.expr))
  const cases = fixtures.tests.flatMap(t => t.promql_expr_test)
  assert.equal(cases.length, 3)
  for (const entry of cases) {
    assert.ok(expressions.includes(entry.expr), 'fixture must exercise the shipped query')
    assert.equal(entry.exp_samples.length, 1)
    assert.equal(entry.exp_samples[0].value, 0, 'known zero must survive')
    assert.match(entry.exp_samples[0].labels, /instance="known:32000"/)
  }
})

test('scrape template uses a secret file, internal target and bounded timeout', () => {
  const config = read('prometheus.yml.example')
  assert.match(config, /credentials_file: \/run\/secrets\/funnelmetry_metrics_token/)
  assert.match(config, /targets: \[dashboard-api:32000\]/)
  assert.match(config, /scrape_timeout: 12s/)
  assert.doesNotMatch(config, /^\s*(credentials|password|bearer_token):/m)
})
