export const DEFAULT_PREFERENCES = Object.freeze({
  theme: 'system', language: 'vi', timezone: 'Asia/Ho_Chi_Minh',
  date_format: 'locale', number_format: 'locale', notifications_enabled: true,
  analytics_default_days: 30,
})

const choices = {
  theme: ['light', 'dark', 'system'], language: ['vi', 'en'],
  date_format: ['locale', 'iso'], number_format: ['locale', 'plain'],
  analytics_default_days: [7, 30, 90],
}
export function parsePreferencesPatch(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)
    || !Object.keys(body).length) throw Error('invalid_preferences')
  const patch = {}
  for (const [key, value] of Object.entries(body)) {
    if (!Object.hasOwn(DEFAULT_PREFERENCES, key)) throw Error('unknown_preference')
    if (Object.hasOwn(choices, key) && !choices[key].includes(value)) throw Error(`invalid_${key}`)
    if (key === 'notifications_enabled' && typeof value !== 'boolean') throw Error('invalid_notifications_enabled')
    if (key === 'timezone') {
      if (typeof value !== 'string' || value.length > 100 || !/^[A-Za-z_]+(?:\/[A-Za-z0-9_+\-]+)*$/.test(value)) throw Error('invalid_timezone')
      try { new Intl.DateTimeFormat('en', { timeZone: value }) } catch { throw Error('invalid_timezone') }
    }
    patch[key] = value
  }
  return patch
}
