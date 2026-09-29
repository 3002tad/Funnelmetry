import {useState} from 'react'
import {useQuery} from '@tanstack/react-query'
import {useAuth} from '../../auth/AuthContext'
import {apiRequest,analyticsSourceId} from '../../lib/api'
import {Button} from '../../components/ui/button'
type Outcome={source_id:string;source_event_id:string;mapping_version:string;status:string;reason_code:string;processed_at:string}
export default function QuarantinePage(){
  const {user}=useAuth();const [draft,setDraft]=useState(analyticsSourceId),[source,setSource]=useState(analyticsSourceId),[status,setStatus]=useState(''),[offset,setOffset]=useState(0)
  const result=useQuery({queryKey:['quarantine',user?.id,source,status,offset],queryFn:({signal})=>{
    const params=new URLSearchParams({source_id:source,offset:String(offset)});if(status)params.set('status',status)
    return apiRequest<{items:Outcome[];next_offset:number|null;checked_at:string}>(`/api/v2/admin/quarantine?${params}`,{signal})
  },retry:false,gcTime:0})
  return <div className="space-y-5"><h1 className="text-2xl font-semibold">Quarantine / Unsupported</h1>
    <p className="panel p-4">Kết quả chuẩn hóa mới nhất của từng event. Quarantined: bị cách ly; Unsupported: chưa được hỗ trợ bởi mapping. Không phải toàn bộ Kafka DLQ hoặc request ingress bị từ chối. Không hiển thị raw payload, không có replay/xóa. Event đã được chuẩn hóa thành công sau đó không nằm trong danh sách này.</p>
    <form className="flex flex-wrap gap-3" onSubmit={e=>{e.preventDefault();setSource(draft.trim());setOffset(0)}}><label>Nguồn<input required maxLength={200} className="ml-2 rounded border bg-background p-2" value={draft} onChange={e=>setDraft(e.target.value)}/></label><Button type="submit" disabled={!draft.trim()}>Áp dụng</Button><select aria-label="Trạng thái chuẩn hóa" className="rounded border bg-background p-2" value={status} onChange={e=>{setStatus(e.target.value);setOffset(0)}}><option value="">Cả hai trạng thái</option><option value="quarantined">Quarantined</option><option value="unsupported">Unsupported</option></select><Button type="button" variant="outline" disabled={result.isFetching} onClick={()=>void result.refetch()}>Làm mới</Button></form>
    <p className="text-sm text-muted-foreground">Nguồn đang áp dụng: {source}. Phân trang trên dữ liệu đang thay đổi có thể dịch chuyển bản ghi; tối đa offset 10000.</p>
    {result.isPending&&<p role="status">Đang tải…</p>}{result.isError&&<p role="alert">Không đọc được dữ liệu. Không thể kết luận không có event lỗi.</p>}
    {result.data&&!result.isError&&<section className="panel overflow-x-auto"><p className="p-3">Kiểm tra lúc: {result.data.checked_at}</p>{!result.data.items.length?<p className="p-4">Không có kết quả phù hợp trong dữ liệu đã lưu.</p>:<table className="w-full text-left text-sm"><thead><tr>{['Event ID','Trạng thái','Mã lý do','Mapping version','Thời điểm xử lý'].map(v=><th className="p-3" key={v}>{v}</th>)}</tr></thead><tbody>{result.data.items.map(row=><tr className="border-t" key={row.source_event_id}><td className="break-all p-3">{row.source_event_id}</td><td className="p-3">{row.status}</td><td className="p-3">{row.reason_code}</td><td className="p-3">{row.mapping_version}</td><td className="p-3">{row.processed_at}</td></tr>)}</tbody></table>}<div className="flex gap-3 p-3"><Button disabled={!offset||result.isFetching} onClick={()=>setOffset(n=>Math.max(0,n-25))}>Trước</Button><span>Trang {offset/25+1}</span><Button disabled={result.data.next_offset===null||result.isFetching} onClick={()=>setOffset(result.data!.next_offset!)}>Sau</Button></div></section>}
  </div>
}
