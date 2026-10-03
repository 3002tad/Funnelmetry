import {useState} from 'react'
import {useQuery} from '@tanstack/react-query'
import {useAuth} from '../../auth/AuthContext'
import {apiRequest} from '../../lib/api'
import {Button} from '../../components/ui/button'
type Mapping={source_event_type:string;source_schema_version:string;event_type:string;event_class:string;mapping_version:string;payload_contract?:string}
type Inspection={source_id:string;schema_version:string;artifact:string;sha256:string;checked_at:string;runtime_status:string;mappings:Mapping[]}
export default function MappingsPage(){
  const {user}=useAuth();const [search,setSearch]=useState('')
  const query=useQuery({queryKey:['admin-mappings',user?.id],queryFn:({signal})=>apiRequest<Inspection>('/api/v2/admin/mappings',{signal}),retry:false,gcTime:0})
  const data=query.isError?undefined:query.data
  const rows=data?.mappings.filter(r=>JSON.stringify(r).toLowerCase().includes(search.toLowerCase()))
  return <div className="space-y-5">
    <header className="flex justify-between gap-4"><div><h1 className="text-2xl font-semibold">Schemas / Mappings</h1><p className="mt-2 text-sm text-muted-foreground">Tra cứu mapping source-native trong bản triển khai · Chỉ đọc</p></div><Button variant="outline" disabled={query.isFetching} onClick={()=>void query.refetch()}>Làm mới</Button></header>
    <section className="panel space-y-2 p-5 text-sm"><p>Phạm vi: file mapping Medusa source-native. Chưa liệt kê các mapping passthrough/behavior được tạo trong code hoặc toàn bộ JSON schema.</p><p>Phiên bản file mapping không phải phiên bản payload. Không xác nhận worker đã nạp file này; trạng thái runtime vẫn UNVERIFIED.</p><p>Không sửa mapping, replay hay thay đổi dữ liệu lịch sử tại đây.</p></section>
    {query.isPending&&<p role="status">Đang đọc mapping…</p>}{query.isError&&<p role="alert">Không đọc được mapping hoặc cấu hình không hợp lệ. Không coi đây là danh sách rỗng.</p>}
    {data&&<><section className="panel space-y-2 p-5 text-sm"><p>Nguồn: {data.source_id} · Định dạng file: {data.schema_version}</p><p className="break-all">Artifact: {data.artifact}</p><p className="break-all">SHA-256: {data.sha256}</p><p>Runtime: {data.runtime_status} · Kiểm tra: {data.checked_at}</p></section>
    <label className="block text-sm">Tìm event / phiên bản<input className="mt-2 block w-full rounded-lg border bg-background p-3" value={search} onChange={e=>setSearch(e.target.value)}/></label>
    {!rows?.length&&<p>Không có mapping khớp từ khóa.</p>}
    <div className="panel overflow-x-auto p-4"><table className="w-full text-left text-sm"><caption className="mb-3 text-left">Mapping khai báo — chưa xác nhận trạng thái worker</caption><thead><tr><th>Event nguồn</th><th>Schema payload</th><th>Event canonical</th><th>Class</th><th>Mapping version</th><th>Payload contract</th></tr></thead><tbody>{rows?.map(r=><tr className="border-t" key={`${r.source_event_type}:${r.source_schema_version}`}>{[r.source_event_type,r.source_schema_version,r.event_type,r.event_class,r.mapping_version,r.payload_contract??'Chưa khai báo'].map((v,i)=><td className="p-3" key={i}>{v}</td>)}</tr>)}</tbody></table></div></>}
  </div>
}
