import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useAuth } from '../../auth/AuthContext'
import { apiRequest } from '../../lib/api'
import { Button } from '../../components/ui/button'

type Definition = { id: string; aggregation?: string; unit?: string; field?: string; fields?: string[]; numerator?: string; denominator?: string; zero_denominator?: string }
type Catalog = {
  release_id: string; status: string; binding_status: string; checked_at: string
  metadata: { status: string; version: string; runtime_published: boolean
    asset: { id: string; relation: string; grain: string[]; time_basis: string; authority: string; quality_field: string; required_quality: string; scope: string }
    measures: Definition[]; metrics: Definition[]; dimensions: { id: string; field: string }[]; policies: Record<string, string> }
  tool: { id: string; version: string; required_dimensions: string[] }
}
const names: Record<string, string> = {
  'measure.gross_order_value': 'Tổng giá trị đơn hàng đã đặt', 'measure.order_count': 'Số đơn hàng',
  'metric.average_order_value': 'Giá trị đơn hàng trung bình (AOV)', 'asset.fact_order': 'Dữ liệu đơn hàng đã đặt',
}
function Fields({ rows }: { rows: Array<[string, string]> }) {
  return <dl className="grid gap-3 text-sm sm:grid-cols-2">{rows.map(([label, value]) => <div key={label} className="min-w-0 rounded-lg bg-muted/40 p-3"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 break-words whitespace-pre-wrap">{value}</dd></div>)}</dl>
}
export default function CatalogPage({ kind }: { kind: 'metrics' | 'assets' }) {
  const { user } = useAuth()
  const [search, setSearch] = useState('')
  const query = useQuery({ queryKey: ['semantic-catalog', user?.id], queryFn: ({ signal }) => apiRequest<Catalog>('/api/v2/catalog', { signal }), retry: false, gcTime: 0 })
  const catalog = query.isError ? undefined : query.data
  const meta = catalog?.metadata
  const definitions = meta ? [...meta.measures, ...meta.metrics].filter(item => `${item.id} ${names[item.id] ?? ''}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())) : []
  return <div className="space-y-5">
    <header className="flex items-start justify-between gap-4"><div><h1 className="text-2xl font-semibold">{kind === 'metrics' ? 'Metrics' : 'Analytical Assets'}</h1><p className="mt-2 text-sm text-muted-foreground">Tra cứu định nghĩa và nguồn gốc dữ liệu · Chỉ đọc · Không gọi AI</p></div><Button variant="outline" disabled={query.isFetching} onClick={() => void query.refetch()}>Làm mới</Button></header>
    <nav className="flex gap-4 text-sm text-primary"><Link to="/metrics">Chỉ tiêu</Link><Link to="/assets">Dữ liệu phân tích</Link></nav>
    {query.isPending && <p role="status">Đang đọc catalog…</p>}
    {query.isError && <p role="alert" className="panel p-5">Không đọc được catalog hoặc chưa xác minh được bảng dữ liệu. Kiểm tra quyền truy cập và API rồi thử lại; đây không phải catalog rỗng.</p>}
    {catalog && meta && <>
      <section className="panel space-y-2 p-5"><p className="font-medium">Catalog thử nghiệm — chưa phải định nghĩa được công bố chính thức</p><p className="break-words text-xs text-muted-foreground">{catalog.release_id} · {catalog.status} · Metadata: {meta.status} · Phiên bản {meta.version}</p><p className="text-sm">Đã kiểm tra liên kết với bảng/cột: {catalog.binding_status}. Không đồng nghĩa dữ liệu đã đầy đủ hoặc đối soát.</p><p className="text-sm">Chỉ đo giá trị đơn đã đặt, không phải doanh thu thanh toán. Không cộng chéo tiền tệ.</p><p className="text-xs text-muted-foreground">Kiểm tra lúc: {catalog.checked_at}. Catalog không phụ thuộc bộ lọc thời gian trên thanh điều hướng.</p></section>
      {kind === 'metrics' ? <>
        <label className="block text-sm">Tìm chỉ tiêu<input className="mt-2 block w-full rounded-lg border bg-background p-3" value={search} onChange={e => setSearch(e.target.value)} placeholder="Tên hoặc ID chỉ tiêu" /></label>
        {!definitions.length && <p>Không có chỉ tiêu khớp từ khóa.</p>}
        {definitions.map(item => <section key={item.id} className="panel p-5"><h2 className="font-semibold">{names[item.id] ?? item.id}</h2><p className="mb-4 mt-1 text-xs text-muted-foreground">{item.id} · {meta.version}</p><Fields rows={[
          ['Công thức / quy tắc tổng hợp', item.numerator ? `${item.numerator} / ${item.denominator}` : `${item.aggregation}(${item.field ?? item.fields?.join(', ')})`],
          ['Tử số', item.numerator ?? 'Không áp dụng'], ['Mẫu số / khi bằng 0', item.denominator ? `${item.denominator} / ${item.zero_denominator}` : 'Không áp dụng'],
          ['Đơn vị', item.unit ?? 'Chưa khai báo riêng trong metadata'], ['Grain', meta.asset.grain.join(' × ')], ['Mốc thời gian', meta.asset.time_basis],
          ['Dimension bắt buộc', catalog.tool.required_dimensions.join(', ')], ['Yêu cầu chất lượng', `${meta.asset.quality_field} = ${meta.asset.required_quality}`],
          ['Công cụ hỗ trợ', `${catalog.tool.id}@${catalog.tool.version}`], ['Yêu cầu dữ liệu tối thiểu', 'Chưa khai báo ngưỡng mẫu trong catalog'],
        ]} /><Link className="mt-4 inline-block text-sm text-primary" to="/assets">Xem analytical asset →</Link></section>)}
      </> : <section className="panel space-y-4 p-5"><h2 className="font-semibold">{names[meta.asset.id] ?? meta.asset.id}</h2><Fields rows={[
        ['Asset / phiên bản', `${meta.asset.id}@${meta.version}`], ['Bảng / view', meta.asset.relation], ['Grain / khóa logic', meta.asset.grain.join(' × ')],
        ['Nguồn áp dụng', meta.asset.scope], ['Thẩm quyền dữ liệu', meta.asset.authority], ['Time basis', meta.asset.time_basis],
        ['Dimensions', meta.dimensions.map(d => `${d.id}: ${d.field}`).join('\n')], ['Measures', meta.measures.map(m => m.id).join('\n')],
        ['Chất lượng yêu cầu', `${meta.asset.quality_field} = ${meta.asset.required_quality}`], ['Quan hệ / joins', 'Chưa đăng ký quan hệ trong catalog; không tự suy diễn join'],
        ['Công cụ hỗ trợ', `${catalog.tool.id}@${catalog.tool.version}`],
      ]} /><Link className="text-sm text-primary" to="/metrics">Xem các chỉ tiêu →</Link></section>}
      <details className="panel p-5"><summary className="cursor-pointer font-medium">Chính sách và giới hạn (metadata gốc)</summary><div className="mt-4"><Fields rows={Object.entries(meta.policies)} /></div></details>
    </>}
  </div>
}
