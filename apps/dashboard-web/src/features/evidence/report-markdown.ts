import type { OrderEvidence } from '../chat/order-evidence'

type Evidence = OrderEvidence & { analysis_run_id: string; tool_call_id: string }
export type ReportNotes = {items:Array<{note_id:string;evidence_id:string;actor_id:string;content:string;origin:string;created_at:string;review_kind?:string}>;next_before:string|null;fetched_at:string}
// Escape untrusted metadata as text, including Markdown table delimiters and HTML.
const text = (value: unknown) => String(value ?? 'Chưa ghi nhận')
  .replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]!))
  .replace(/[\\`*_{}[\]()#+.!|~-]/g, '\\$&').replace(/[\r\n]+/g, ' ')

export function reportMarkdown(evidence: Evidence, notes?: ReportNotes): string {
  const scope = evidence.provenance?.parameters
  const lines = [
    '# Báo cáo quan sát — Bản nháp', '',
    '> Không phải finding chính thức. Bản xuất từ bằng chứng đã lưu; không phải báo cáo đã được xuất bản.', '',
    '## 1. Kết quả quan sát', '',
    'Giá trị đơn hàng đã đặt (gross order value), không phải doanh thu đã thanh toán. Không cộng chéo tiền tệ.', '',
    `Trạng thái: ${text(evidence.status)}. Chất lượng: ${text(evidence.quality_state)}.`, '',
  ]
  if (evidence.status === 'PROVISIONAL' && evidence.result?.groups.length) {
    lines.push('| Tiền tệ | Giá trị đơn đã đặt | Số đơn | AOV |', '| --- | --- | --- | --- |')
    for (const group of evidence.result.groups) {
      lines.push(`| ${[group.currency_code, group.values['measure.gross_order_value@1.0.0'], group.values['measure.order_count@1.0.0'], group.values['metric.average_order_value@1.0.0']].map(text).join(' | ')} |`)
    }
  } else if(evidence.status==='PROVISIONAL' && evidence.result?.orders?.length){
    lines.push('Xếp hạng riêng từng loại tiền, tối đa 5 đơn; cùng giá trị thì sắp theo mã đơn.', '', '| Tiền tệ | Hạng | Đơn hàng | Giá trị đơn đã đặt |','| --- | --- | --- | --- |')
    for(const row of evidence.result.orders)lines.push(`| ${[row.currency_code,row.position,row.order_id,row.gross_order_value].map(text).join(' | ')} |`)
  } else lines.push('Không công bố số liệu. Thiếu dữ liệu không đồng nghĩa bằng 0.')
  lines.push('', '## 2. Bằng chứng và định nghĩa', '',
    `- Evidence: ${text(evidence.evidence_id)}`,
    `- Analysis Run: ${text(evidence.analysis_run_id)}`,
    `- Tool call: ${text(evidence.tool_call_id)}`,
    `- Tool/version: ${text(evidence.semantic_context?.tool_id)} (version riêng: chưa ghi nhận trong bản trình bày này)`,
    `- Catalog: ${text(evidence.semantic_context?.catalog_release)}`,
    `- Nguồn: ${text(scope?.source_id)}`,
    `- Cửa sổ UTC: từ ${text(scope?.from)} đến trước ${text(scope?.to)}`,
    '- Định nghĩa giá trị: measure.gross_order_value@1.0.0',
    '- Định nghĩa số đơn: measure.order_count@1.0.0',
    '- Định nghĩa AOV: metric.average_order_value@1.0.0',
    '- Grain/physical binding: đối chiếu JSON bằng chứng gốc; không suy ra từ bảng tổng hợp.', '',
    '## 3. Diễn giải', '',
    'Chưa xác minh diễn giải nguyên nhân. Bảng trên chỉ trình bày kết quả công cụ đã lưu; ghi chú con người được tách riêng ở mục 6.', '',
    '## 4. Giới hạn', '',
    '- Chưa xác minh đầy đủ dữ liệu nguồn; trạng thái provisional không phải xác nhận chất lượng.',
    '- Snapshot kết quả không bảo đảm tái hiện chính xác dữ liệu nguồn tại thời điểm chạy.',
    '- Số đơn không đồng nghĩa số khách hàng duy nhất. Đơn đã đặt không xác nhận thanh toán.',
    ...((evidence.provenance?.warnings ?? []).map(warning => `- ${text(warning)}`)), '',
    '## 5. Kiểm tra tiếp', '',
    'Kiểm tra phạm vi thời gian, định nghĩa chỉ tiêu và chất lượng nguồn trước khi kết luận. Đây là hướng dẫn kiểm tra, không phải khuyến nghị kinh doanh từ dữ liệu.', '',
    'Tải kèm bản JSON để giữ toàn bộ provenance và kết quả gốc. Báo cáo này không thay thế bằng chứng.', '')
  lines.push('## 6. Nhận xét của người phân tích', '')
  if (!notes) lines.push('Không yêu cầu kèm ghi chú. Không suy ra bằng chứng này chưa có ghi chú.')
  else {
    lines.push(`HUMAN_NOTE — ý kiến con người, chưa xác minh; không phải kết quả công cụ. Tải tối đa 25 ghi chú mới nhất lúc ${text(notes.fetched_at)}.`, '')
    if (notes.next_before) lines.push('Còn ghi chú cũ hơn chưa được kèm trong bản xuất này.', '')
    if (!notes.items.length) lines.push('Không có ghi chú được trả về tại thời điểm tải.', '')
    for (const note of notes.items) lines.push(`### Ghi chú ${text(note.note_id)}`, '',
      `Tác giả: ${text(note.actor_id)}. Lưu lúc: ${text(note.created_at)}. Evidence: ${text(note.evidence_id)}. Loại đánh giá: ${text(note.review_kind??'NOTE')}.`, '', text(note.content), '')
  }
  return lines.join('\n')
}
