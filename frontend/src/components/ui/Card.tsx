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
    <div className={clsx('bg-white rounded-lg shadow-sm border border-gray-200', className)}>
      {title && (
        <div className="px-6 py-4 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
        </div>
      )}
      <div className="p-6">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          </div>
        ) : error ? (
          <div className="text-center py-8">
            <p className="text-danger text-sm">{error}</p>
          </div>
        ) : (
          children
        )}
      </div>
    </div>
  )
}
