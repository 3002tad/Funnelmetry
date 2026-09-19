import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { CircleOff, RefreshCw, Search } from "lucide-react"
import { useOutletContext } from "react-router-dom"
import type { ShellContext } from "../../app/AppShell"
import { Badge } from "../../components/ui/badge"
import { Button } from "../../components/ui/button"
import { Drawer } from "../../components/ui/drawer"
import { EmptyState, PageHeader } from "../../components/ui/page"
import { fetchV2Events, type CanonicalEventItem } from "../../lib/analytics-api"
import { ApiError } from "../../lib/api"
import { useAuth } from "../../auth/AuthContext"

const classes = [
  { label: "All classes", value: "" },
  { label: "Behavior intent", value: "BEHAVIOR_INTENT" },
  { label: "Client observation", value: "CLIENT_OBSERVATION" },
  { label: "Business fact", value: "BUSINESS_FACT" },
]

function formatDate(value: string | null) {
  if (!value) return "—"
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "medium" }).format(new Date(value))
}

function eventTone(eventClass?: CanonicalEventItem["event_class"]) {
  if (eventClass === "BUSINESS_FACT") return "commerce" as const
  if (eventClass === "BEHAVIOR_INTENT") return "behavior" as const
  return "neutral" as const
}

export function EventsPage() {
  const { range, sourceId } = useOutletContext<ShellContext>()
  const { user } = useAuth()
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [query, setQuery] = useState("")
  const [eventClass, setEventClass] = useState("")
  const [selected, setSelected] = useState<CanonicalEventItem | null>(null)
  const events = useQuery({
    queryKey: ["v2-events", user?.id, sourceId, range, eventClass],
    queryFn: ({ signal }) => fetchV2Events(range, eventClass || undefined, signal),
    refetchInterval: (query) => autoRefresh && !(query.state.error instanceof ApiError && [401, 403].includes(query.state.error.status)) ? 5000 : false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: autoRefresh,
    refetchOnReconnect: autoRefresh,
    retry: false,
    gcTime: 0,
  })
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return (events.data ?? []).filter((event) => !needle
      || event.event_type.toLowerCase().includes(needle)
      || event.canonical_event_id.toLowerCase().includes(needle)
      || event.journey_id?.toLowerCase().includes(needle))
  }, [events.data, query])

  return <>
    <PageHeader title="Canonical events" description="Privacy-safe canonical metadata persisted by Pipeline V2. This is a bounded event browser, not a live raw-payload stream." badge={<Badge tone="primary">Ledger V2</Badge>} actions={<Button variant="outline" disabled={events.isFetching} onClick={() => void events.refetch()}><RefreshCw size={14} className={events.isFetching ? 'animate-spin' : ''} /> Refresh</Button>} />
    <div className="panel mb-4 flex flex-wrap items-center justify-between gap-3 p-3 text-xs">
      <label className="flex cursor-pointer items-center gap-2"><input type="checkbox" checked={autoRefresh} onChange={event => setAutoRefresh(event.target.checked)} className="accent-blue-600" />Tự làm mới mỗi 5 giây</label>
      <p role="status" aria-live="polite" className="text-muted-foreground">{events.isFetching ? 'Đang tải… · ' : events.isError ? 'Lần cập nhật gần nhất thất bại · ' : ''}Cập nhật thành công: {events.dataUpdatedAt ? new Date(events.dataUpdatedAt).toLocaleTimeString() : 'Chưa có'}</p>
      <p className="w-full text-muted-foreground">Tạm ngừng polling khi tab bị ẩn. Đây là thời điểm UI đọc dữ liệu, không phải thời điểm event tới Gateway. Event ngoài bộ lọc hoặc bị quarantine không xuất hiện ở đây.</p>
    </div>
    <div className="mb-4 flex flex-wrap gap-2 text-xs"><Badge>{sourceId}</Badge><Badge>{range}</Badge><Badge tone="primary">occurred_at window</Badge><Badge>Maximum 200 rows</Badge></div>
    <div className="panel mb-4 flex flex-wrap gap-2 p-3"><div className="relative min-w-[230px] flex-1"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search event, canonical ID or journey" className="h-9 w-full rounded-lg border bg-background pl-9 pr-3 text-xs" /></div><select value={eventClass} onChange={(event) => setEventClass(event.target.value)} className="h-9 rounded-lg border bg-background px-3 text-xs">{classes.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></div>
    {events.isLoading && <div className="skeleton h-[520px]" />}
    {events.isError && <EmptyState icon={<CircleOff size={20} />} title="Cannot load canonical events" detail="Check Dashboard API, PostgreSQL migrations, source ID and your login session." />}
    {!events.isLoading && !events.isError && (visible.length ? <section className="panel overflow-hidden"><div className="overflow-x-auto"><table className="w-full min-w-[1050px] text-left text-[11px]"><thead className="bg-muted/40 text-muted-foreground"><tr>{["Event", "Occurred at", "Journey", "Class", "Time basis", "Authority", "Mapping", "Persisted at"].map((heading) => <th key={heading} className="px-4 py-3 font-medium">{heading}</th>)}</tr></thead><tbody>{visible.map((event) => <tr key={event.canonical_event_id} onClick={() => setSelected(event)} className="cursor-pointer border-b last:border-0 hover:bg-muted/30"><td className="px-4 py-3"><strong className="font-mono text-foreground">{event.event_type}</strong><span className="mt-1 block max-w-[220px] truncate font-mono text-[9px] text-muted-foreground">{event.canonical_event_id}</span></td><td className="px-4 text-muted-foreground">{formatDate(event.occurred_at)}</td><td className="max-w-[170px] truncate px-4 font-mono text-primary">{event.journey_id ?? "Not linked"}</td><td className="px-4"><Badge tone={eventTone(event.event_class)}>{event.event_class}</Badge></td><td className="px-4"><Badge tone={event.time_basis === "source_occurred" ? "success" : "warning"}>{event.time_basis}</Badge></td><td className="px-4">{event.authoritative_event_time ? "Authoritative" : "Fallback"}</td><td className="px-4 font-mono">{event.mapping_version}</td><td className="px-4 text-muted-foreground">{formatDate(event.persisted_at)}</td></tr>)}</tbody></table></div></section> : <EmptyState icon={<CircleOff size={20} />} title="No events match this window" detail="Try another event class, search phrase or date range." />)}
    <Drawer open={Boolean(selected)} onClose={() => setSelected(null)} title={selected?.event_type ?? "Canonical event"} subtitle={selected?.canonical_event_id}>
      {selected && <><div className="flex flex-wrap gap-2"><Badge tone={eventTone(selected.event_class)}>{selected.event_class}</Badge><Badge tone={selected.authoritative_event_time ? "success" : "warning"}>{selected.time_basis}</Badge>{selected.link_confidence && <Badge>{selected.link_confidence} link</Badge>}</div><dl className="mt-6 grid grid-cols-[130px_minmax(0,1fr)] gap-x-3 gap-y-4 text-xs"><dt className="text-muted-foreground">Occurred</dt><dd>{formatDate(selected.occurred_at)}</dd><dt className="text-muted-foreground">Produced</dt><dd>{formatDate(selected.produced_at)}</dd><dt className="text-muted-foreground">Ingested</dt><dd>{formatDate(selected.ingested_at)}</dd><dt className="text-muted-foreground">Normalized</dt><dd>{formatDate(selected.normalized_at)}</dd><dt className="text-muted-foreground">Persisted</dt><dd>{formatDate(selected.persisted_at)}</dd><dt className="text-muted-foreground">Journey</dt><dd className="break-all font-mono">{selected.journey_id ?? "Not linked"}</dd><dt className="text-muted-foreground">Link method</dt><dd>{selected.link_method ?? "Not linked"}</dd><dt className="text-muted-foreground">Aggregate type</dt><dd>{selected.aggregate_type ?? "None"}</dd><dt className="text-muted-foreground">Schema</dt><dd className="font-mono">{selected.canonical_schema_version}</dd><dt className="text-muted-foreground">Mapping</dt><dd className="font-mono">{selected.mapping_version}</dd></dl><p className="mt-6 rounded-lg border bg-muted/20 p-3 text-xs leading-5 text-muted-foreground">Raw payload, normalized data, identity, relations, source event ID and aggregate ID are intentionally excluded from this analytics response.</p></>}
    </Drawer>
  </>
}
