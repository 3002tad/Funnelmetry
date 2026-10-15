import { useEffect, useState } from "react"

export type ThemePreference = "light" | "dark" | "system"
const storageKey = "funnelmetry.theme"

export function parseThemePreference(value: string | null): ThemePreference {
  return value === "light" || value === "dark" || value === "system" ? value : "system"
}

export function resolveTheme(preference: ThemePreference, systemDark: boolean): "light" | "dark" {
  return preference === "system" ? (systemDark ? "dark" : "light") : preference
}

function storedPreference(): ThemePreference {
  try {
    return parseThemePreference(localStorage.getItem(storageKey))
  } catch {
    return "system"
  }
}

export function useThemePreference() {
  const [preference, setPreference] = useState<ThemePreference>(storedPreference)
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)")
    const apply = () => {
      const isDark = resolveTheme(preference, media.matches) === "dark"
      document.documentElement.classList.toggle("dark", isDark)
      document.documentElement.style.colorScheme = isDark ? "dark" : "light"
      document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute("content", isDark ? "#121726" : "#f5f7fb")
    }
    apply()
    media.addEventListener("change", apply)
    try { localStorage.setItem(storageKey, preference) } catch { /* Storage can be disabled. */ }
    return () => media.removeEventListener("change", apply)
  }, [preference])
  return [preference, setPreference] as const
}
