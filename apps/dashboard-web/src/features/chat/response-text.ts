export function chatResponseText(result: { status: string; answer: string | null }): string {
  if (result.status === 'BLOCKED_BY_QUALITY') return 'Kết quả bị chặn do dữ liệu lỗi hoặc mâu thuẫn. Chưa thể công bố số liệu; xem bằng chứng bên dưới.'
  if (['no_evidence', 'INSUFFICIENT_DATA'].includes(result.status)) return 'Chưa có đủ dữ liệu trong phạm vi này. Điều này không đồng nghĩa giá trị bằng 0.'
  if (result.status === 'unsupported') return 'Công cụ hiện chưa hỗ trợ yêu cầu này.'
  if (result.status === 'ERROR') return 'Không thể hoàn tất phân tích. Chưa có kết quả hợp lệ.'
  return result.answer ?? 'Chưa có nội dung trả lời. Hãy xem trạng thái bằng chứng.'
}
