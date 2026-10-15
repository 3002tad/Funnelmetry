import test from 'node:test'
import assert from 'node:assert/strict'
import { parseThemePreference, resolveTheme } from '../src/app/useThemePreference.ts'

test('theme preference rejects invalid stored values', () => {
  assert.equal(parseThemePreference(null), 'system')
  assert.equal(parseThemePreference('unexpected'), 'system')
  assert.equal(parseThemePreference('dark'), 'dark')
})

test('system follows OS preference while explicit light/dark overrides it', () => {
  assert.equal(resolveTheme('system', true), 'dark')
  assert.equal(resolveTheme('system', false), 'light')
  assert.equal(resolveTheme('light', true), 'light')
  assert.equal(resolveTheme('dark', false), 'dark')
})
