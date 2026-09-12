import test from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_PREFERENCES, parsePreferencesPatch } from '../src/lib/account-preferences.js'

test('preferences allow only bounded display settings, never profile or authorization fields', () => {
  assert.deepEqual(parsePreferencesPatch({ ...DEFAULT_PREFERENCES }), DEFAULT_PREFERENCES)
  assert.deepEqual(parsePreferencesPatch({ theme: 'light', notifications_enabled: false }), { theme: 'light', notifications_enabled: false })
  for (const body of [null, [], {}, 'dark', { role: 'super_admin' }, { user_id: 'other' },
    { display_name: 'name' }, { theme: 'purple' }, { language: 'fr' }, { timezone: 'Mars/Test' },
    { timezone: '+07:00' }, { notifications_enabled: 'false' }, { analytics_default_days: '30' },
    { analytics_default_days: 0 }, { number_format: null }, JSON.parse('{"__proto__":{}}')]) {
    assert.throws(() => parsePreferencesPatch(body))
  }
})
