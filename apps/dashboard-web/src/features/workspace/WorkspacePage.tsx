import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { apiRequest, ApiError } from '../../lib/api'
import { useAuth } from '../../auth/AuthContext'
import { Button } from '../../components/ui/button'
import { OrderEvidenceDetails, type OrderEvidence } from '../chat/order-evidence'

type Outcome = {status: string; evidence: Array<OrderEvidence & {analysis_run_id: string}>}
const date = (value: Date) => value.toISOString().slice(0,10)
export default function WorkspacePage() {
  const { user } = useAuth()
  const [from,setFrom] = useState(()=>date(new Date(Date.now()-30*86400000)))
  const [to,setTo] = useState(()=>date(new Date(Date.now()+86400000)))
  const [busy,setBusy] = useState(false)
  const [result,setResult] = useState<Outcome | null>(null)
  const [error,setError] = useState('')
  const active = useRef<AbortController | null>(null)
  useEffect(()=>()=>{active.current?.abort()},[])
  const allowed = user?.permissions?.includes('chat.use') && user.permissions.includes('analytics.read')
  const days = (Date.parse(to)-Date.parse(from))/86400000
  const valid = Number.isFinite(days) && days>0 && days<=90
  async function run(event: FormEvent) {
    event.preventDefault()
    if(!valid || !allowed || active.current) return
    const controller = new AbortController();active.current=controller
    setBusy(true);setError('');setResult(null)
    try {
      const outcome = await apiRequest<Outcome>('/api/v2/chat/order-summary',{method:'POST',signal:controller.signal,
        body:JSON.stringify({source_id:'medusa-reference',from:`${from}T00:00:00.000Z`,to:`${to}T00:00:00.000Z`})})
      if(!controller.signal.aborted)setResult(outcome)
    } catch(failure) {
      if(!controller.signal.aborted)setError(failure instanceof ApiError && failure.status===429 ? 'Đã đạt giới hạn yêu cầu, vui lòng chờ rồi thử lại.' : failure instanceof ApiError && failure.status===403 ? 'Tài khoản không có quyền thực thi phân tích.' : 'Không hoàn tất được phân tích. Kiểm tra API/cấu hình hoặc thử lại. Không coi đây là kết quả bằng 0.')
    } finally {if(active.current===controller){active.current=null;setBusy(false)}}
  }
  return <div className="space-y-5">
    <header><h1 className="text-2xl font-semibold">Data Workspace</h1><p className="mt-2 text-sm text-muted-foreground">Phân tích trực tiếp bằng công cụ xác định · Không gọi AI</p></header>
    <div className="grid gap-5 lg:grid-cols-2">
      <form onSubmit={run} className="panel space-y-4 p-5"><h2 className="font-semibold">1. Phạm vi phân tích</h2><p className="text-sm">Nguồn: medusa-reference. Dùng khoảng ngày UTC bên dưới, độc lập với bộ lọc trên thanh điều hướng.</p>
        <label className="block text-sm">Từ ngày (bao gồm)<input required type="date" value={from} disabled={busy} onChange={e=>{setFrom(e.target.value);setResult(null)}} className="mt-2 block w-full rounded-lg border bg-background p-2" /></label>
        <label className="block text-sm">Đến ngày (không bao gồm)<input required type="date" value={to} disabled={busy} onChange={e=>{setTo(e.target.value);setResult(null)}} className="mt-2 block w-full rounded-lg border bg-background p-2" /></label>
        {!valid && <p role="alert" className="text-sm">Chọn khoảng lớn hơn 0 và tối đa 90 ngày.</p>}
        {!allowed && <p role="alert" className="text-sm">Bản runtime hiện yêu cầu analytics.read và chat.use để chạy công cụ. Trang này không tự cấp quyền.</p>}
        <Button type="submit" disabled={!valid || !allowed || busy}>{busy ? 'Đang phân tích…' : 'Chạy phân tích đơn hàng'}</Button>
        <p className="text-xs text-muted-foreground">Chỉ ghi kết quả phân tích, không sửa đơn hàng. F5 không tự chạy lại; kết quả đã lưu xem trong Analysis Runs.</p>
      </form>
      <section className="panel space-y-3 p-5"><h2 className="font-semibold">2. Công cụ và cách tính</h2><p className="text-sm">tool.metric_summary · catalog order-analytics-staging-1.0.0</p><ul className="list-disc space-y-2 pl-5 text-sm"><li>Tổng giá trị đơn hàng đã đặt.</li><li>Số đơn duy nhất theo nguồn và order_id.</li><li>AOV = giá trị đơn / số đơn.</li><li>Nhóm theo tiền tệ, không quy đổi hay cộng chéo.</li></ul><p className="text-sm">Đây là thao tác thủ công một bước, chưa phải Agent Plan. Chưa hỗ trợ cao nhất, so sánh kỳ hay phân tích sản phẩm.</p><p className="text-sm">Không phải doanh thu đã thanh toán. Định nghĩa thử nghiệm và dữ liệu chưa đối soát phải được xem cùng cảnh báo.</p><div className="flex gap-4 text-sm text-primary"><Link to="/metrics">Xem Metrics</Link><Link to="/assets">Xem Asset</Link></div></section>
    </div>
    <section className="panel space-y-4 p-5"><h2 className="font-semibold">3. Kết quả và bằng chứng</h2>
      {busy && <p role="status">Đang thực thi công cụ và lưu bằng chứng…</p>}
      {error && <p role="alert">{error}</p>}
      {!busy && !error && !result && <p className="text-sm text-muted-foreground">Chọn phạm vi rồi bấm chạy để có kết quả.</p>}
      {result && <><p className="text-sm">Trạng thái: {result.status}</p>{result.status==='INSUFFICIENT_DATA' && <p>Chưa đủ dữ liệu; không đồng nghĩa tổng bằng 0.</p>}{result.status==='BLOCKED_BY_QUALITY' && <p role="alert">Không công bố số liệu do dữ liệu lỗi hoặc mâu thuẫn.</p>}{result.status==='PROVISIONAL' && <p>Dữ liệu tạm thời, chưa phải kết quả xác minh đầy đủ.</p>}
        {result.evidence.map(item=><div className="space-y-3" key={item.evidence_id}><OrderEvidenceDetails item={item}/><div className="flex gap-4 text-sm text-primary"><Link to={`/analysis-runs?id=${item.evidence_id}`}>Xem Analysis Run</Link><Link to={`/evidence?id=${item.evidence_id}`}>Xem bằng chứng đã lưu</Link></div></div>)}
      </>}
    </section>
  </div>
}
