// Presentation only: no arithmetic, LLM text, rounding or FX conversion.
function displayAmount(value) {
  const [whole, fraction] = value.split('.')
  return fraction?.length > 2 ? `${whole}.${fraction.replace(/0+$/, '').padEnd(2, '0')}` : value
}
const warningLabels = {
  DRAFT_METADATA_NOT_RUNTIME_PUBLISHED: 'Định nghĩa chỉ tiêu đang ở bản thử nghiệm.',
  FEED_COMPLETENESS_FRESHNESS_RECONCILIATION_UNVERIFIED: 'Chưa xác minh dữ liệu đã đầy đủ, cập nhật và đối soát.',
  FEED_COMPLETENESS_UNVERIFIED: 'Chưa xác minh dữ liệu đã đầy đủ.',
  PLACED_ORDER_VALUE_NOT_PAID_REVENUE: 'Giá trị đơn đã đặt không xác nhận thanh toán thành công.',
}
export function renderOrderSummary(evidence) {
  const fail = () => { throw Error('invalid_order_evidence') }
  const decimal = value => typeof value === 'string' && value.length <= 256 && /^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(value)
  const iso = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value
  const scope = evidence?.provenance?.parameters
  if (evidence?.status !== 'PROVISIONAL' || evidence.quality_state !== 'PROVISIONAL'
    || !/^[a-zA-Z0-9-]{1,100}$/.test(evidence.evidence_id ?? '')
    || scope?.source_id !== 'medusa-reference' || !iso(scope.from) || !iso(scope.to) || scope.from >= scope.to) fail()
  const groups = evidence.result?.groups, warnings = evidence.provenance.warnings
  if (!Array.isArray(groups) || !groups.length || groups.length > 200
    || !Array.isArray(warnings) || !warnings.length || warnings.length > 20
    || warnings.some(value => typeof value !== 'string' || !/^[A-Z0-9_]{1,120}$/.test(value))) fail()
  const seen = new Set()
  const lines = groups.map(group => {
    if (!/^[A-Z]{3}$/.test(group.currency_code ?? '') || seen.has(group.currency_code)) fail()
    seen.add(group.currency_code)
    const values = group.values
    if (!values || typeof values !== 'object' || Array.isArray(values)) fail()
    const gross = values['measure.gross_order_value@1.0.0']
    const count = values['measure.order_count@1.0.0']
    const aov = values['metric.average_order_value@1.0.0']
    if (!decimal(gross) || (count !== undefined && (typeof count !== 'string' || !/^[1-9][0-9]*$/.test(count)))
      || (aov !== undefined && !decimal(aov))) fail()
    return `- ${group.currency_code}: giá trị đơn hàng đã đặt ${displayAmount(gross)} ${group.currency_code}`
      + (count !== undefined ? `; số đơn ${count}` : '')
      + (aov !== undefined ? `; giá trị đơn trung bình (AOV) ${displayAmount(aov)} ${group.currency_code}` : '') + '.'
  })
  return ['Giá trị đơn hàng đã đặt (gross order value), không phải doanh thu đã thanh toán.', '', ...lines, '',
    `Nguồn: ${scope.source_id}.`, `Khoảng thời gian UTC: từ ${scope.from} đến trước ${scope.to}.`,
    'Dữ liệu tạm thời — chưa phải kết quả đã xác minh đầy đủ.',
    'Không cộng các loại tiền tệ; số đơn không đồng nghĩa số khách hàng duy nhất.',
    `Lưu ý: ${warnings.map(code => warningLabels[code] ?? `Cảnh báo chưa diễn giải: ${code}.`).join(' ')}`,
    `Chi tiết kỹ thuật: xem Bằng chứng [${evidence.evidence_id}].`].join('\n')
}
