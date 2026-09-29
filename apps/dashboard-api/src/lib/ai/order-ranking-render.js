export function renderOrderRanking(evidence){
  const p=evidence?.provenance?.parameters,orders=evidence?.result?.orders
  if(evidence?.status!=='PROVISIONAL'||!Array.isArray(orders)||!orders.length||orders.length>1000
    ||p?.source_id!=='medusa-reference'||typeof evidence.evidence_id!=='string')throw Error('invalid_ranking_evidence')
  const lines=orders.map(row=>{
    if(!/^[A-Z]{3}$/.test(row.currency_code)||typeof row.gross_order_value!=='string'||!/^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(row.gross_order_value)
      ||! /^[A-Za-z0-9._:-]{1,200}$/.test(row.order_id)||! /^[1-5]$/.test(String(row.position)))throw Error('invalid_ranking_evidence')
    return `- ${row.currency_code} · #${row.position}: ${row.order_id} — ${row.gross_order_value} ${row.currency_code}.`
  })
  return ['Tối đa 5 đơn hàng có giá trị đã đặt cao nhất trong từng loại tiền (không phải doanh thu đã thanh toán).',
    ...lines,`Nguồn: ${p.source_id}. UTC: ${p.from} → trước ${p.to}.`,
    'Dữ liệu tạm thời; chưa xác minh đầy đủ, độ mới và đối soát. Không so sánh các loại tiền với nhau. Cùng giá trị thì sắp theo mã đơn.',
    `Bằng chứng [${evidence.evidence_id}].`].join('\n\n')
}
