export type OrderEvidence = {
  evidence_id: string
  status: string
  quality_state?: string
  blocked_order_count?: string
  result: null | { groups: Array<{ currency_code: string; values: Record<string, string> }>; orders?: Array<{order_id:string;currency_code:string;gross_order_value:string;position:string}> }
  provenance?: { parameters?: { source_id: string; from: string; to: string }; warnings?: string[] }
  semantic_context?: { catalog_release?: string; tool_id?: string }
}

export function OrderRankingTable({item}:{item:OrderEvidence}){
  if(item.status!=='PROVISIONAL'||!item.result?.orders?.length)return null
  return <div className="overflow-x-auto"><table className="w-full text-left text-sm"><caption>Xếp hạng giá trị đơn đã đặt, riêng từng loại tiền · tối đa 5 đơn · không phải thanh toán</caption><thead><tr><th>Tiền tệ</th><th>Hạng</th><th>Đơn hàng</th><th>Giá trị</th></tr></thead><tbody>{item.result.orders.map(row=><tr key={`${row.currency_code}:${row.order_id}`}><td>{row.currency_code}</td><td>{row.position}</td><td>{row.order_id}</td><td>{row.gross_order_value}</td></tr>)}</tbody></table></div>
}
export function OrderEvidenceDetails({ item }: { item: OrderEvidence }) {
  const blocked = item.status === 'BLOCKED_BY_QUALITY'
  const scope = item.provenance?.parameters
  return <details className="rounded-lg border p-4">
    <summary className="cursor-pointer text-primary">Bằng chứng [{item.evidence_id}] · Phân tích đơn hàng</summary>
    <div className="mt-3 space-y-3 text-sm">
      <p>Trạng thái: {item.status} · Chất lượng: {item.quality_state ?? 'Chưa xác minh'}</p>
      {scope && <p>Nguồn: {scope.source_id}. Khoảng UTC: {scope.from} → trước {scope.to}</p>}
      {blocked ? <p role="alert">Kết quả bị chặn do chất lượng dữ liệu. Không công bố tổng tiền.{item.blocked_order_count ? ` Số đơn bị chặn: ${item.blocked_order_count}.` : ''}</p>
        : item.status === 'PROVISIONAL' && !!item.result?.groups.length && <div className="overflow-x-auto"><table className="w-full text-left">
          <caption className="pb-2 text-left">Giá trị đơn hàng đã đặt — không phải doanh thu đã thanh toán. Không cộng các loại tiền tệ.</caption>
          <thead><tr><th>Tiền tệ</th><th>Giá trị đơn đã đặt</th><th>Số đơn</th><th>AOV</th></tr></thead>
          <tbody>{item.result.groups.map((group, index) => <tr key={`${group.currency_code}-${index}`} className="border-t">
            <td>{group.currency_code}</td><td>{group.values['measure.gross_order_value@1.0.0'] ?? 'Chưa có'}</td>
            <td>{group.values['measure.order_count@1.0.0'] ?? 'Chưa có'}</td><td>{group.values['metric.average_order_value@1.0.0'] ?? 'Chưa có'}</td>
          </tr>)}</tbody>
        </table></div>}
      <OrderRankingTable item={item}/>
      <p>Công cụ: {item.semantic_context?.tool_id ?? 'Chưa có'} · Catalog: {item.semantic_context?.catalog_release ?? 'Chưa có'}</p>
      <ul className="list-disc pl-5">{item.provenance?.warnings?.map((warning, index) => <li key={index}>{warning}</li>)}</ul>
    </div>
  </details>
}
