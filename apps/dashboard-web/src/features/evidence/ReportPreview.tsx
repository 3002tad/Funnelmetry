import type { OrderEvidence } from '../chat/order-evidence'
import { OrderRankingTable } from '../chat/order-evidence'
import { Button } from '../../components/ui/button'
import { reportMarkdown, type ReportNotes } from './report-markdown'
import { useEffect, useRef, useState } from 'react'
import { apiRequest } from '../../lib/api'

type Evidence = OrderEvidence & {analysis_run_id:string;tool_call_id:string}
export function ReportPreview({evidence}:{evidence:Evidence}) {
  const [includeNotes,setIncludeNotes]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('')
  const active=useRef<AbortController|null>(null)
  useEffect(()=>()=>active.current?.abort(),[])
  const available = evidence.status === 'PROVISIONAL' && !!evidence.result?.groups.length
  const observations = available ? evidence.result!.groups.map(group => ({currency:group.currency_code,values:group.values})) : []
  const interpretation = 'Chỉ mô tả kết quả công cụ đã lưu; chưa xác minh diễn giải nguyên nhân hoặc so sánh. Nhận xét của người phân tích được trình bày riêng dưới nhãn HUMAN_NOTE.'
  const limitations = ['Bản nháp dựng từ snapshot kết quả, không phải finding chính thức.', 'Giá trị đơn đã đặt không xác nhận thanh toán. Không cộng chéo tiền tệ.',
    'Chưa xác minh đầy đủ dữ liệu nguồn; snapshot không bảo đảm tái hiện dữ liệu tại thời điểm chạy.', ...(evidence.provenance?.warnings ?? [])]
  async function download(format: 'json' | 'md' = 'json') {
    if(active.current) return
    const controller=new AbortController();active.current=controller;setBusy(true);setError('')
    try {
    let notes:ReportNotes|undefined
    if(includeNotes) {
      const response=await apiRequest<Omit<ReportNotes,'fetched_at'>>(`/api/v2/evidence/${encodeURIComponent(evidence.evidence_id)}/notes`,{signal:controller.signal})
      notes={...response,fetched_at:new Date().toISOString()}
    }
    if(controller.signal.aborted) return
    const document = { report_format:'evidence-report-preview.v1', official:false, persisted_report:false,
      evidence_id:evidence.evidence_id, analysis_run_id:evidence.analysis_run_id, tool_call_id:evidence.tool_call_id,
      status:evidence.status, observations, order_ranking:evidence.status==='PROVISIONAL'?evidence.result?.orders:undefined, interpretation, limitations,
      human_notes:notes?{...notes,scope:'latest_25',official:false}: {included:false},
      suggested_next_analysis:'Kiểm tra phạm vi thời gian và chất lượng nguồn trước khi kết luận.',
      evidence: evidence.status === 'PROVISIONAL' ? evidence : {...evidence,result:null} }
    const url=URL.createObjectURL(new Blob([format === 'md' ? reportMarkdown(evidence,notes) : JSON.stringify(document,null,2)],{type:format === 'md' ? 'text/markdown;charset=utf-8' : 'application/json'}))
    const link=window.document.createElement('a');link.href=url;link.download=`report-${evidence.evidence_id}.${format}`;link.click()
    setTimeout(()=>URL.revokeObjectURL(url),1000)
    } catch {if(!controller.signal.aborted)setError('Không xuất được báo cáo: chưa tải được ghi chú. Kiểm tra quyền/kết nối rồi thử lại. Không có file thiếu ghi chú được tạo.')}
    finally {active.current=null;if(!controller.signal.aborted)setBusy(false)}
  }
  return <article className="space-y-4 rounded-lg border p-5" aria-label="Bản xem báo cáo">
    <header className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-semibold">Báo cáo quan sát · Bản nháp</h3><div className="flex gap-2"><Button disabled={busy} variant="outline" onClick={()=>void download('md')}>Tải báo cáo Markdown</Button><Button disabled={busy} variant="outline" onClick={()=>void download('json')}>Tải bản JSON</Button></div></header>
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={includeNotes} disabled={busy} onChange={e=>setIncludeNotes(e.target.checked)}/>Kèm 25 ghi chú mới nhất đã lưu (có tác giả/thời điểm)</label>
    {busy && <p role="status">Đang chuẩn bị bản xuất…</p>}{error && <p role="alert">{error}</p>}
    <section hidden={evidence.status === 'PROVISIONAL' && !!evidence.result?.orders?.length}><h4 className="font-medium">1. Kết quả quan sát</h4>{!available ? <p className="mt-2 text-sm">Không công bố số liệu: trạng thái {evidence.status}. Thiếu dữ liệu không đồng nghĩa bằng 0.</p> : <div className="mt-2 overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th>Tiền tệ</th><th>Giá trị đơn đã đặt</th><th>Số đơn</th><th>AOV</th></tr></thead><tbody>{observations.map(row=><tr key={row.currency}><td>{row.currency}</td><td>{row.values['measure.gross_order_value@1.0.0']??'Không có'}</td><td>{row.values['measure.order_count@1.0.0']??'Không có'}</td><td>{row.values['metric.average_order_value@1.0.0']??'Không có'}</td></tr>)}</tbody></table></div>}</section>
    <section><h4 className="font-medium">2. Bằng chứng</h4><p className="mt-2 break-all text-sm">{evidence.evidence_id}<br/>Nguồn: {evidence.provenance?.parameters?.source_id??'Chưa ghi nhận'}<br/>UTC: {evidence.provenance?.parameters?.from??'—'} → trước {evidence.provenance?.parameters?.to??'—'}<br/>Catalog: {evidence.semantic_context?.catalog_release??'Chưa ghi nhận'}</p></section>
    <OrderRankingTable item={evidence}/>
    <section><h4 className="font-medium">3. Diễn giải</h4><p className="mt-2 text-sm">{interpretation}</p></section>
    <section><h4 className="font-medium">4. Giới hạn</h4><ul className="mt-2 list-disc pl-5 text-sm">{limitations.map((text,i)=><li key={i}>{text}</li>)}</ul></section>
    <section><h4 className="font-medium">5. Kiểm tra tiếp</h4><p className="mt-2 text-sm">Kiểm tra phạm vi thời gian và chất lượng nguồn trước khi kết luận. Đây là hướng dẫn kiểm tra, không phải phát hiện hay khuyến nghị kinh doanh từ dữ liệu.</p></section>
    <p className="text-xs text-muted-foreground">Bản xem dựng từ bằng chứng đã lưu. Ghi chú lưu riêng, chỉ kèm khi chọn ở trên; nội dung đang soạn chưa lưu không được xuất. Chưa có tài liệu report độc lập hoặc quy trình công bố.</p>
  </article>
}
