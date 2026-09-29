import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'
import { apiRequest } from '../../lib/api'
import { useAuth } from '../../auth/AuthContext'
import { Button } from '../../components/ui/button'
import { OrderEvidenceDetails, type OrderEvidence } from '../chat/order-evidence'
import { ReportPreview } from './ReportPreview'
import { EvidenceNotes } from './EvidenceNotes'

type RecordRow = { evidence_id: string; analysis_run_id: string; tool_call_id: string; status: string; created_at: string; tool_id?: string; parameters?: {source_id?: string; from?: string; to?: string} }
type List = {items: RecordRow[]; next_before: string | null}
type Detail = RecordRow & {document: OrderEvidence & {analysis_run_id: string; tool_call_id: string; reproducibility?: string}}
export default function EvidencePage({ runs = false, reports = false }: {runs?: boolean;reports?:boolean}) {
  const { user } = useAuth()
  const [params] = useSearchParams()
  const selected = params.get('id')
  const [status, setStatus] = useState('')
  const [draft,setDraft]=useState({source_id:'',saved_from:'',saved_to:''})
  const [filters,setFilters]=useState(draft)
  const [cursors, setCursors] = useState<Array<string | null>>([null])
  const before = cursors[cursors.length - 1]
  const list = useQuery({queryKey:['evidence-list',user?.id,status,before,filters], queryFn:({signal}) => {
    const query = new URLSearchParams()
    for(const [key,value] of Object.entries(filters)) if(value) query.set(key,value)
    if (status) query.set('status',status)
    if (before) query.set('before',before)
    return apiRequest<List>(`/api/v2/evidence?${query}`,{signal})
  },retry:false,gcTime:0})
  const detail = useQuery({queryKey:['evidence-detail',user?.id,selected], enabled:!!selected,
    queryFn:({signal}) => apiRequest<Detail>(`/api/v2/evidence/${encodeURIComponent(selected!)}`,{signal}),retry:false,gcTime:0})
  const root = reports ? '/reports' : runs ? '/analysis-runs' : '/evidence'
  return <div className="space-y-5">
    <header className="flex justify-between gap-4"><div><h1 className="text-2xl font-semibold">{reports ? 'Reports · Bản xem từ bằng chứng' : runs ? 'Analysis Runs' : 'Evidence Explorer'}</h1><p className="mt-2 text-sm text-muted-foreground">Kết quả phân tích đã lưu của tài khoản hiện tại · Không phụ thuộc lịch sử chat</p></div><Button variant="outline" disabled={list.isFetching || detail.isFetching} onClick={() => {void list.refetch(); if(selected) void detail.refetch()}}>Làm mới</Button></header>
    <p className="panel p-4 text-sm">Chỉ có bản ghi đã kết thúc, mỗi bản ghi chứa một tool call và một bằng chứng. Chưa ghi nhận kế hoạch, thời điểm bắt đầu/kết thúc, model, latency hoặc retry. Mốc bên dưới là thời điểm lưu, không phải toàn bộ thời gian thực thi. Bộ lọc thời gian trên thanh điều hướng không áp dụng cho lịch sử này.</p>
    <nav className="flex gap-4 text-sm text-primary"><Link to="/analysis-runs">Analysis Runs</Link><Link to="/evidence">Evidence Explorer</Link><Link to="/metrics">Metrics</Link><Link to="/assets">Assets</Link></nav>
    <form className="panel flex flex-wrap items-end gap-3 p-4" onSubmit={e=>{e.preventDefault();setFilters({...draft,source_id:draft.source_id.trim()});setCursors([null])}}>
      <label className="text-sm">Nguồn (ID chính xác)<input aria-label="Lọc nguồn bằng chứng" className="mt-1 block rounded border bg-background p-2" maxLength={200} value={draft.source_id} onChange={e=>setDraft(d=>({...d,source_id:e.target.value}))}/></label>
      <label className="text-sm">Ngày lưu từ (UTC)<input aria-label="Ngày lưu từ" type="date" className="mt-1 block rounded border bg-background p-2" value={draft.saved_from} onChange={e=>setDraft(d=>({...d,saved_from:e.target.value}))}/></label>
      <label className="text-sm">Ngày lưu đến trước (UTC)<input aria-label="Ngày lưu đến trước" type="date" className="mt-1 block rounded border bg-background p-2" value={draft.saved_to} onChange={e=>setDraft(d=>({...d,saved_to:e.target.value}))}/></label>
      <Button type="submit" disabled={!!(draft.saved_from&&draft.saved_to&&draft.saved_from>=draft.saved_to)}>Áp dụng bộ lọc</Button>
      <Button type="button" variant="outline" onClick={()=>{const empty={source_id:'',saved_from:'',saved_to:''};setDraft(empty);setFilters(empty);setStatus('');setCursors([null])}}>Xóa bộ lọc</Button>
      {draft.saved_from&&draft.saved_to&&draft.saved_from>=draft.saved_to&&<p role="alert" className="w-full text-sm">Ngày kết thúc phải sau ngày bắt đầu.</p>}
      <p className="w-full text-xs text-muted-foreground">Đang áp dụng: nguồn {filters.source_id||'tất cả'} · ngày lưu {filters.saved_from||'không giới hạn'} → trước {filters.saved_to||'không giới hạn'}. Chi tiết đang mở theo mã độc lập với bộ lọc danh sách.</p>
    </form>
    <label className="block text-sm">Trạng thái kết quả<select className="ml-3 rounded-lg border bg-background p-2" value={status} onChange={e=>{setStatus(e.target.value);setCursors([null])}}><option value="">Tất cả</option>{['PROVISIONAL','INSUFFICIENT_DATA','BLOCKED_BY_QUALITY','ERROR'].map(value=><option key={value}>{value}</option>)}</select></label>
    {list.isPending && <p role="status">Đang tải lịch sử…</p>}
    {list.isError && <p role="alert">Không tải được lịch sử. Kiểm tra quyền hoặc API, rồi thử lại.</p>}
    {list.data && !list.isError && <section className="panel overflow-x-auto">
      {!list.data.items.length ? <p className="p-5">Chưa có bản ghi phù hợp của tài khoản này.</p> : <table className="w-full text-left text-sm"><thead><tr>{['Mã tham chiếu','Trạng thái','Công cụ / Nguồn','Thời điểm lưu'].map(label=><th key={label} className="p-3">{label}</th>)}</tr></thead><tbody>{list.data.items.map(row=><tr className="border-t" key={row.evidence_id}><td className="p-3"><Link className="break-all text-primary" to={`${root}?id=${row.evidence_id}`}>{runs ? row.analysis_run_id : row.evidence_id}</Link></td><td className="p-3">{row.status}</td><td className="p-3">{row.tool_id ?? 'Chưa ghi nhận'}<br/>{row.parameters?.source_id ?? 'Chưa ghi nhận'}</td><td className="p-3">{row.created_at}</td></tr>)}</tbody></table>}
      <div className="flex items-center gap-3 border-t p-3"><Button variant="outline" disabled={cursors.length===1 || list.isFetching} onClick={()=>setCursors(c=>c.slice(0,-1))}>Trước</Button><span>Trang {cursors.length}</span><Button variant="outline" disabled={!list.data.next_before || list.isFetching} onClick={()=>setCursors(c=>[...c,list.data!.next_before])}>Sau</Button></div>
    </section>}
    {selected && <section className="panel space-y-4 p-5"><h2 className="font-semibold">Chi tiết bản ghi</h2>
      {detail.isPending && <p role="status">Đang tải bằng chứng…</p>}
      {detail.isError && <p role="alert">Không đọc được bản ghi hoặc bản ghi không thuộc tài khoản này.</p>}
      {detail.data && !detail.isError && <><p className="break-all text-sm">Analysis Run: {detail.data.analysis_run_id}<br/>Tool call: {detail.data.tool_call_id}</p>
        <p className="text-sm">Snapshot kết quả đã lưu; không đảm bảo tái hiện chính xác dữ liệu nguồn tại thời điểm chạy.</p>
        <OrderEvidenceDetails item={detail.data.document}/>
        <EvidenceNotes key={`${user?.id}:${selected}`} evidenceId={selected}/>
        {reports ? <ReportPreview key={`report:${user?.id}:${selected}`} evidence={detail.data.document}/> : <Link className="block text-sm text-primary" to={`/reports?id=${selected}`}>Xem báo cáo nháp →</Link>}
        <Link className="block text-sm text-primary" to={`${runs ? '/evidence' : '/analysis-runs'}?id=${selected}`}>{runs ? 'Mở Evidence Explorer' : 'Mở Analysis Run'} →</Link>
        <details><summary className="cursor-pointer text-sm">Toàn bộ provenance và kết quả gốc</summary><pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-muted p-3 text-xs">{JSON.stringify(detail.data.document,null,2)}</pre></details>
      </>}
    </section>}
  </div>
}
