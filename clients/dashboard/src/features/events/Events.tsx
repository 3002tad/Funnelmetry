import { useState, useEffect, useRef, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { api, Event, EventType, EventStatus } from '@/lib/api'
import { format } from 'date-fns'
import {
  Search,
  Filter,
  ChevronLeft,
  ChevronRight,
  Eye,
  Download,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  RefreshCw,
  X,
  Radio,
  Pause,
  ChevronDown,
  ChevronUp,
} from 'lucide-react'
import Card from '@/components/ui/Card'
import Modal from '@/components/ui/Modal'
import PipelineTrace from '@/components/ui/PipelineTrace'
import EmptyState from '@/components/ui/EmptyState'
import clsx from 'clsx'

type SortField = 'event_time' | 'event_type' | 'user_id' | 'amount' | 'status'

/* ─── colour helpers ─── */
const getEventTypeBadgeColor = (eventType: EventType) => {
  switch (eventType) {
    case 'order_created':     return 'bg-indigo-500/15 text-indigo-300 ring-1 ring-indigo-500/30'
    case 'payment_initiated': return 'bg-violet-500/15 text-violet-300 ring-1 ring-violet-500/30'
    case 'payment_success':   return 'bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30'
    case 'payment_failed':    return 'bg-rose-500/15 text-rose-300 ring-1 ring-rose-500/30'
    case 'order_cancelled':   return 'bg-slate-700/40 text-slate-300 ring-1 ring-slate-600/40'
  }
}

const getStatusBadgeColor = (status: EventStatus) => {
  switch (status) {
    case 'success': return 'bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30'
    case 'failed':  return 'bg-rose-500/15 text-rose-300 ring-1 ring-rose-500/30'
    case 'pending': return 'bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/30'
  }
}

/* ─── Statistics Card ─── */
function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className={clsx('rounded-lg p-4', color)}>
      <div className="text-2xl font-bold">{value.toLocaleString()}</div>
      <div className="text-sm opacity-80">{label}</div>
    </div>
  )
}

export default function Events() {
  const [searchParams, setSearchParams] = useSearchParams()

  /* ─── Live Feed state ─── */
  const [liveFeed, setLiveFeed] = useState(true)
  const [liveEvents, setLiveEvents] = useState<Event[]>([])
  const [totalEvents, setTotalEvents] = useState(0)
  const [statusCounts, setStatusCounts] = useState({ success: 0, pending: 0, failed: 0 })
  const [newEventIds, setNewEventIds] = useState<Set<string>>(new Set())
  const [showLiveFeed, setShowLiveFeed] = useState(true)
  const prevEventIdsRef = useRef<Set<string>>(new Set())
  const feedRef = useRef<HTMLDivElement>(null)

  /* ─── Table state ─── */
  const [page, setPage] = useState(1)
  const [pageSize] = useState(20)
  const [filterEventType, setFilterEventType] = useState<EventType | 'all'>(
    (searchParams.get('eventType') as EventType) || 'all'
  )
  const [filterStatus, setFilterStatus] = useState<EventStatus | 'all'>(
    (searchParams.get('status') as EventStatus) || 'all'
  )
  const [searchQuery, setSearchQuery] = useState(searchParams.get('search') || '')
  const [searchInput, setSearchInput] = useState(searchParams.get('search') || '')
  const [sortBy, setSortBy] = useState<SortField>('event_time')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [autoRefresh, setAutoRefresh] = useState(false)
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null)

  /* ─── Live feed polling (like Generator Dashboard) ─── */
  const fetchLiveEvents = useCallback(async () => {
    try {
      const res = await api.getEvents({ page: 1, pageSize: 50, sortBy: 'event_time', sortDir: 'desc' })
      // Detect new events for highlight animation
      const currentIds = new Set(res.events.map(e => e.id))
      const freshIds = new Set<string>()
      for (const id of currentIds) {
        if (!prevEventIdsRef.current.has(id)) freshIds.add(id)
      }
      prevEventIdsRef.current = currentIds

      if (freshIds.size > 0 && freshIds.size < 50) {
        setNewEventIds(freshIds)
        // Clear highlights after animation
        setTimeout(() => setNewEventIds(new Set()), 2000)
      }

      setLiveEvents(res.events)
      setTotalEvents(res.total)
      if (res.statusCounts) setStatusCounts(res.statusCounts)
    } catch {
      // API not reachable — keep current state
    }
  }, [])

  useEffect(() => {
    if (!liveFeed) return
    fetchLiveEvents() // immediate
    const timer = setInterval(fetchLiveEvents, 3000)
    return () => clearInterval(timer)
  }, [liveFeed, fetchLiveEvents])

  /* ─── URL sync ─── */
  useEffect(() => {
    const params: Record<string, string> = {}
    if (filterEventType !== 'all') params.eventType = filterEventType
    if (filterStatus !== 'all') params.status = filterStatus
    if (searchQuery) params.search = searchQuery
    setSearchParams(params, { replace: true })
  }, [filterEventType, filterStatus, searchQuery, setSearchParams])

  /* ─── Table data query ─── */
  const { data, isLoading, error } = useQuery({
    queryKey: ['events', page, pageSize, filterEventType, filterStatus, searchQuery, sortBy, sortDir],
    queryFn: () =>
      api.getEvents({
        page,
        pageSize,
        ...(filterEventType !== 'all' && { eventType: filterEventType }),
        ...(filterStatus !== 'all' && { status: filterStatus }),
        ...(searchQuery && { search: searchQuery }),
        sortBy,
        sortDir,
      }),
    refetchInterval: autoRefresh ? 3000 : false,
  })

  /* ─── Trace data ─── */
  const { data: traceData, isLoading: traceLoading } = useQuery({
    queryKey: ['eventTrace', selectedEvent?.id],
    queryFn: () => api.getEventTrace(selectedEvent!.id),
    enabled: !!selectedEvent,
  })

  const totalPages = data ? Math.ceil(data.total / pageSize) : 0

  const handleSearch = () => {
    setSearchQuery(searchInput)
    setPage(1)
  }

  const handleSort = (field: SortField) => {
    if (sortBy === field) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortBy(field)
      setSortDir('desc')
    }
    setPage(1)
  }

  const clearAllFilters = () => {
    setFilterEventType('all')
    setFilterStatus('all')
    setSearchQuery('')
    setSearchInput('')
    setSortBy('event_time')
    setSortDir('desc')
    setPage(1)
  }

  const hasActiveFilters = filterEventType !== 'all' || filterStatus !== 'all' || searchQuery !== ''

  const handleExport = () => {
    const url = api.getExportUrl({
      ...(filterEventType !== 'all' && { eventType: filterEventType }),
      ...(filterStatus !== 'all' && { status: filterStatus }),
      ...(searchQuery && { search: searchQuery }),
    })
    window.open(url, '_blank')
  }

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

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortBy !== field) return <ArrowUpDown size={14} className="text-slate-600" />
    return sortDir === 'asc' ? <ArrowUp size={14} className="text-indigo-400" /> : <ArrowDown size={14} className="text-indigo-400" />
  }

  return (
    <div className="space-y-6">
      {/* ═══════════════ LIVE EVENT FEED (Generator-style) ═══════════════ */}
      <div className="glass rounded-xl shadow-sm border border-slate-800/60 overflow-hidden">
        {/* Live feed header */}
        <div className="px-6 py-4 border-b border-slate-800/60 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              {liveFeed && (
                <span className="relative flex h-3 w-3">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500" />
                </span>
              )}
              <h2 className="text-xl font-bold text-slate-100">Live Event Feed</h2>
            </div>
            <span className="text-sm text-slate-500">
              {liveFeed ? 'Streaming...' : 'Paused'}
              {liveEvents.length > 0 && ` — showing ${liveEvents.length} of ${totalEvents.toLocaleString()}`}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowLiveFeed(v => !v)}
              className="p-2 text-slate-500 hover:text-slate-400 transition"
              title={showLiveFeed ? 'Collapse' : 'Expand'}
            >
              {showLiveFeed ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
            </button>
            <button
              onClick={() => setLiveFeed(!liveFeed)}
              className={clsx(
                'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all',
                liveFeed
                  ? 'bg-emerald-500 text-white shadow-sm hover:bg-emerald-600'
                  : 'bg-slate-800/60 text-slate-400 hover:bg-slate-800'
              )}
            >
              {liveFeed ? <Radio size={16} className="animate-pulse" /> : <Pause size={16} />}
              {liveFeed ? 'Live' : 'Paused'}
            </button>
          </div>
        </div>

        {showLiveFeed && (
          <>
            {/* Statistics cards */}
            <div className="px-6 py-4 bg-slate-800/40 border-b border-slate-800/60">
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <StatCard label="Total Events" value={totalEvents} color="bg-indigo-500/10 text-indigo-300 ring-1 ring-indigo-500/30" />
                <StatCard label="Success" value={statusCounts.success} color="bg-emerald-500/10 text-emerald-300 ring-1 ring-emerald-500/30" />
                <StatCard label="Pending" value={statusCounts.pending} color="bg-amber-500/10 text-amber-300 ring-1 ring-amber-500/30" />
                <StatCard label="Failed" value={statusCounts.failed} color="bg-rose-500/10 text-rose-300 ring-1 ring-rose-500/30" />
              </div>
            </div>

            {/* Live event table */}
            <div ref={feedRef} className="overflow-x-auto max-h-[500px] overflow-y-auto">
              <table className="w-full">
                <thead className="bg-slate-800/40 sticky top-0 z-10">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Time</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Event Type</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Order ID</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">User ID</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-slate-500 uppercase tracking-wider">Amount</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-slate-500 uppercase tracking-wider">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {liveEvents.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-12 text-center text-slate-500">
                        <div className="flex flex-col items-center gap-2">
                          <Radio size={32} className="text-slate-600" />
                          <span>No events yet. Start the data pipeline to see events streaming here.</span>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    liveEvents.map((event) => (
                      <tr
                        key={event.id}
                        onClick={() => setSelectedEvent(event)}
                        className={clsx(
                          'cursor-pointer transition-all duration-500',
                          newEventIds.has(event.id)
                            ? 'bg-indigo-500/15 animate-pulse'
                            : 'hover:bg-slate-800/40'
                        )}
                      >
                        <td className="px-4 py-2.5 text-sm text-slate-100 whitespace-nowrap">
                          {format(new Date(event.eventTime), 'HH:mm:ss')}
                        </td>
                        <td className="px-4 py-2.5">
                          <span className={clsx(
                            'inline-flex px-2 py-0.5 text-xs font-medium rounded',
                            getEventTypeBadgeColor(event.eventType)
                          )}>
                            {event.eventType.replace(/_/g, ' ')}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-xs font-mono text-slate-500">
                          {event.orderId.slice(0, 12)}...
                        </td>
                        <td className="px-4 py-2.5 text-xs font-mono text-slate-500">
                          {event.userId}
                        </td>
                        <td className="px-4 py-2.5 text-sm text-right font-medium text-slate-100">
                          {event.amount.toLocaleString()} {event.currency}
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          <span className={clsx(
                            'inline-flex px-2 py-0.5 text-xs font-medium rounded',
                            getStatusBadgeColor(event.status)
                          )}>
                            {event.status}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* ═══════════════ FULL EVENTS TABLE (with search/filter/sort/pagination) ═══════════════ */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-100">Events Explorer</h2>
          <p className="text-sm text-slate-500 mt-1">Search, filter and explore all pipeline events</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={clsx(
              'flex items-center gap-2 px-4 py-2 rounded-lg border text-sm font-medium transition-colors',
              autoRefresh
                ? 'bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/40'
                : 'glass text-slate-400 border-slate-800/60 hover:bg-slate-800/40'
            )}
          >
            <RefreshCw size={16} className={autoRefresh ? 'animate-spin' : ''} />
            {autoRefresh ? 'Auto-refresh' : 'Manual'}
          </button>
          <button
            onClick={handleExport}
            className="flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-800/60 glass text-sm font-medium text-slate-300 hover:bg-slate-800/40 transition-colors"
            title="Export filtered events as CSV (max 10,000)"
          >
            <Download size={16} />
            Export CSV
          </button>
        </div>
      </div>

      {/* Search + Filters */}
      <Card>
        <div className="space-y-4">
          <div className="flex gap-3">
            <div className="flex-1 relative">
              <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                type="text"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                placeholder="Search by User ID, Order ID, or Event ID..."
                className="w-full pl-10 pr-4 py-2 border border-slate-700/60 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
              />
              {searchInput && (
                <button
                  onClick={() => { setSearchInput(''); setSearchQuery(''); setPage(1) }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-400"
                >
                  <X size={16} />
                </button>
              )}
            </div>
            <button
              onClick={handleSearch}
              className="px-6 py-2 bg-indigo-500 text-white rounded-lg text-sm font-medium hover:bg-indigo-600 transition-colors"
            >
              Search
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <Filter size={18} className="text-slate-500" />
              <span className="text-sm font-medium text-slate-300">Filters:</span>
            </div>

            <select
              value={filterEventType}
              onChange={(e) => {
                setFilterEventType(e.target.value as EventType | 'all')
                setPage(1)
              }}
              className="px-3 py-2 border border-slate-700/60 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            >
              {eventTypeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>

            <select
              value={filterStatus}
              onChange={(e) => {
                setFilterStatus(e.target.value as EventStatus | 'all')
                setPage(1)
              }}
              className="px-3 py-2 border border-slate-700/60 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            >
              {statusOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>

            {hasActiveFilters && (
              <button
                onClick={clearAllFilters}
                className="flex items-center gap-1 text-sm text-indigo-300 hover:text-indigo-200 font-medium"
              >
                <X size={14} /> Clear all
              </button>
            )}

            <div className="ml-auto text-sm text-slate-500">
              Total: <span className="font-semibold">{data?.total.toLocaleString() ?? '...'}</span> events
            </div>
          </div>

          {hasActiveFilters && (
            <div className="flex flex-wrap gap-2">
              {filterEventType !== 'all' && (
                <span className="inline-flex items-center gap-1 px-3 py-1 bg-indigo-500/15 text-indigo-300 ring-1 ring-indigo-500/30 text-xs font-medium rounded-full">
                  Type: {filterEventType.replace(/_/g, ' ')}
                  <button onClick={() => { setFilterEventType('all'); setPage(1) }}><X size={12} /></button>
                </span>
              )}
              {filterStatus !== 'all' && (
                <span className="inline-flex items-center gap-1 px-3 py-1 bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30 text-xs font-medium rounded-full">
                  Status: {filterStatus}
                  <button onClick={() => { setFilterStatus('all'); setPage(1) }}><X size={12} /></button>
                </span>
              )}
              {searchQuery && (
                <span className="inline-flex items-center gap-1 px-3 py-1 bg-violet-500/15 text-violet-300 ring-1 ring-violet-500/30 text-xs font-medium rounded-full">
                  Search: "{searchQuery}"
                  <button onClick={() => { setSearchQuery(''); setSearchInput(''); setPage(1) }}><X size={12} /></button>
                </span>
              )}
            </div>
          )}
        </div>
      </Card>

      {/* Events Table */}
      <Card loading={isLoading} error={error ? 'Failed to load events' : undefined}>
        {data?.events && data.events.length > 0 ? (
          <>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-800/60">
                    <th
                      className="text-left text-xs font-semibold text-slate-400 uppercase tracking-wider py-3 px-4 cursor-pointer hover:bg-slate-800/40 select-none"
                      onClick={() => handleSort('event_time')}
                    >
                      <div className="flex items-center gap-1">Event Time <SortIcon field="event_time" /></div>
                    </th>
                    <th
                      className="text-left text-xs font-semibold text-slate-400 uppercase tracking-wider py-3 px-4 cursor-pointer hover:bg-slate-800/40 select-none"
                      onClick={() => handleSort('event_type')}
                    >
                      <div className="flex items-center gap-1">Event Type <SortIcon field="event_type" /></div>
                    </th>
                    <th className="text-left text-xs font-semibold text-slate-400 uppercase tracking-wider py-3 px-4">
                      Order ID
                    </th>
                    <th
                      className="text-left text-xs font-semibold text-slate-400 uppercase tracking-wider py-3 px-4 cursor-pointer hover:bg-slate-800/40 select-none"
                      onClick={() => handleSort('user_id')}
                    >
                      <div className="flex items-center gap-1">User ID <SortIcon field="user_id" /></div>
                    </th>
                    <th
                      className="text-right text-xs font-semibold text-slate-400 uppercase tracking-wider py-3 px-4 cursor-pointer hover:bg-slate-800/40 select-none"
                      onClick={() => handleSort('amount')}
                    >
                      <div className="flex items-center justify-end gap-1">Amount <SortIcon field="amount" /></div>
                    </th>
                    <th
                      className="text-center text-xs font-semibold text-slate-400 uppercase tracking-wider py-3 px-4 cursor-pointer hover:bg-slate-800/40 select-none"
                      onClick={() => handleSort('status')}
                    >
                      <div className="flex items-center justify-center gap-1">Status <SortIcon field="status" /></div>
                    </th>
                    <th className="text-center text-xs font-semibold text-slate-400 uppercase tracking-wider py-3 px-4">
                      Action
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/40">
                  {data.events.map((event) => (
                    <tr key={event.id} className="hover:bg-slate-800/40 transition-colors">
                      <td className="py-3 px-4 text-sm text-slate-100">
                        {format(new Date(event.eventTime), 'dd/MM/yyyy HH:mm:ss')}
                      </td>
                      <td className="py-3 px-4">
                        <button
                          onClick={() => { setFilterEventType(event.eventType); setPage(1) }}
                          className={clsx(
                            'inline-flex px-2 py-1 text-xs font-medium rounded cursor-pointer hover:opacity-80 transition',
                            getEventTypeBadgeColor(event.eventType)
                          )}
                          title="Click to filter by this type"
                        >
                          {event.eventType.replace(/_/g, ' ')}
                        </button>
                      </td>
                      <td className="py-3 px-4 text-sm font-mono text-slate-300">
                        <button
                          onClick={() => { setSearchInput(event.orderId); setSearchQuery(event.orderId); setPage(1) }}
                          className="hover:text-indigo-400 hover:underline transition"
                          title="Click to search this Order ID"
                        >
                          {event.orderId}
                        </button>
                      </td>
                      <td className="py-3 px-4 text-sm font-mono text-slate-300">
                        <button
                          onClick={() => { setSearchInput(event.userId); setSearchQuery(event.userId); setPage(1) }}
                          className="hover:text-indigo-400 hover:underline transition"
                          title="Click to search this User ID"
                        >
                          {event.userId}
                        </button>
                      </td>
                      <td className="py-3 px-4 text-sm text-right font-medium text-slate-100">
                        {event.amount.toLocaleString()} {event.currency}
                      </td>
                      <td className="py-3 px-4 text-center">
                        <button
                          onClick={() => { setFilterStatus(event.status); setPage(1) }}
                          className={clsx(
                            'inline-flex px-2 py-1 text-xs font-medium rounded cursor-pointer hover:opacity-80 transition',
                            getStatusBadgeColor(event.status)
                          )}
                          title="Click to filter by this status"
                        >
                          {event.status}
                        </button>
                      </td>
                      <td className="py-3 px-4 text-center">
                        <button
                          onClick={() => setSelectedEvent(event)}
                          className="text-indigo-300 hover:text-indigo-200 transition-colors"
                          title="View details & trace"
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
            <div className="flex items-center justify-between mt-6 pt-6 border-t border-slate-800/60">
              <div className="text-sm text-slate-300">
                Showing <span className="font-medium">{(page - 1) * pageSize + 1}</span> to{' '}
                <span className="font-medium">{Math.min(page * pageSize, data.total)}</span> of{' '}
                <span className="font-medium">{data.total.toLocaleString()}</span> results
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage(1)}
                  disabled={page === 1}
                  className="px-3 py-2 border border-slate-700/60 rounded-lg text-xs font-medium text-slate-300 hover:bg-slate-800/40 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  First
                </button>
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="px-3 py-2 border border-slate-700/60 rounded-lg text-sm font-medium text-slate-300 hover:bg-slate-800/40 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronLeft size={18} />
                </button>

                <span className="text-sm text-slate-300">
                  Page <span className="font-medium">{page}</span> of{' '}
                  <span className="font-medium">{totalPages}</span>
                </span>

                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="px-3 py-2 border border-slate-700/60 rounded-lg text-sm font-medium text-slate-300 hover:bg-slate-800/40 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronRight size={18} />
                </button>
                <button
                  onClick={() => setPage(totalPages)}
                  disabled={page === totalPages}
                  className="px-3 py-2 border border-slate-700/60 rounded-lg text-xs font-medium text-slate-300 hover:bg-slate-800/40 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  Last
                </button>
              </div>
            </div>
          </>
        ) : (
          <EmptyState
            title="No events found"
            description={hasActiveFilters ? 'Try adjusting your filters or search query' : 'Check back later'}
            icon={<Search size={48} />}
          />
        )}
      </Card>

      {/* Event Detail Modal */}
      <Modal isOpen={selectedEvent !== null} onClose={() => setSelectedEvent(null)} title="Event Details" size="xl">
        {selectedEvent && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-semibold text-slate-500 uppercase">Event ID</label>
                <p className="text-sm font-mono text-slate-100 mt-1">{selectedEvent.id}</p>
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-500 uppercase">Event Time</label>
                <p className="text-sm text-slate-100 mt-1">
                  {format(new Date(selectedEvent.eventTime), 'dd/MM/yyyy HH:mm:ss')}
                </p>
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-500 uppercase">Event Type</label>
                <p className="mt-1">
                  <span
                    className={clsx(
                      'inline-flex px-2 py-1 text-xs font-medium rounded',
                      getEventTypeBadgeColor(selectedEvent.eventType)
                    )}
                  >
                    {selectedEvent.eventType.replace(/_/g, ' ')}
                  </span>
                </p>
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-500 uppercase">Status</label>
                <p className="mt-1">
                  <span
                    className={clsx(
                      'inline-flex px-2 py-1 text-xs font-medium rounded',
                      getStatusBadgeColor(selectedEvent.status)
                    )}
                  >
                    {selectedEvent.status}
                  </span>
                </p>
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-500 uppercase">Order ID</label>
                <p className="text-sm font-mono text-slate-100 mt-1">{selectedEvent.orderId}</p>
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-500 uppercase">User ID</label>
                <p className="text-sm font-mono text-slate-100 mt-1">{selectedEvent.userId}</p>
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-500 uppercase">Amount</label>
                <p className="text-sm font-medium text-slate-100 mt-1">
                  {selectedEvent.amount.toLocaleString()} {selectedEvent.currency}
                </p>
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-500 uppercase">Currency</label>
                <p className="text-sm text-slate-100 mt-1">{selectedEvent.currency}</p>
              </div>
            </div>

            {selectedEvent.metadata && (
              <div>
                <label className="text-xs font-semibold text-slate-500 uppercase">Metadata</label>
                <pre className="mt-2 p-4 bg-slate-800/40 rounded-lg text-xs font-mono overflow-auto">
                  {JSON.stringify(selectedEvent.metadata, null, 2)}
                </pre>
              </div>
            )}

            <PipelineTrace trace={traceData} loading={traceLoading} />
          </div>
        )}
      </Modal>
    </div>
  )
}
