import {useState} from 'react'
import {useQuery} from '@tanstack/react-query'
import {Link} from 'react-router-dom'
import {useAuth} from '../../auth/AuthContext'
import {apiRequest} from '../../lib/api'
import {Button} from '../../components/ui/button'
import {MetricDefinitions} from './MetricDefinitions'

type Entry={id:string;verification:string;chat_configured:boolean;provider_enabled:boolean;document:Record<string,unknown>|null}
type Registry={checked_at:string;scope:string;read_only:boolean;items:Entry[]}
const labels:Record<string,string>={'tool.metric_summary':'Tổng hợp giá trị đơn hàng','tool.order_ranking':'Xếp hạng đơn hàng','tool.product_value_ranking':'Xếp hạng sản phẩm — đơn giá × số lượng'}
export default function RegistryPage({kind}:{kind:'metadata'|'tools'|'metrics'}){
  const {user}=useAuth()
  const [search,setSearch]=useState('')
  const query=useQuery({queryKey:['admin-registry',user?.id],queryFn:({signal})=>apiRequest<Registry>('/api/v2/admin/registry',{signal}),retry:false,gcTime:0})
  const data=query.isError?undefined:query.data
  const items=data?.items.filter(item=>`${item.id} ${labels[item.id]} ${JSON.stringify(item.document??{})}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()))
  return <div className="space-y-5">
    <header className="flex items-start justify-between gap-3"><div><h1 className="text-2xl font-semibold">{kind==='metrics'?'Metric / Dimension / Relationship Catalog':kind==='metadata'?'Metadata Catalog':'Tool Registry'}</h1><p className="mt-2 text-sm text-muted-foreground">Tra cứu registry phân tích thử nghiệm · Chỉ đọc · Không gọi AI</p></div><Button variant="outline" disabled={query.isFetching} onClick={()=>void query.refetch()}>Làm mới</Button></header>
    <nav className="flex flex-wrap gap-4 text-primary"><Link to="/admin/metadata">Metadata</Link><Link to="/admin/tools">Tools</Link><Link to="/admin/metric-catalog">Chỉ tiêu và dimensions</Link></nav>
    <div className="panel space-y-2 p-5 text-sm"><p>Chỉ hiển thị 3 tool phân tích staging được hỗ trợ, không phải toàn bộ tool của hệ thống.</p><p>VERIFIED xác nhận định nghĩa và liên kết dữ liệu tương ứng, không xác nhận dữ liệu đầy đủ hoặc đã đối soát. Cờ chat/provider không chứng minh kết nối model đang khỏe.</p><p>Chưa hỗ trợ sửa, xóa hay công bố metadata. Giá trị đơn và đơn giá × số lượng không phải doanh thu thanh toán.</p></div>
    <label className="block text-sm">Tìm tên hoặc ID<input className="mt-2 block w-full rounded-lg border bg-background p-3" value={search} onChange={e=>setSearch(e.target.value)}/></label>
    {query.isPending&&<p role="status">Đang đọc registry…</p>}
    {query.isError&&<p role="alert">Không đọc được registry. Kiểm tra quyền/API; không coi đây là danh sách rỗng.</p>}
    {data&&<p className="text-xs text-muted-foreground">Kiểm tra lúc: {data.checked_at} · Không phụ thuộc bộ lọc thời gian trên thanh điều hướng</p>}
    {data&&!items?.length&&<p>Không có mục khớp từ khóa.</p>}
    {items?.map(item=><section className="panel space-y-3 p-5" key={item.id}>
      <h2 className="font-semibold">{labels[item.id]??item.id}</h2><p className="break-all text-sm">{item.id}</p>
      <div className="flex flex-wrap gap-3 text-sm"><span>Kiểm chứng: {item.verification}</span><span>Cấu hình chat: {item.chat_configured?'Bật':'Tắt'}</span><span>Provider: {item.provider_enabled?'Được bật':'Tắt'}</span></div>
      {!item.document?<p role="status">{item.verification==='NOT_INSTALLED'?'Chưa cài release tương ứng.':'Chưa xác minh được catalog/binding hoặc kết nối database. Không hiển thị định nghĩa chưa xác minh.'}</p>:<>
        <p className="text-sm">Release: {String(item.document.catalog_release??item.document.release_id??'Chưa khai báo')} · Metadata thử nghiệm, chưa công bố chính thức</p>
        {kind==='metrics'&&<MetricDefinitions document={item.document}/>}
        <details open={kind==='metadata'}><summary className="cursor-pointer text-primary">Định nghĩa, phiên bản, công thức, grain và chính sách gốc</summary><pre className="mt-3 max-h-[36rem] overflow-auto whitespace-pre-wrap break-words rounded-lg bg-muted/40 p-4 text-xs">{JSON.stringify(item.document,null,2)}</pre></details>
      </>}
    </section>)}
  </div>
}
