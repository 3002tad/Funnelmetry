import type { EventTrace } from '@/lib/api'
import { format } from 'date-fns'
import { LoadingSpinner } from './EmptyState'

interface PipelineTraceProps {
  trace: EventTrace | null | undefined
  loading?: boolean
}

const stages = [
  { key: 'tGenerated', label: 'Generated' },
  { key: 'tKafkaSent', label: 'Kafka' },
  { key: 'tSparkProcessed', label: 'Spark' },
  { key: 'tDbWritten', label: 'Database' },
] as const

const latencySegments = [
  { key: 'latencyGenToKafkaMs', from: 'Generated', to: 'Kafka' },
  { key: 'latencyKafkaToSparkMs', from: 'Kafka', to: 'Spark' },
  { key: 'latencySparkToDbMs', from: 'Spark', to: 'Database' },
] as const

function getLatencyColor(ms: number | null): string {
  if (ms === null) return 'bg-slate-700'
  if (ms <= 100) return 'bg-gradient-to-r from-emerald-500 to-emerald-400'
  if (ms <= 500) return 'bg-gradient-to-r from-amber-500 to-amber-400'
  return 'bg-gradient-to-r from-rose-500 to-rose-400'
}

function getLatencyTextColor(ms: number | null): string {
  if (ms === null) return 'text-slate-500'
  if (ms <= 100) return 'text-emerald-300'
  if (ms <= 500) return 'text-amber-300'
  return 'text-rose-300'
}

function formatTimestamp(ts: string | null): string {
  if (!ts) return '--'
  try {
    return format(new Date(ts), 'HH:mm:ss.SSS')
  } catch {
    return '--'
  }
}

export default function PipelineTrace({ trace, loading }: PipelineTraceProps) {
  if (loading) {
    return (
      <div className="border-t border-slate-800/60 pt-4 mt-4">
        <label className="text-xs font-semibold text-slate-500 uppercase">Pipeline Trace</label>
        <div className="mt-3 flex justify-center py-4">
          <LoadingSpinner size="sm" />
        </div>
      </div>
    )
  }

  if (!trace) {
    return (
      <div className="border-t border-slate-800/60 pt-4 mt-4">
        <label className="text-xs font-semibold text-slate-500 uppercase">Pipeline Trace</label>
        <p className="mt-2 text-sm text-slate-500 italic">No trace data available for this event.</p>
      </div>
    )
  }

  // Compute segment widths proportional to latency
  const latencies = latencySegments.map(s => trace[s.key] ?? 0)
  const totalLatency = trace.latencyTotalMs ?? latencies.reduce((a, b) => a + b, 0)
  const minWidthPct = 10 // minimum segment width percentage for visibility

  let widths: number[]
  if (totalLatency > 0) {
    widths = latencies.map(l => Math.max(minWidthPct, (l / totalLatency) * 100))
    // Normalize to sum to 100
    const sum = widths.reduce((a, b) => a + b, 0)
    widths = widths.map(w => (w / sum) * 100)
  } else {
    widths = [33.3, 33.3, 33.4]
  }

  return (
    <div className="border-t border-slate-800/60 pt-4 mt-4">
      <div className="flex items-center justify-between mb-3">
        <label className="text-xs font-semibold text-slate-500 uppercase">Pipeline Trace</label>
        <span className={`text-sm font-bold ${getLatencyTextColor(trace.latencyTotalMs)}`}>
          End-to-end: {trace.latencyTotalMs !== null ? `${trace.latencyTotalMs}ms` : '--'}
        </span>
      </div>

      {/* Timeline bar */}
      <div className="flex items-center gap-0 h-8 rounded-lg overflow-hidden mb-2">
        {latencySegments.map((seg, i) => {
          const ms = trace[seg.key]
          return (
            <div
              key={seg.key}
              className={`${getLatencyColor(ms)} h-full flex items-center justify-center text-xs font-semibold text-white relative`}
              style={{ width: `${widths[i]}%` }}
              title={`${seg.from} → ${seg.to}: ${ms !== null ? `${ms}ms` : 'N/A'}`}
            >
              {ms !== null ? `${ms}ms` : '--'}
            </div>
          )
        })}
      </div>

      {/* Stage labels + timestamps */}
      <div className="flex justify-between">
        {stages.map(stage => {
          const ts = trace[stage.key as keyof EventTrace] as string | null
          return (
            <div key={stage.key} className="text-center flex-1">
              <div className="text-xs font-semibold text-slate-300">{stage.label}</div>
              <div className="text-[10px] text-slate-500 font-mono">{formatTimestamp(ts)}</div>
            </div>
          )
        })}
      </div>

      {/* Latency breakdown table */}
      <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
        {latencySegments.map(seg => {
          const ms = trace[seg.key]
          return (
            <div key={seg.key} className="bg-slate-800/50 ring-1 ring-slate-700/40 rounded p-2 text-center">
              <div className="text-slate-500">{seg.from} → {seg.to}</div>
              <div className={`font-bold ${getLatencyTextColor(ms)}`}>
                {ms !== null ? `${ms}ms` : 'N/A'}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
