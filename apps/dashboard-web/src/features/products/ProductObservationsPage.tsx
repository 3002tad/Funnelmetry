import { useMemo,useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useOutletContext } from 'react-router-dom'
import type { ShellContext } from '../../app/AppShell'
import { useAuth } from '../../auth/AuthContext'
import { apiRequest } from '../../lib/api'
import { Button } from '../../components/ui/button'

type Row={product_id:string;views:string;adds:string;previous_views:string;previous_adds:string;last_seen:string|null;reference?:{title:string;snapshot_id:string;observed_at:string;provider:string}|null}
type Result={items:Row[];next_offset:number|null;scope:{from:string;to:string;previous_from:string;previous_to:string};contract:{id:string;version:string;grain:string;time_basis:string;limitations:string[]}}
export default function ProductObservationsPage(){
  const {sourceId,range}=useOutletContext<ShellContext>()
  return <ProductObservations key={`${sourceId}:${range}`} sourceId={sourceId} range={range}/>
}
function ProductObservations({sourceId,range}:{sourceId:string;range:string}){
  const {user}=useAuth()
  const [sort,setSort]=useState('views'),[filter,setFilter]=useState(''),[draft,setDraft]=useState(''),[offset,setOffset]=useState(0),[refresh,setRefresh]=useState(0)
  const window=useMemo(()=>{const to=new Date();const days=range==='Last 7 days'?7:range==='Last 90 days'?90:30;return {from:new Date(to.getTime()-days*86400000).toISOString(),to:to.toISOString()}},[range,sourceId,refresh])
  const query=useQuery({queryKey:['products-observed',user?.id,sourceId,window,sort,filter,offset],queryFn:({signal})=>{
    const params=new URLSearchParams({source_id:sourceId,...window,sort,offset:String(offset)});if(filter)params.set('product_id',filter)
    return apiRequest<Result>(`/api/v2/products?${params}`,{signal})
  },retry:false,gcTime:0})
  return <div className="space-y-5"><header className="flex justify-between gap-4"><div><h1 className="text-2xl font-semibold">Products</h1><p className="mt-2 text-sm text-muted-foreground">Quan sát event theo sản phẩm · {sourceId}</p></div><Button variant="outline" disabled={query.isFetching} onClick={()=>{setOffset(0);setRefresh(n=>n+1)}}>Làm mới</Button></header>
    <section className="panel space-y-2 p-5 text-sm"><p className="font-medium">Số lần phát event, không phải số khách hay số lượng hàng.</p><p>Tên sản phẩm lấy từ catalog tham chiếu gần nhất nếu đã đồng bộ, không phải tên tại thời điểm phát event. Thiếu tên vẫn giữ product ID. Không suy ra doanh thu sản phẩm hoặc tỷ lệ chuyển đổi từ các số đếm này.</p><p>Dữ liệu tạm thời, chưa xác minh đầy đủ/độ mới. Kỳ trước có cùng độ dài và liền trước kỳ hiện tại.</p></section>
    <form className="flex flex-wrap items-end gap-3" onSubmit={e=>{e.preventDefault();setFilter(draft.trim());setOffset(0)}}><label className="flex-1 text-sm">Lọc chính xác product ID<input className="mt-2 block w-full rounded-lg border bg-background p-2" maxLength={200} value={draft} onChange={e=>setDraft(e.target.value)}/></label><Button type="submit">Lọc</Button><label className="text-sm">Sắp xếp<select className="ml-2 rounded-lg border bg-background p-2" value={sort} onChange={e=>{setSort(e.target.value);setOffset(0)}}><option value="views">Event xem</option><option value="adds">Event thêm giỏ</option><option value="product_id">Product ID</option></select></label></form>
    {query.isPending&&<p role="status">Đang tải sản phẩm…</p>}{query.isError&&<p role="alert">Không tải được số liệu sản phẩm. Không coi lỗi này là không có event.</p>}
    {query.data&&!query.isError&&<><p className="text-xs text-muted-foreground">UTC hiện tại: {query.data.scope.from} → trước {query.data.scope.to}<br/>Kỳ trước: {query.data.scope.previous_from} → trước {query.data.scope.previous_to}</p>
      <section className="panel overflow-x-auto">{!query.data.items.length?<p className="p-5">Không có event sản phẩm phù hợp trong hai kỳ.</p>:<table className="w-full text-left text-sm"><thead><tr>{['Sản phẩm / ID','Xem','Xem kỳ trước','Thêm giỏ','Thêm giỏ kỳ trước','Event gần nhất'].map(label=><th key={label} className="p-3">{label}</th>)}</tr></thead><tbody>{query.data.items.map(row=><tr className="border-t" key={row.product_id}><td className="p-3"><p className="font-medium">{row.reference?.title??'Chưa có tên từ catalog'}</p><button className="break-all text-left text-primary" onClick={()=>{setDraft(row.product_id);setFilter(row.product_id);setOffset(0)}}>{row.product_id}</button>{row.reference&&<details className="mt-1 text-xs text-muted-foreground"><summary>Catalog tham chiếu · chưa xác minh độ mới</summary><p>Đồng bộ (UTC): {row.reference.observed_at}</p><p>Nguồn: {row.reference.provider}</p><p className="break-all">Snapshot: {row.reference.snapshot_id}</p></details>}</td>{[row.views,row.previous_views,row.adds,row.previous_adds,row.last_seen??'Không có trong kỳ'].map((value,index)=><td className="p-3" key={index}>{value}</td>)}</tr>)}</tbody></table>}<div className="flex gap-3 border-t p-3"><Button variant="outline" disabled={!offset||query.isFetching} onClick={()=>setOffset(n=>Math.max(0,n-50))}>Trước</Button><Button variant="outline" disabled={query.data.next_offset===null||query.isFetching} onClick={()=>setOffset(query.data!.next_offset!)}>Sau</Button></div></section>
      <details className="panel p-5"><summary className="cursor-pointer">Định nghĩa và giới hạn dữ liệu</summary><p className="mt-3 text-sm">{query.data.contract.id}@{query.data.contract.version} · {query.data.contract.grain} · {query.data.contract.time_basis}</p><ul className="mt-3 list-disc pl-5 text-sm">{query.data.contract.limitations.map(text=><li key={text}>{text}</li>)}</ul></details>
    </>}
  </div>
}
