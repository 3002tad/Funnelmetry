import { NavLink } from "react-router-dom"
import { cn } from "../../lib/utils"

export function TabNav({ label, items }: { label: string; items: { to: string; label: string }[] }) {
  return <nav aria-label={label} className="tab-nav">
    {items.map(item => <NavLink end key={item.to} to={item.to} className={({ isActive }) => cn("tab-link", isActive && "tab-link-active")}>{item.label}</NavLink>)}
  </nav>
}
