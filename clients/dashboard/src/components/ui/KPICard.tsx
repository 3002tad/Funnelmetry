import { ReactNode } from 'react'
import clsx from 'clsx'
import { TrendingUp, TrendingDown } from 'lucide-react'
import Sparkline from './Sparkline'
import AnimatedNumber from './AnimatedNumber'

interface KPICardProps {
  title: string;
  value: number | string;          // raw number (preferred) or pre-formatted string
  format?: (n: number) => string;  // formatter when value is number
  subtitle?: string;
  trend?: 'up' | 'down' | 'neutral';
  changePct?: number | null;       // e.g. +12.5 or -3.2
  icon?: ReactNode;
  color?: 'primary' | 'success' | 'warning' | 'danger';
  sparkline?: number[];
  onClick?: () => void;
}

const gradients = {
  primary: 'from-indigo-500 to-violet-600',
  success: 'from-emerald-500 to-teal-600',
  warning: 'from-amber-500 to-orange-600',
  danger:  'from-rose-500 to-pink-600',
}

const sparkColors = {
  primary: '#818CF8',
  success: '#34D399',
  warning: '#FBBF24',
  danger:  '#F87171',
}

const glows = {
  primary: 'shadow-indigo-500/20  hover:shadow-indigo-500/40',
  success: 'shadow-emerald-500/20 hover:shadow-emerald-500/40',
  warning: 'shadow-amber-500/20   hover:shadow-amber-500/40',
  danger:  'shadow-rose-500/20    hover:shadow-rose-500/40',
}

export default function KPICard({
  title,
  value,
  format = (n) => n.toLocaleString(),
  subtitle,
  trend,
  changePct,
  icon,
  color = 'primary',
  sparkline,
  onClick,
}: KPICardProps) {
  const isNumber = typeof value === 'number'

  return (
    <div
      className={clsx(
        "group relative glass rounded-2xl p-5 transition-all duration-300 overflow-hidden h-full flex flex-col",
        "hover:bg-slate-900/80 hover:-translate-y-0.5 shadow-lg",
        glows[color],
        onClick && "cursor-pointer hover:ring-1 hover:ring-indigo-400/40",
      )}
      onClick={onClick}
    >
      <div className={clsx(
        "absolute top-0 left-4 right-4 h-px bg-gradient-to-r opacity-60",
        gradients[color],
      )} />

      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-medium text-slate-400 uppercase tracking-wider mb-2 truncate">{title}</p>
          <p className="text-2xl font-bold text-slate-50 tabular-nums tracking-tight">
            {isNumber ? <AnimatedNumber value={value} format={format} /> : value}
          </p>
          {(subtitle || changePct != null) && (
            <div className="flex items-center gap-1.5 mt-1.5">
              {changePct != null ? (
                <span className={clsx('text-xs font-semibold flex items-center gap-0.5 tabular-nums', {
                  'text-emerald-400': changePct > 0,
                  'text-rose-400':    changePct < 0,
                  'text-slate-500':   changePct === 0,
                })}>
                  {changePct > 0 ? <TrendingUp size={12} /> : changePct < 0 ? <TrendingDown size={12} /> : null}
                  {changePct > 0 ? '+' : ''}{changePct.toFixed(1)}%
                </span>
              ) : trend && trend !== 'neutral' ? (
                <span className={clsx('text-xs font-semibold flex items-center gap-0.5', {
                  'text-emerald-400': trend === 'up',
                  'text-rose-400':    trend === 'down',
                })}>
                  {trend === 'up' ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                </span>
              ) : null}
              {subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}
            </div>
          )}
        </div>
        {icon && (
          <div className={clsx(
            'w-9 h-9 rounded-lg flex items-center justify-center text-white shrink-0',
            'bg-gradient-to-br shadow-md',
            gradients[color],
            glows[color],
          )}>
            {icon}
          </div>
        )}
      </div>

      {sparkline && sparkline.length > 1 && (
        <div className="mt-3 -mx-1 opacity-80 group-hover:opacity-100 transition-opacity">
          <Sparkline data={sparkline} color={sparkColors[color]} height={36} />
        </div>
      )}
    </div>
  )
}
