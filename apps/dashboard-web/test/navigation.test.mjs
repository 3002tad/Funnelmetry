import test from 'node:test'
import assert from 'node:assert/strict'
import { navigation, visibleNavigation } from '../src/app/navigation.ts'

const paths = permissions => visibleNavigation(permissions).flatMap(group => group.items.map(item => item.path))
test('anonymous and chat-only permissions cannot see analytics navigation', () => {
  assert.deepEqual(paths([]), [])
  assert.deepEqual(paths(['chat.use']), [])
})
test('analyst navigation keeps live tools, excludes admin and gates chat', () => {
  const result = paths(['analytics.read'])
  for (const path of ['/overview', '/workspace', '/analysis-runs', '/evidence', '/funnels', '/journeys', '/events', '/data-health', '/metrics', '/assets', '/findings', '/reports']) assert.ok(result.includes(path), path)
  assert.ok(!result.includes('/chat'))
  assert.ok(result.every(path => !path.startsWith('/admin/')))
  assert.ok(paths(['analytics.read', 'chat.use']).includes('/chat'))
})
test('admin permissions do not implicitly grant analytics or user management', () => {
  const result = paths(['pipeline.monitor'])
  assert.ok(result.includes('/admin/connector'))
  assert.ok(result.includes('/admin/event-feed'))
  assert.ok(result.includes('/admin/processing'))
  assert.equal(navigation.flatMap(group => group.items).find(item => item.path === '/admin/processing').unavailable, undefined)
  assert.ok(!result.includes('/admin/users'))
  assert.ok(!result.includes('/admin/sources'))
  assert.ok(!result.includes('/overview'))
  assert.deepEqual(paths(['user.manage']), ['/admin/users'])
  assert.deepEqual(paths(['integration.read']), ['/admin/sources', '/admin/schemas', '/admin/metadata', '/admin/metric-catalog', '/admin/tools'])
})
test('explicitly combined capabilities retain both navigation bundles', () => {
  const result = paths(['analytics.read', 'pipeline.monitor'])
  assert.ok(result.includes('/overview'))
  assert.ok(result.includes('/admin/pipeline'))
})
test('routes are unique and mock-backed surfaces are unavailable', () => {
  const items = navigation.flatMap(group => group.items)
  assert.equal(new Set(items.map(item => item.path)).size, items.length)
  for (const path of ['/traffic', '/campaigns', '/admin/recovery']) assert.ok(items.find(item => item.path === path)?.unavailable)
  for (const path of ['/products', '/findings', '/workspace', '/overview', '/events', '/funnels', '/journeys', '/chat', '/admin/users', '/admin/event-feed']) assert.equal(items.find(item => item.path === path)?.unavailable, undefined)
  assert.ok(items.every(item => !['/implementations', '/evaluations', '/insights'].includes(item.path)))
})
