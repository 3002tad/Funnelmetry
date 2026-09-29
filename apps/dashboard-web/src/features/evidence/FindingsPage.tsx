import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useAuth } from '../../auth/AuthContext'
import { apiRequest } from '../../lib/api'
import { Button } from '../../components/ui/button'
export const reviewLabels:Record<string,string>={NOTE:'Ghi chú',USEFUL:'Hữu ích',NEEDS_REVIEW:'Cần kiểm tra',INACCURATE:'Không chính xác'}
type Note={note_id:string;evidence_id:string;analysis_run_id:string;actor_id:string;content:string;review_kind:string;evidence_status:string;created_at:string}
export default function FindingsPage(){
  const {user}=useAuth();const [kind,setKind]=useState(''),[cursors,setCursors]=useState<Array<string|null>>([null])
  const before=cursors[cursors.length-1]
  const result=useQuery({queryKey:['analytical-notes',user?.id,kind,before],queryFn:({signal})=>{
    const params=new URLSearchParams();if(kind)params.set('kind',kind);if(before)params.set('before',before)
    return apiRequest<{items:Note[];next_before:string|null}>(`/api/v2/analytical-notes?${params}`,{signal})
  },retry:false,gcTime:0})
  return <div className="space-y-5"><h1 className="text-2xl font-semibold">Findings · Đánh giá của DA</h1>
    <p className="panel p-4">Lịch sử nhận xét của bạn trên bằng chứng phân tích. HUMAN_NOTE, không phải finding máy đã xác minh. Mỗi lần đánh giá là một bản ghi riêng; không phải trạng thái cuối cùng của bằng chứng.</p>
    <div className="flex gap-3"><label>Loại đánh giá <select className="rounded border bg-background p-2" value={kind} onChange={e=>{setKind(e.target.value);setCursors([null])}}><option value="">Tất cả</option>{Object.entries(reviewLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label><Button variant="outline" disabled={result.isFetching} onClick={()=>void result.refetch()}>Làm mới</Button></div>
    <Link className="text-primary" to="/evidence">Mở Evidence để thêm đánh giá →</Link>
    {result.isPending&&<p>Đang tải…</p>}{result.isError&&<p role="alert">Không đọc được lịch sử. Kiểm tra API và quyền truy cập.</p>}
    {result.data&&!result.isError&&<>{!result.data.items.length&&<p>Chưa có đánh giá phù hợp.</p>}{result.data.items.map(note=><article className="panel space-y-3 p-4" key={note.note_id}><h2 className="font-semibold">{reviewLabels[note.review_kind]} · HUMAN_NOTE</h2><p className="text-xs">Tác giả: {note.actor_id} · {note.created_at} · Bằng chứng: {note.evidence_status}</p><p className="whitespace-pre-wrap break-words">{note.content}</p><nav className="flex gap-4 text-primary"><Link to={`/evidence?id=${note.evidence_id}`}>Evidence</Link><Link to={`/analysis-runs?id=${note.evidence_id}`}>Analysis Run</Link><Link to={`/reports?id=${note.evidence_id}`}>Reports</Link></nav></article>)}<div className="flex gap-3"><Button disabled={cursors.length===1||result.isFetching} onClick={()=>setCursors(c=>c.slice(0,-1))}>Trước</Button><Button disabled={!result.data.next_before||result.isFetching} onClick={()=>setCursors(c=>[...c,result.data!.next_before])}>Sau</Button></div></>}
  </div>
}
