import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../../auth/AuthContext'
import { apiRequest } from '../../lib/api'
import { Button } from '../../components/ui/button'
const actions=['account.created','account.updated','account.disabled','password.changed','account.bootstrapped','sessions.revoked','preferences.updated']
type Audit={id:string;actor_id:string|null;target_id:string|null;action:string;created_at:string;changes:Record<string,unknown>}
export default function AuditPage(){
  const {user}=useAuth()
  const empty={action:'',actor_id:'',target_id:''}
  const [draft,setDraft]=useState(empty),[filters,setFilters]=useState(empty),[cursors,setCursors]=useState<Array<string|null>>([null])
  const cursor=cursors[cursors.length-1]
  const result=useQuery({queryKey:['account-audit',user?.id,filters,cursor],queryFn:({signal})=>{
    const params=new URLSearchParams({limit:'25'});for(const [k,v] of Object.entries(filters))if(v)params.set(k,v);if(cursor)params.set('cursor',cursor)
    return apiRequest<{items:Audit[];next_cursor:string|null}>(`/api/v2/admin/audit?${params}`,{signal})
  },retry:false,gcTime:0})
  return <div className="space-y-5"><h1 className="text-2xl font-semibold">Audit tài khoản</h1>
    <p className="panel p-4 text-sm">Lịch sử thao tác tài khoản đã lưu trong PostgreSQL. Chỉ đọc; không bao gồm recovery, replay hoặc thay đổi cấu hình pipeline. Trường thay đổi đã được API giới hạn, không trả mật khẩu hay secret.</p>
    <form className="panel flex flex-wrap items-end gap-3 p-4" onSubmit={e=>{e.preventDefault();setFilters({action:draft.action,actor_id:draft.actor_id.trim(),target_id:draft.target_id.trim()});setCursors([null])}}>
      <label>Hành động<select aria-label="Hành động audit" className="block rounded border bg-background p-2" value={draft.action} onChange={e=>setDraft(d=>({...d,action:e.target.value}))}><option value="">Tất cả</option>{actions.map(action=><option key={action}>{action}</option>)}</select></label>
      {(['actor_id','target_id'] as const).map(field=><label key={field}>{field==='actor_id'?'Người thực hiện (UUID)':'Tài khoản bị tác động (UUID)'}<input className="block rounded border bg-background p-2" value={draft[field]} maxLength={36} pattern="[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}" onChange={e=>setDraft(d=>({...d,[field]:e.target.value}))}/></label>)}
      <Button type="submit">Áp dụng</Button><Button type="button" variant="outline" onClick={()=>{setDraft(empty);setFilters(empty);setCursors([null])}}>Xóa bộ lọc</Button>
    </form>
    <p className="text-xs text-muted-foreground">Đang lọc: {filters.action||'mọi hành động'} · actor {filters.actor_id||'tất cả'} · target {filters.target_id||'tất cả'}</p>
    <Button variant="outline" disabled={result.isFetching} onClick={()=>void result.refetch()}>Làm mới audit</Button>
    {result.isPending&&<p role="status">Đang tải audit…</p>}{result.isError&&<p role="alert">Không tải được audit. Kiểm tra quyền, bộ lọc hoặc API; không có nghĩa là lịch sử trống.</p>}
    {result.data&&!result.isError&&<section className="panel overflow-x-auto">{!result.data.items.length?<p className="p-4">Chưa có bản ghi phù hợp.</p>:<table className="w-full text-left text-sm"><thead><tr>{['Thời điểm UTC','Hành động','Người thực hiện','Tài khoản bị tác động','Thay đổi'].map(label=><th className="p-3" key={label}>{label}</th>)}</tr></thead><tbody>{result.data.items.map(row=><tr className="border-t" key={row.id}><td className="p-3">{row.created_at}</td><td className="p-3">{row.action}</td><td className="break-all p-3">{row.actor_id??'Không ghi nhận'}</td><td className="break-all p-3">{row.target_id??'Không ghi nhận'}</td><td className="p-3"><pre className="whitespace-pre-wrap">{JSON.stringify(row.changes,null,2)}</pre></td></tr>)}</tbody></table>}<div className="flex gap-3 p-3"><Button disabled={cursors.length===1||result.isFetching} onClick={()=>setCursors(c=>c.slice(0,-1))}>Trước</Button><span>Trang {cursors.length}</span><Button disabled={!result.data.next_cursor||result.isFetching} onClick={()=>setCursors(c=>[...c,result.data!.next_cursor])}>Sau</Button></div></section>}
  </div>
}
