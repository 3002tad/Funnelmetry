import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useOutletContext } from 'react-router-dom'
import type { ShellContext } from '../../app/AppShell'
import { useAuth } from '../../auth/AuthContext'
import { apiRequest } from '../../lib/api'
import { Button } from '../../components/ui/button'

type TrafficInput = {
  contract: { id: string; version: string; status: string; grain: string; time_basis: string; limitations: string[] }
  scope: { source_id: string; from: string; to: string }
  observed_events: string
  present_events: string
  absent_events: string
  invalid_events: string
  synthetic_events: string
  latest_received_at: string | null
  historical_coverage_verified: false
  attribution_verified: false
  checked_at: string
}
type Breakdown = { items: { canonical_label: string | null; event_count: string }[]; more_labels: boolean;
  mapping_basis: string; attribution_verified: false; historical_coverage_verified: false }
type Registry = { labels: { canonical_label: string; raw_variant_count: string; updated_at: string }[];
  next_after: string | null; raw_values_exposed: false }
type Lookup = { raw: string; found: boolean; canonical_label: string | null; version: number | null }

export default function TrafficInputPage() {
  const { sourceId, range } = useOutletContext<ShellContext>()
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [refresh, setRefresh] = useState(0)
  const [rawSource, setRawSource] = useState('')
  const [label, setLabel] = useState('')
  const [lookup, setLookup] = useState<Lookup | null>(null)
  const [busy, setBusy] = useState(false)
  const [mappingMessage, setMappingMessage] = useState('')
  const [afterLabel, setAfterLabel] = useState<string | null>(null)
  const canMap = Boolean(user?.permissions?.includes('traffic.mapping.write'))
  const window = useMemo(() => {
    const to = new Date()
    const days = range === 'Last 7 days' ? 7 : range === 'Last 90 days' ? 90 : 30
    return { from: new Date(to.getTime() - days * 86400000).toISOString(), to: to.toISOString() }
  }, [range, sourceId, refresh])
  const result = useQuery({
    queryKey: ['traffic-input', user?.id, sourceId, window],
    queryFn: ({ signal }) => apiRequest<TrafficInput>(`/api/v2/analytics/traffic-input?${new URLSearchParams({ source_id: sourceId, ...window })}`, { signal }),
    retry: false,
    gcTime: 0,
  })
  const breakdown = useQuery({
    queryKey: ['traffic-breakdown', user?.id, sourceId, window],
    queryFn: ({ signal }) => apiRequest<Breakdown>(`/api/v2/analytics/traffic-input/breakdown?${new URLSearchParams({ source_id: sourceId, ...window })}`, { signal }),
    retry: false, gcTime: 0,
  })
  const registry = useQuery({
    queryKey: ['traffic-registry', user?.id, sourceId, afterLabel],
    queryFn: ({ signal }) => apiRequest<Registry>(`/api/v2/analytics/traffic-source-registry?${new URLSearchParams({ source_id: sourceId, ...(afterLabel ? { after_label: afterLabel } : {}) })}`, { signal }),
    retry: false, gcTime: 0,
  })
  const rows = result.data ? [
    ['Event đã quan sát', result.data.observed_events],
    ['Có utm_source dạng chuỗi', result.data.present_events],
    ['Không có utm_source', result.data.absent_events],
    ['utm_source không hợp lệ', result.data.invalid_events],
    ['Trong đó: event synthetic', result.data.synthetic_events],
  ] : []

  async function checkRawSource() {
    setBusy(true); setMappingMessage(''); setLookup(null)
    try {
      const found = await apiRequest<Omit<Lookup, 'raw'>>('/api/v2/analytics/traffic-source-registry/lookup', {
        method: 'POST', body: JSON.stringify({ source_id: sourceId, raw_utm_source: rawSource }),
      })
      setLookup({ ...found, raw: rawSource })
      if (found.canonical_label) setLabel(found.canonical_label)
      setMappingMessage(found.found ? 'Đã có mapping. Đổi nhãn sẽ tạo phiên bản và audit mới.' : 'Chưa có mapping. Có thể gán nhãn mới.')
    } catch { setMappingMessage('Không kiểm tra được giá trị này. Không có mapping nào được thay đổi.') }
    finally { setBusy(false) }
  }

  async function saveMapping() {
    if (!lookup || lookup.raw !== rawSource) return
    setBusy(true); setMappingMessage('')
    try {
      const saved = await apiRequest<{ canonical_label: string; version: number; changed: boolean }>(
        '/api/v2/analytics/traffic-source-registry', { method: 'POST', body: JSON.stringify({
          source_id: sourceId, raw_utm_source: rawSource, canonical_label: label,
          expected_version: lookup.found ? lookup.version : null,
        }) })
      setMappingMessage(saved.changed ? `Đã lưu nhãn ${saved.canonical_label} (phiên bản ${saved.version}).` : 'Mapping này không thay đổi.')
      setRawSource(''); setLabel(''); setLookup(null); setAfterLabel(null)
      void queryClient.invalidateQueries({ queryKey: ['traffic-registry'] })
      void queryClient.invalidateQueries({ queryKey: ['traffic-breakdown'] })
    } catch { setMappingMessage('Không lưu được mapping. Có thể phiên bản đã đổi; kiểm tra lại giá trị trước khi lưu.') }
    finally { setBusy(false) }
  }

  return <div className="space-y-5">
    <header className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-2xl font-semibold">Traffic · UTM input</h1><p className="mt-2 text-sm text-muted-foreground">Chất lượng dữ liệu nguồn truy cập đầu vào · {sourceId}</p></div><Button variant="outline" disabled={result.isFetching} onClick={() => setRefresh(value => value + 1)}>Làm mới</Button></header>
    <section className="panel space-y-2 p-5 text-sm"><p className="font-medium">Đây là số event browser có dấu vết `utm_source`, không phải số lượt truy cập hoặc hiệu quả chiến dịch.</p><p>Chỉ đếm event đã được worker chiếu từ Raw Kafka còn lưu. Không biết dữ liệu lịch sử hay Feed đã đầy đủ chưa; chưa chuẩn hóa kênh, chưa tính attribution, conversion hoặc doanh thu theo nguồn.</p></section>
    {result.isPending && <p role="status">Đang tải quan sát Traffic…</p>}
    {result.isError && <p role="alert">Không tải được dữ liệu UTM đầu vào. Không thể kết luận là không có traffic.</p>}
    {result.data && !result.isError && <>
      <p className="text-xs text-muted-foreground">Theo received_at (UTC): {result.data.scope.from} → trước {result.data.scope.to}<br/>Event nhận gần nhất trong cửa sổ: {result.data.latest_received_at ?? 'Chưa quan sát'} · Kiểm tra lúc: {result.data.checked_at}</p>
      <section className="panel overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th className="p-3">Trạng thái đầu vào</th><th className="p-3">Số event</th></tr></thead><tbody>{rows.map(([label, count]) => <tr className="border-t" key={label}><td className="p-3">{label}</td><td className="p-3 font-mono">{count}</td></tr>)}</tbody></table></section>
      {result.data.observed_events === '0' && <p className="panel p-5 text-sm">Chưa quan sát event trong cửa sổ này; không có nghĩa Source không phát event.</p>}
      <section className="panel space-y-3 p-5"><h2 className="font-semibold">Event theo nhãn nguồn hiện tại</h2><p className="text-sm text-muted-foreground">Chỉ event có `utm_source` dạng chuỗi; mapping hiện tại được áp ngược khi đọc, không sửa event lịch sử. “Chưa map” không có nghĩa là Direct. Không quy đơn hàng hoặc doanh thu cho nhãn này.</p>
        {breakdown.isPending && <p role="status">Đang tải phân nhóm nguồn…</p>}
        {breakdown.isError && <p role="alert">Không tải được phân nhóm nguồn; số 0 không được giả định.</p>}
        {breakdown.data && !breakdown.isError && <>{breakdown.data.items.length === 0 ? <p className="text-sm">Chưa quan sát event có UTM trong cửa sổ này.</p> : <table className="w-full text-left text-sm"><thead><tr><th className="py-2">Nhãn nguồn</th><th className="py-2">Số event</th></tr></thead><tbody>{breakdown.data.items.map(item => <tr className="border-t" key={item.canonical_label ?? '__unmapped__'}><td className="py-2">{item.canonical_label ?? 'Chưa map'}</td><td className="py-2 font-mono">{item.event_count}</td></tr>)}</tbody></table>}{breakdown.data.more_labels && <p className="text-xs text-muted-foreground">Chỉ hiện 25 nhóm nhiều event nhất.</p>}</>}
      </section>
      <section className="panel space-y-3 p-5"><h2 className="font-semibold">Traffic Source Registry</h2><p className="text-sm text-muted-foreground">Mỗi nhãn có thể gom nhiều giá trị `utm_source` thô. Danh sách chỉ hiện nhãn và số biến thể, không hiện raw value hay hash. Giá trị UTM phổ biến vẫn có thể bị đoán từ hash trong DB.</p>
        {registry.isPending && <p role="status">Đang tải registry…</p>}{registry.isError && <p role="alert">Không tải được registry.</p>}
        {registry.data && !registry.isError && <>{registry.data.labels.length === 0 ? <p className="text-sm">Chưa có nhãn ở trang này.</p> : <ul className="space-y-1 text-sm">{registry.data.labels.map(item => <li key={item.canonical_label}>{item.canonical_label} · {item.raw_variant_count} biến thể nguồn thô</li>)}</ul>}{registry.data.next_after && <Button variant="outline" onClick={() => setAfterLabel(registry.data!.next_after)}>Xem nhãn tiếp theo</Button>}{afterLabel && <Button variant="outline" onClick={() => setAfterLabel(null)}>Về trang đầu</Button>}</>}
        {canMap && <div className="mt-4 space-y-3 border-t pt-4"><p className="text-sm">Nhập chính xác giá trị UTM (phân biệt chữ hoa/thường), kiểm tra phiên bản rồi gán nhãn. Giá trị thô không được lưu trong bảng registry.</p><label className="block text-sm">Giá trị utm_source thô<input className="mt-1 block w-full rounded border bg-background p-2" value={rawSource} maxLength={512} onChange={event => { setRawSource(event.target.value); setLabel(''); setLookup(null); setMappingMessage('') }} /></label><Button variant="outline" disabled={busy} onClick={() => void checkRawSource()}>Kiểm tra giá trị</Button><label className="block text-sm">Nhãn nguồn chuẩn (a-z, 0-9, dấu chấm/gạch)<input className="mt-1 block w-full rounded border bg-background p-2" value={label} maxLength={64} onChange={event => setLabel(event.target.value)} /></label><Button disabled={busy || !lookup || lookup.raw !== rawSource || !/^[a-z][a-z0-9._-]{0,63}$/.test(label)} onClick={() => void saveMapping()}>Lưu mapping</Button>{mappingMessage && <p role="status" className="text-sm">{mappingMessage}</p>}</div>}
      </section>
      <details className="panel p-5"><summary className="cursor-pointer">Định nghĩa và giới hạn</summary><p className="mt-3 text-sm">{result.data.contract.id}@{result.data.contract.version} · {result.data.contract.status} · {result.data.contract.grain} · {result.data.contract.time_basis}</p><ul className="mt-3 list-disc pl-5 text-sm">{result.data.contract.limitations.map(text => <li key={text}>{text}</li>)}</ul></details>
    </>}
  </div>
}
