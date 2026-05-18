import { ReactNode } from 'react'
import clsx from 'clsx'

interface CardProps {
  title?: string;
  children: ReactNode;
  className?: string;
  loading?: boolean;
  error?: string;
}

export default function Card({ title, children, className, loading, error }: CardProps) {
  return (
    <div className={clsx('glass rounded-2xl shadow-xl shadow-slate-950/40', className)}>
      {title && (
        <div className="px-6 py-4 border-b border-slate-800/60">
          <h3 className="text-base font-semibold text-slate-100">{title}</h3>
        </div>
      )}
      <div className="p-6">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-400"></div>
          </div>
        ) : error ? (
          <div className="text-center py-8">
            <p className="text-rose-400 text-sm">{error}</p>
          </div>
        ) : (
          children
        )}
      </div>
    </div>
  )
}
