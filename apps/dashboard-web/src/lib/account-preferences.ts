import type { ThemePreference } from "../app/useThemePreference"

export type AccountPreferences = {
  theme: ThemePreference
  language: "vi" | "en"
  timezone: string
  date_format: "locale" | "iso"
  number_format: "locale" | "plain"
  notifications_enabled: boolean
  analytics_default_days: 7 | 30 | 90
}

export type PreferencesResponse = { preferences: AccountPreferences; updated_at: string | null }

export const accountPreferencesKey = (userId: string | undefined) => ["account-preferences", userId] as const
