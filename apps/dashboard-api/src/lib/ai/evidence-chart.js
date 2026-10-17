// Presentation only. The selected analytical tool remains the numeric authority.
const decimal = /^(0|[1-9][0-9]*)(\.[0-9]+)?$/
const currency = /^[A-Z]{3}$/

export function wantsEvidenceChart(question) {
  return typeof question === 'string'
    && /\b(chart|graph|plot)\b|biểu đồ|đồ thị|trực quan(?: hóa)?|ve bieu do/i.test(question)
}

function chart(evidence, title, meaning, panels, truncated = false) {
  if (!panels.length || typeof evidence?.evidence_id !== 'string') return null
  return { schema_version: 'evidence-bars-v1', kind: 'horizontal_bar', evidence_id: evidence.evidence_id,
    title, meaning, panels, truncated }
}

function rankingPanels(rows, idKey, valueKey) {
  if (!Array.isArray(rows) || !rows.length || rows.length > 1000) return null
  const groups = new Map()
  for (const row of rows) {
    if (!currency.test(row?.currency_code ?? '') || !/^[A-Za-z0-9._:-]{1,200}$/.test(row?.[idKey] ?? '')
      || typeof row?.[valueKey] !== 'string' || row[valueKey].length > 256 || !decimal.test(row[valueKey])
      || !Number.isInteger(Number(row.position)) || Number(row.position) < 1 || Number(row.position) > 5) return null
    if (!groups.has(row.currency_code)) groups.set(row.currency_code, [])
    groups.get(row.currency_code).push({ label: row[idKey], value: row[valueKey] })
  }
  const entries = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))
  return { panels: entries.slice(0, 8).map(([code, items]) => ({ label: code, unit: code, items: items.slice(0, 5) })),
    truncated: entries.length > 8 || entries.some(([, items]) => items.length > 5) }
}

export function buildEvidenceChart(tool, evidence) {
  if (tool === 'event_counts') {
    const counts = evidence?.data?.counts
    if (!Array.isArray(counts) || !counts.length || counts.length > 10000
      || counts.some(row => typeof row?.event_type !== 'string' || row.event_type.length > 128
        || !Number.isSafeInteger(row.count) || row.count < 0)) return null
    const sorted = [...counts].sort((a, b) => b.count - a.count || a.event_type.localeCompare(b.event_type))
    return chart(evidence, 'Số dòng event theo loại', 'Số dòng canonical đã lưu; không phải số khách hàng hay đơn hàng.',
      [{ label: 'Event', unit: 'dòng', items: sorted.slice(0, 12).map(row => ({ label: row.event_type, value: String(row.count) })) }],
      sorted.length > 12)
  }
  if (evidence?.status !== 'PROVISIONAL' || evidence?.quality_state && evidence.quality_state !== 'PROVISIONAL') return null
  if (tool === 'tool.order_ranking') {
    const result = rankingPanels(evidence.result?.orders, 'order_id', 'gross_order_value')
    return result && chart(evidence, 'Đơn hàng có giá trị đã đặt cao nhất',
      'Giá trị đơn đã đặt; không phải tiền đã thanh toán. Không so sánh các loại tiền.', result.panels, result.truncated)
  }
  if (tool === 'tool.product_value_ranking') {
    const result = rankingPanels(evidence.result?.products, 'product_id', 'ordered_product_unit_value')
    return result && chart(evidence, 'Sản phẩm theo giá trị hàng đã đặt',
      'Tổng đơn giá lúc đặt × số lượng; không phải doanh thu đã thanh toán. Không so sánh các loại tiền.',
      result.panels, result.truncated)
  }
  return null
}
