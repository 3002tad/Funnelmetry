import {useState} from 'react'
import {useQuery} from '@tanstack/react-query'
import {useAuth} from '../../auth/AuthContext'
import {apiRequest} from '../../lib/api'
import {Button} from '../../components/ui/button'
type Result={checked_at:string;items:Array<{analysis_run_id:string;tool_call_id:string;created_at:string;status:string;tool_id:string|null;code:string|null}>}
export default function RunDiagnosticsPage(){
  const {user}=useAuth();const [status,setStatus]=useState('')
  const query=useQuery({queryKey:['admin-run-diagnostics',user?.id,status],queryFn:({signal})=>apiRequest<Result>(`/api/v2/admin/run-diagnostics${status?`?status=${encodeURIComponent(status)}`:''}`,{signal}),retry:false,gcTime:0})
  const data=query.isError?undefined:query.data
  return <div className="space-y-5"><header className="flex justify-between gap-4"><div><h1 className="text-2xl font-semibold">Analysis Run Diagnostics</h1><p className="mt-2 text-sm text-muted-foreground">Chẩn đoán thực thi đã lưu · Chỉ đọc · Không gọi AI</p></div><Button variant="outline" disabled={query.isFetching} onClick={()=>void query.refetch()}>Làm mới</Button></header>
    <section className="panel space-y-2 p-5 text-sm"><p>Tối đa 50 lần thực thi đã lưu gần nhất trong 30 ngày, theo bộ lọc. Không phải toàn bộ lịch sử hội thoại.</p><p>Không bao gồm yêu cầu đang chạy, lỗi trước khi lưu bằng chứng, lỗi mạng/model hoặc lỗi lưu database. Chưa có telemetry retry, re-plan, latency hay chi phí.</p><p>PROVISIONAL là kết quả tạm thời, không phải xác nhận chất lượng hoàn chỉnh. Không công bố câu hỏi, người hỏi hoặc dữ liệu kinh doanh tại đây.</p></section>
    <label className="block text-sm">Trạng thái<select className="ml-3 rounded-lg border bg-background p-2" value={status} onChange={e=>setStatus(e.target.value)}><option value="">Tất cả</option>{['PROVISIONAL','INSUFFICIENT_DATA','BLOCKED_BY_QUALITY','ERROR'].map(s=><option key={s}>{s}</option>)}</select></label>
    {query.isPending&&<p role="status">Đang tải…</p>}{query.isError&&<p role="alert">Không đọc được chẩn đoán. Kiểm tra quyền/API/database; không coi đây là không có lỗi.</p>}
    {data&&<><p className="text-xs text-muted-foreground">Kiểm tra lúc {data.checked_at} · {data.items.length} bản ghi được trả về</p>{!data.items.length?<p>Không có lần thực thi đã lưu phù hợp. Không đồng nghĩa hệ thống không có lỗi.</p>:<div className="panel overflow-x-auto p-4"><table className="w-full text-left text-sm"><thead><tr><th>Thời điểm lưu</th><th>Analysis Run / Tool call</th><th>Tool</th><th>Trạng thái</th><th>Mã chẩn đoán</th></tr></thead><tbody>{data.items.map(r=><tr className="border-t" key={r.analysis_run_id}><td className="p-3">{r.created_at}</td><td className="p-3 font-mono text-xs">{r.analysis_run_id}<br/>{r.tool_call_id}</td><td className="p-3">{r.tool_id??'Chưa xác định'}</td><td className="p-3">{r.status}</td><td className="p-3">{r.code??'Không ghi nhận mã'}</td></tr>)}</tbody></table></div>}</>}
  </div>
}
