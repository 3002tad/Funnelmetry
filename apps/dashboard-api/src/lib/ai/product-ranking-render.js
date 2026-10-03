export function renderProductRanking(evidence) {
  const rows=evidence?.result?.products, p=evidence?.provenance?.parameters
  if(evidence?.status!=='PROVISIONAL'||!Array.isArray(rows)||!rows.length||rows.length>1000
    ||p?.source_id!=='medusa-reference'||typeof evidence.evidence_id!=='string') throw Error('invalid_product_evidence')
  const lines=rows.map(r=>{
    if(!/^[A-Z]{3}$/.test(r.currency_code)||! /^[A-Za-z0-9._:-]{1,192}$/.test(r.product_id)
      ||typeof r.ordered_product_unit_value!=='string'||! /^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(r.ordered_product_unit_value)
      ||! /^[1-5]$/.test(r.position)) throw Error('invalid_product_evidence')
    return `- ${r.currency_code} · #${r.position}: ${r.product_id} — ${r.ordered_product_unit_value} ${r.currency_code}.`
  })
  return ['Xếp hạng sản phẩm theo tổng đơn giá lúc đặt × số lượng; không phải doanh thu đã thanh toán.',...lines,
    'Không phân bổ tổng đơn, thuế, phí vận chuyển hay giảm giá bổ sung. Chưa xác minh đơn giá nguồn đã bao gồm khoản nào. Không trừ hoàn/hủy; không cộng các loại tiền.',
    'Dữ liệu tạm thời; chưa xác minh đầy đủ, độ mới và đối soát.',
    `Nguồn: ${p.source_id}. UTC: ${p.from} → trước ${p.to}.`, `Bằng chứng [${evidence.evidence_id}].`].join('\n\n')
}
