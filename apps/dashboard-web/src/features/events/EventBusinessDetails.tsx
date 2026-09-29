import type { CanonicalEventItem } from '../../lib/analytics-api'

export function EventBusinessDetails({ event }: { event: CanonicalEventItem }) {
  const details = event.business_details
  if (!details || !Object.keys(details).length) return <p className="mt-5 text-xs text-muted-foreground">Event này chưa có chi tiết sản phẩm/đơn hàng được cung cấp qua API.</p>
  const money = (value?: number) => value === undefined ? 'Chưa có' : `${value.toLocaleString('vi-VN')} minor${details.currency_code ? ` · ${details.currency_code}` : ' · chưa có loại tiền'}`
  const items = details.items ?? (details.product_id ? [details] : [])
  const majorMoney = (value: string) => `${value} ${details.currency_code ?? '(chưa có loại tiền)'}`
  return <section className="mt-6 space-y-4 rounded-lg border bg-muted/10 p-4">
    <h3 className="text-sm font-semibold">Chi tiết mua hàng</h3>
    <p className="text-xs text-muted-foreground">Giá, số lượng và ID lấy từ event đã chuẩn hóa. Tên (nếu có) là catalog tham chiếu gần nhất, không khẳng định tên tại thời điểm mua; độ mới catalog chưa được xác minh.</p>
    <dl className="grid grid-cols-[90px_minmax(0,1fr)] gap-2 text-xs">
      {details.order_id && <><dt>Đơn hàng</dt><dd className="break-all font-mono">{details.order_id}</dd></>}
      {details.cart_id && <><dt>Giỏ hàng</dt><dd className="break-all font-mono">{details.cart_id}</dd></>}
      {details.total_amount !== undefined && <><dt>Giá trị đơn đã đặt</dt><dd>{majorMoney(details.total_amount)}</dd></>}
      {details.total_minor !== undefined && <><dt>Tổng đơn</dt><dd>{money(details.total_minor)}</dd></>}
    </dl>
    {items.length > 0 && <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr>{['Sản phẩm / biến thể', 'Số lượng', 'Đơn giá'].map(label => <th key={label} className="border-b py-2 pr-3">{label}</th>)}</tr></thead><tbody>{items.map((item, index) => <tr key={index}>
      <td className="break-all border-b py-3 pr-3"><span className="block font-medium">{item.product_reference?.title ?? 'Tên: chưa có trong catalog'}</span><span className="font-mono">{item.product_id ?? 'Chưa có mã sản phẩm'}</span><span className="block text-muted-foreground">{item.variant_id ?? 'Chưa có mã biến thể'}</span>{item.product_reference && <details className="mt-1 text-muted-foreground"><summary>Tên tham chiếu từ catalog</summary><p>Đồng bộ (UTC): {item.product_reference.observed_at}</p><p>Nguồn: {item.product_reference.provider}</p><p>Snapshot: {item.product_reference.snapshot_id}</p></details>}</td>
      <td className="border-b pr-3">{item.quantity ?? 'Chưa có'}</td><td className="border-b">{'unit_price_amount' in item && item.unit_price_amount !== undefined ? majorMoney(item.unit_price_amount) : money(item.unit_price_minor)}</td>
    </tr>)}</tbody></table></div>}
    {details.items_truncated && <p className="text-xs text-amber-700">Chỉ hiển thị 50 dòng đầu của đơn hàng.</p>}
    <p className="text-xs leading-5 text-muted-foreground">{details.amount_unit === 'major' ? 'Giá trị giữ nguyên đơn vị tiền chính từ Medusa, không chia 100. Giá trị đơn đã đặt không đồng nghĩa doanh thu đã thanh toán.' : 'Dữ liệu legacy: giữ số gốc mang tên minor; chưa xác minh đơn vị nên không quy đổi hoặc dùng tính giá trị đơn.'}</p>
    {event.event_type === 'order.placed' && <p className="text-xs font-medium text-primary">Đã đặt đơn — chưa phải xác nhận thanh toán thành công.</p>}
    {event.event_type === 'order.created' && <p className="text-xs font-medium text-primary">Đã tạo đơn — chưa phải xác nhận thanh toán thành công.</p>}
  </section>
}
