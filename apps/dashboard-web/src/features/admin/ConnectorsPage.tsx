import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../../auth/AuthContext'
import { apiRequest } from '../../lib/api'
import { Button } from '../../components/ui/button'
type Cursor={connector_id:string;event_feed_id:string;after_seq:string;updated_at:string}
export default function ConnectorsPage(){
  const {user}=useAuth();const [draft,setDraft]=useState(''),[filter,setFilter]=useState(''),[pages,setPages]=useState<Array<string|null>>([null])
  const after=pages[pages.length-1]
  const readiness=useQuery({queryKey:['connector-readiness',user?.id],queryFn:({signal})=>apiRequest<{status:string;last_success_at:string|null;checked_at:string;reachable:boolean;error_present:boolean|null}>('/api/v2/admin/connector-readiness',{signal}),retry:false,gcTime:0})
  const result=useQuery({queryKey:['connector-cursors',user?.id,filter,after],queryFn:({signal})=>{
    const params=new URLSearchParams();if(filter)params.set('connector_id',filter);if(after)params.set('after',after)
    return apiRequest<{items:Cursor[];next_after:string|null;checked_at:string}>(`/api/v2/admin/connectors?${params}`,{signal})
  },retry:false,gcTime:0})
  return <div className="space-y-5"><h1 className="text-2xl font-semibold">Source Connector · Cursor đã lưu</h1>
    <section className="panel space-y-2 p-4"><h2 className="font-semibold">Readiness tiến trình được cấu hình giám sát</h2><Button variant="outline" disabled={readiness.isFetching} onClick={()=>void readiness.refetch()}>Kiểm tra readiness</Button>
      {readiness.isPending&&<p>Đang kiểm tra…</p>}{readiness.isError&&<p role="alert">Không tải được kiểm tra readiness.</p>}
      {readiness.data&&!readiness.isError&&<><p>Trạng thái: {readiness.data.status} · Kiểm tra lúc: {readiness.data.checked_at}</p><p>Poll thành công gần nhất: {readiness.data.last_success_at??'Chưa ghi nhận'}</p>{!readiness.data.reachable&&<p>Không xác minh được endpoint giám sát. Không đồng nghĩa tiến trình đã tắt.</p>}{readiness.data.error_present&&<p>Connector báo lỗi. Chi tiết đã được ẩn; cần kiểm tra phía vận hành.</p>}</>}
      <p className="text-xs text-muted-foreground">Ảnh chụp tại thời điểm kiểm tra, không tự cập nhật. READY không bảo đảm có event mới, đã hết backlog hoặc downstream đã xử lý xong. Endpoint giám sát không được tự ghép với từng cursor trong bảng.</p>
    </section>
    <p className="panel p-4">Pipeline chủ động pull HTTPS Event Feed. Cursor phản ánh bàn giao vào Kafka, không phải checkpoint xử lý an toàn hay số lượng event. Sequence có thể có khoảng trống. Không suy ra lag, online/offline hoặc đã xử lý xong từ cursor.</p>
    <form className="flex flex-wrap gap-3" onSubmit={e=>{e.preventDefault();setFilter(draft.trim());setPages([null])}}><label>Connector ID chính xác<input className="ml-2 rounded border bg-background p-2" maxLength={200} value={draft} onChange={e=>setDraft(e.target.value)}/></label><Button type="submit">Lọc</Button><Button variant="outline" type="button" onClick={()=>{setDraft('');setFilter('');setPages([null])}}>Xóa lọc</Button><Button type="button" variant="outline" disabled={result.isFetching} onClick={()=>void result.refetch()}>Làm mới</Button></form>
    <p className="text-sm text-muted-foreground">Bộ lọc đang áp dụng: {filter||'tất cả'}. Runtime / lag: chưa xác minh. Không có thao tác reset/replay.</p>
    {result.isPending&&<p role="status">Đang tải cursor…</p>}{result.isError&&<p role="alert">Không đọc được trạng thái connector. Kiểm tra API/quyền/schema; không có nghĩa connector không tồn tại.</p>}
    {result.data&&!result.isError&&<section className="panel overflow-x-auto"><p className="p-3 text-sm">Đọc dữ liệu lúc: {result.data.checked_at}</p>{!result.data.items.length?<p className="p-4">Chưa có cursor phù hợp được lưu.</p>:<table className="w-full text-left text-sm"><thead><tr>{['Connector','Feed lineage','Sau sequence','Lần cập nhật cursor'].map(v=><th className="p-3" key={v}>{v}</th>)}</tr></thead><tbody>{result.data.items.map(row=><tr className="border-t" key={row.connector_id}><td className="break-all p-3">{row.connector_id}</td><td className="break-all p-3">{row.event_feed_id}</td><td className="p-3">{row.after_seq}</td><td className="p-3">{row.updated_at}</td></tr>)}</tbody></table>}<div className="flex gap-3 p-3"><Button disabled={pages.length===1||result.isFetching} onClick={()=>setPages(p=>p.slice(0,-1))}>Trước</Button><span>Trang {pages.length}</span><Button disabled={!result.data.next_after||result.isFetching} onClick={()=>setPages(p=>[...p,result.data!.next_after])}>Sau</Button></div></section>}
  </div>
}
