import { Monitor, Moon, Sun } from "lucide-react"
import type { ThemePreference } from "../../app/useThemePreference"

export function ThemeSelect({ value, onChange, disabled = false }: { value: ThemePreference; onChange: (value: ThemePreference) => void; disabled?: boolean }) {
  return <div className="theme-select-wrap">
    {value === "light" ? <Sun size={15} aria-hidden="true" /> : value === "dark" ? <Moon size={15} aria-hidden="true" /> : <Monitor size={15} aria-hidden="true" />}
    <label className="sr-only" htmlFor="theme-preference">Giao diện</label>
    <select id="theme-preference" className="theme-select" value={value} disabled={disabled} onChange={event => onChange(event.target.value as ThemePreference)}>
      <option value="system">Hệ thống</option><option value="light">Sáng</option><option value="dark">Tối</option>
    </select>
  </div>
}
