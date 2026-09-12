import test from 'node:test'
import assert from 'node:assert/strict'
import { ASSIGNABLE_ROLES, permissionsFor, canAccessChat } from '../src/lib/roles.js'
import { requireAnalyticsCapability } from '../src/middleware/analytics-capability.js'

test('three assignable roles with separate admin and business permissions', () => {
  assert.deepEqual(ASSIGNABLE_ROLES, ['super_admin', 'analyst', 'staff'])
  assert.equal(permissionsFor('super_admin').includes('analytics.read'), false)
  assert.equal(permissionsFor('staff').includes('user.manage'), false)
  assert.equal(permissionsFor('staff').includes('analytics.workspace.use'), false)
  assert.deepEqual(permissionsFor('unknown'), [])
  for (const role of ['super_admin', 'analyst', 'staff', 'viewer', 'unknown']) {
    const business = role === 'analyst' || role === 'staff'
    assert.equal(canAccessChat(role), business)
    assert.equal(permissionsFor(role).includes('insight.read'), business)
  }
})

test('staff reads summaries but cannot access workspace or mutations', () => {
  for (const role of ['staff', 'analyst', 'super_admin', 'unknown']) {
    for (const [method, path, summary] of [
      ['GET', '/api/v2/analytics/overview', true],
      ['GET', '/api/v2/analytics/funnels/commerce', true],
      ['GET', '/api/v2/analytics/journeys', false],
      ['GET', '/api/v2/analytics/events', false],
      ['GET', '/api/v2/analytics/data-health', false],
      ['GET', '/api/v2/analytics/funnels/commerce/private', false],
      ['POST', '/api/v2/analytics/overview', false],
    ]) {
      let status = 200, allowed = false
      const res = { status(value) { status = value; return this }, json() {} }
      requireAnalyticsCapability({ method, path, user: { role } }, res, () => { allowed = true })
      const expected = role === 'analyst' || (role === 'staff' && summary)
      assert.equal(allowed, expected, `${role} ${method} ${path}`)
      assert.equal(status, expected ? 200 : 403)
    }
  }
})
