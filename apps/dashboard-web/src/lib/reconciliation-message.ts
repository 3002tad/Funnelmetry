/** Explain evidence availability without upgrading the API quality state. */
export function reconciliationMessage(reasons: readonly string[]) {
  if (reasons.includes('NO_RECONCILIATION_EVIDENCE')) return 'Chưa có snapshot đối soát trong nguồn và khoảng thời gian đã chọn. Kiểm tra phạm vi ngày và việc nạp snapshot; trạng thái này không tự chứng minh tiến trình xử lý bị lỗi.'
  if (reasons.includes('DEGRADED_WINDOW')) return 'Có cửa sổ đối soát bị suy giảm chất lượng. Cần xem bằng chứng của cửa sổ đó trước khi dùng số liệu chính thức.'
  if (reasons.includes('PROVISIONAL_WINDOW')) return 'Có cửa sổ dữ liệu còn tạm thời; chưa đủ điều kiện chốt số liệu.'
  if (reasons.includes('UNRESOLVED_DISCREPANCY')) return 'Còn chênh lệch chưa giải quyết trong đối soát. Cần kiểm tra kết quả so sánh nguồn và dữ liệu phân tích.'
  return ''
}
