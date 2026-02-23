import { ReactNode } from 'react'
import clsx from 'clsx'
import { TrendingUp, TrendingDown } from 'lucide-react'

interface KPICardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  trend?: 'up' | 'down' | 'neutral';
  icon?: ReactNode;
  color?: 'primary' | 'success' | 'warning' | 'danger';
}

const colorClasses = {
  primary: 'bg-blue-50 text-primary',
  success: 'bg-green-50 text-success',
  warning: 'bg-yellow-50 text-warning',
  danger: 'bg-red-50 text-danger',
}

export default function KPICard({ title, value, subtitle, trend, icon, color = 'primary' }: KPICardProps) {
  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <p className="text-sm font-medium text-gray-600 mb-1">{title}</p>
          <p className="text-3xl font-bold text-gray-900 mb-1">{value}</p>
          {subtitle && (
            <div className="flex items-center gap-2">
              <p className="text-sm text-gray-500">{subtitle}</p>
              {trend && trend !== 'neutral' && (
                <span className={clsx('text-sm font-medium flex items-center gap-1', {
                  'text-success': trend === 'up',
                  'text-danger': trend === 'down',
                })}>
                  {trend === 'up' ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                </span>
              )}
            </div>
          )}
        </div>
        {icon && (
          <div className={clsx('w-12 h-12 rounded-lg flex items-center justify-center', colorClasses[color])}>
            {icon}
          </div>
        )}
      </div>
    </div>
  )
}
