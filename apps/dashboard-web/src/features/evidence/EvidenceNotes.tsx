import { useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../../auth/AuthContext'
import { apiRequest } from '../../lib/api'
import { Button } from '../../components/ui/button'
import { reviewLabels } from './FindingsPage'
type Note = {note_id:string;actor_id:string;content:string;origin:string;created_at:string}
export function EvidenceNotes({evidenceId}:{evidenceId:string}) {
  const {user}=useAuth()
  const [kind,setKind]=useState('NOTE')
  const [content,setContent]=useState(''),[saving,setSaving]=useState(false),[message,setMessage]=useState('')
  const [cursors,setCursors]=useState<Array<string|null>>([null])
  const pending=useRef<{note_id:string;content:string;review_kind:string}|null>(null)
  const lock=useRef(false)
  const before=cursors[cursors.length-1]
  const path=`/api/v2/evidence/${encodeURIComponent(evidenceId)}/notes`
  const notes=useQuery({queryKey:['evidence-notes',user?.id,evidenceId,before],queryFn:({signal})=>apiRequest<{items:Note[];next_before:string|null}>(`${path}${before?`?before=${before}`:''}`,{signal}),retry:false,gcTime:0})
  async function save() {
    if(lock.current || !content.trim()) return
    lock.current=true;setSaving(true);setMessage('')
    if(!pending.current || pending.current.content!==content.trim() || pending.current.review_kind!==kind) pending.current={note_id:crypto.randomUUID(),content:content.trim(),review_kind:kind}
    try {
      await apiRequest(path,{method:'POST',body:JSON.stringify(pending.current)})
      pending.current=null;setContent('');setCursors([null]);setMessage('Đã lưu ghi chú trên máy chủ.');void notes.refetch()
    } catch {setMessage('Chưa xác nhận lưu được. Thử lại sẽ dùng cùng mã ghi chú để tránh trùng. Kiểm tra quyền hoặc API nếu lỗi tiếp diễn.')}
    finally {lock.current=false;setSaving(false)}
  }
  return <section className="space-y-3 rounded-lg border p-4"><h3 className="font-semibold">Nhận xét của người phân tích</h3>
    {user?.permissions?.includes('analytics.notes.write')&&<label className="block text-sm">Loại đánh giá <select aria-label="Loại đánh giá" disabled={saving} className="rounded border bg-background p-2" value={kind} onChange={e=>setKind(e.target.value)}>{Object.entries(reviewLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>}
    <p className="text-sm text-muted-foreground">HUMAN_NOTE · Không phải bằng chứng máy hay finding đã xác minh. Ghi chú đã lưu không sửa/xóa; thêm ghi chú mới để đính chính. Nội dung chưa bấm lưu sẽ mất khi rời trang. Trong Reports, chọn kèm ghi chú nếu muốn đưa nhận xét đã lưu vào file tải xuống.</p>
    {user?.permissions?.includes('analytics.notes.write') && <div className="space-y-2"><label className="block text-sm" htmlFor="evidence-note">Ghi chú cho bằng chứng này</label><textarea id="evidence-note" className="min-h-24 w-full rounded border bg-background p-3" maxLength={4000} disabled={saving} value={content} onChange={e=>setContent(e.target.value)}/><Button disabled={saving||!content.trim()} onClick={()=>void save()}>{saving?'Đang lưu…':'Lưu ghi chú'}</Button></div>}
    {message && <p role="status" className="text-sm">{message}</p>}
    {notes.isPending && <p>Đang tải ghi chú…</p>}
    {notes.isError && <p role="alert">Không tải được ghi chú. Schema hoặc API có thể chưa được cập nhật.</p>}
    {notes.data && !notes.isError && <>{!notes.data.items.length && <p>Chưa có ghi chú trên trang này.</p>}{notes.data.items.map(note=><article className="rounded border bg-muted/40 p-3" key={note.note_id}><p className="text-xs text-muted-foreground">HUMAN_NOTE · Tác giả: {note.actor_id} · {note.created_at}</p><p className="mt-2 whitespace-pre-wrap break-words">{note.content}</p></article>)}<div className="flex gap-2"><Button variant="outline" disabled={cursors.length===1||notes.isFetching} onClick={()=>setCursors(c=>c.slice(0,-1))}>Ghi chú trước</Button><Button variant="outline" disabled={!notes.data.next_before||notes.isFetching} onClick={()=>setCursors(c=>[...c,notes.data!.next_before])}>Ghi chú sau</Button><Button variant="outline" disabled={notes.isFetching} onClick={()=>void notes.refetch()}>Tải lại ghi chú</Button></div></>}
  </section>
}
