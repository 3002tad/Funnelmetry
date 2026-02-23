import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api, Event, EventType, EventStatus } from '@/lib/api'
import { format } from 'date-fns'
import { Search, Filter, ChevronLeft, ChevronRight, Eye } from 'lucide-react'
import Card from '@/components/ui/Card'
import Modal from '@/components/ui/Modal'
import EmptyState, { LoadingSpinner } from '@/components/ui/EmptyState'
import clsx from 'clsx'

export default function Events() {
  const [page, setPage] = useState(1)
  const [pageSize] = useState(20)
  const [filterEventType, setFilterEventType] = useState<EventType | 'all'>('all')
  const [filterStatus, setFilterStatus] = useState<EventStatus | 'all'>('all')
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null)

  // Fetch events
  const { data, isLoading, error } = useQuery({
    queryKey: ['events', page, pageSize, filterEventType, filterStatus],
    queryFn: () => api.getEvents({
      page,
      pageSize,
      ...(filterEventType !== 'all' && { eventType: filterEventType }),
      ...(filterStatus !== 'all' && { status: filterStatus }),
    }),
  })

  const totalPages = data ? Math.ceil(data.total / pageSize) : 0

  const eventTypeOptions: { value: EventType | 'all'; label: string }[] = [
    { value: 'all', label: 'All Types' },
    { value: 'order_created', label: 'Order Created' },
    { value: 'payment_initiated', label: 'Payment Initiated' },
    { value: 'payment_success', label: 'Payment Success' },
    { value: 'payment_failed', label: 'Payment Failed' },
    { value: 'order_cancelled', label: 'Order Cancelled' },
  ]

  const statusOptions: { value: EventStatus | 'all'; label: string }[] = [
    { value: 'all', label: 'All Status' },
    { value: 'success', label: 'Success' },
    { value: 'failed', label: 'Failed' },
    { value: 'pending', label: 'Pending' },
  ]

  const getEventTypeBadgeColor = (eventType: EventType) => {
    switch (eventType) {
      case 'order_created': return 'bg-blue-100 text-blue-800'
      case 'payment_initiated': return 'bg-purple-100 text-purple-800'
      case 'payment_success': return 'bg-green-100 text-green-800'
      case 'payment_failed': return 'bg-red-100 text-red-800'
      case 'order_cancelled': return 'bg-gray-100 text-gray-800'
    }
  }

  const getStatusBadgeColor = (status: EventStatus) => {
    switch (status) {
      case 'success': return 'bg-green-100 text-green-800'
      case 'failed': return 'bg-red-100 text-red-800'
      case 'pending': return 'bg-yellow-100 text-yellow-800'
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Events Log</h1>
        <p className="text-sm text-gray-500 mt-1">Clean events from data processing pipeline</p>
      </div>

      {/* Filters */}
      <Card>
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <Filter size={18} className="text-gray-400" />
            <span className="text-sm font-medium text-gray-700">Filters:</span>
          </div>

          <select
            value={filterEventType}
            onChange={(e) => {
              setFilterEventType(e.target.value as EventType | 'all')
              setPage(1)
            }}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          >
            {eventTypeOptions.map(option => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>

          <select
            value={filterStatus}
            onChange={(e) => {
              setFilterStatus(e.target.value as EventStatus | 'all')
              setPage(1)
            }}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          >
            {statusOptions.map(option => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>

          {(filterEventType !== 'all' || filterStatus !== 'all') && (
            <button
              onClick={() => {
                setFilterEventType('all')
                setFilterStatus('all')
                setPage(1)
              }}
              className="text-sm text-primary hover:text-blue-700 font-medium"
            >
              Clear filters
            </button>
          )}

          <div className="ml-auto text-sm text-gray-500">
            Total: <span className="font-semibold">{data?.total.toLocaleString()}</span> events
          </div>
        </div>
      </Card>

      {/* Events Table */}
      <Card loading={isLoading} error={error ? 'Failed to load events' : undefined}>
        {data?.events && data.events.length > 0 ? (
          <>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left text-xs font-semibold text-gray-600 uppercase tracking-wider py-3 px-4">Event Time</th>
                    <th className="text-left text-xs font-semibold text-gray-600 uppercase tracking-wider py-3 px-4">Event Type</th>
                    <th className="text-left text-xs font-semibold text-gray-600 uppercase tracking-wider py-3 px-4">Order ID</th>
                    <th className="text-left text-xs font-semibold text-gray-600 uppercase tracking-wider py-3 px-4">User ID</th>
                    <th className="text-right text-xs font-semibold text-gray-600 uppercase tracking-wider py-3 px-4">Amount</th>
                    <th className="text-center text-xs font-semibold text-gray-600 uppercase tracking-wider py-3 px-4">Status</th>
                    <th className="text-center text-xs font-semibold text-gray-600 uppercase tracking-wider py-3 px-4">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {data.events.map(event => (
                    <tr key={event.id} className="hover:bg-gray-50 transition-colors">
                      <td className="py-3 px-4 text-sm text-gray-900">
                        {format(new Date(event.eventTime), 'dd/MM/yyyy HH:mm:ss')}
                      </td>
                      <td className="py-3 px-4">
                        <span className={clsx('inline-flex px-2 py-1 text-xs font-medium rounded', getEventTypeBadgeColor(event.eventType))}>
                          {event.eventType.replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-sm font-mono text-gray-700">{event.orderId}</td>
                      <td className="py-3 px-4 text-sm font-mono text-gray-700">{event.userId}</td>
                      <td className="py-3 px-4 text-sm text-right font-medium text-gray-900">
                        {event.amount.toLocaleString()} {event.currency}
                      </td>
                      <td className="py-3 px-4 text-center">
                        <span className={clsx('inline-flex px-2 py-1 text-xs font-medium rounded', getStatusBadgeColor(event.status))}>
                          {event.status}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-center">
                        <button
                          onClick={() => setSelectedEvent(event)}
                          className="text-primary hover:text-blue-700 transition-colors"
                          title="View details"
                        >
                          <Eye size={18} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <div className="flex items-center justify-between mt-6 pt-6 border-t border-gray-200">
              <div className="text-sm text-gray-700">
                Showing <span className="font-medium">{(page - 1) * pageSize + 1}</span> to{' '}
                <span className="font-medium">{Math.min(page * pageSize, data.total)}</span> of{' '}
                <span className="font-medium">{data.total}</span> results
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="px-3 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronLeft size={18} />
                </button>

                <span className="text-sm text-gray-700">
                  Page <span className="font-medium">{page}</span> of <span className="font-medium">{totalPages}</span>
                </span>

                <button
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="px-3 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronRight size={18} />
                </button>
              </div>
            </div>
          </>
        ) : (
          <EmptyState
            title="No events found"
            description="Try adjusting your filters or check back later"
            icon={<Search size={48} />}
          />
        )}
      </Card>

      {/* Event Detail Modal */}
      <Modal
        isOpen={selectedEvent !== null}
        onClose={() => setSelectedEvent(null)}
        title="Event Details"
        size="lg"
      >
        {selectedEvent && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-semibold text-gray-500 uppercase">Event ID</label>
                <p className="text-sm font-mono text-gray-900 mt-1">{selectedEvent.id}</p>
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-500 uppercase">Event Time</label>
                <p className="text-sm text-gray-900 mt-1">
                  {format(new Date(selectedEvent.eventTime), 'dd/MM/yyyy HH:mm:ss')}
                </p>
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-500 uppercase">Event Type</label>
                <p className="mt-1">
                  <span className={clsx('inline-flex px-2 py-1 text-xs font-medium rounded', getEventTypeBadgeColor(selectedEvent.eventType))}>
                    {selectedEvent.eventType.replace(/_/g, ' ')}
                  </span>
                </p>
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-500 uppercase">Status</label>
                <p className="mt-1">
                  <span className={clsx('inline-flex px-2 py-1 text-xs font-medium rounded', getStatusBadgeColor(selectedEvent.status))}>
                    {selectedEvent.status}
                  </span>
                </p>
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-500 uppercase">Order ID</label>
                <p className="text-sm font-mono text-gray-900 mt-1">{selectedEvent.orderId}</p>
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-500 uppercase">User ID</label>
                <p className="text-sm font-mono text-gray-900 mt-1">{selectedEvent.userId}</p>
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-500 uppercase">Amount</label>
                <p className="text-sm font-medium text-gray-900 mt-1">
                  {selectedEvent.amount.toLocaleString()} {selectedEvent.currency}
                </p>
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-500 uppercase">Currency</label>
                <p className="text-sm text-gray-900 mt-1">{selectedEvent.currency}</p>
              </div>
            </div>

            {selectedEvent.metadata && (
              <div>
                <label className="text-xs font-semibold text-gray-500 uppercase">Metadata</label>
                <pre className="mt-2 p-4 bg-gray-50 rounded-lg text-xs font-mono overflow-auto">
                  {JSON.stringify(selectedEvent.metadata, null, 2)}
                </pre>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}
