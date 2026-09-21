import type { CanonicalEventItem } from '../../lib/analytics-api'

export function EventBusinessDetails({ event }: { event: CanonicalEventItem }) {
  const details = event.business_details
  if (!details || !Object.keys(details).length) return <p className="mt-5 text-xs text-muted-foreground">Event này chưa có chi tiết sản phẩm/đơn hàng được cung cấp qua API.</p>
  const money = (value?: number) => value === undefined ? 'Chưa có' : `${value.toLocaleString('vi-VN')} minor${details.currency_code ? ` · ${details.currency_code}` : ' · chưa có loại tiền'}`
  const items = details.items ?? (details.product_id ? [details] : [])
  return <section className="mt-6 space-y-4 rounded-lg border bg-muted/10 p-4">
    <h3 className="text-sm font-semibold">Chi tiết mua hàng</h3>
    <p className="text-xs text-muted-foreground">Nguồn: event đã chuẩn hóa · chỉ hiển thị trường đã nhận, không suy đoán giá hoặc tên sản phẩm.</p>
    <dl className="grid grid-cols-[90px_minmax(0,1fr)] gap-2 text-xs">
      {details.order_id && <><dt>Đơn hàng</dt><dd className="break-all font-mono">{details.order_id}</dd></>}
      {details.cart_id && <><dt>Giỏ hàng</dt><dd className="break-all font-mono">{details.cart_id}</dd></>}
      {details.total_minor !== undefined && <><dt>Tổng đơn</dt><dd>{money(details.total_minor)}</dd></>}
    </dl>
    {items.length > 0 && <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr>{['Sản phẩm / biến thể', 'Số lượng', 'Đơn giá'].map(label => <th key={label} className="border-b py-2 pr-3">{label}</th>)}</tr></thead><tbody>{items.map((item, index) => <tr key={index}>
      <td className="break-all border-b py-3 pr-3"><span className="font-mono">{item.product_id ?? 'Chưa có mã sản phẩm'}</span><span className="block text-muted-foreground">{item.variant_id ?? 'Chưa có mã biến thể'}</span><span className="block text-muted-foreground">Tên: chưa có nguồn catalog</span></td>
      <td className="border-b pr-3">{item.quantity ?? 'Chưa có'}</td><td className="border-b">{money(item.unit_price_minor)}</td>
    </tr>)}</tbody></table></div>}
    {details.items_truncated && <p className="text-xs text-amber-700">Chỉ hiển thị 50 dòng đầu của đơn hàng.</p>}
    <p className="text-xs leading-5 text-muted-foreground">Minor là đơn vị tiền nhỏ nhất theo contract nguồn, không phải số tiền đơn vị chính. UI giữ số gốc vì chưa có metadata quy đổi tiền tệ.</p>
    {event.event_type === 'order.created' && <p className="text-xs font-medium text-primary">Đã tạo đơn — chưa phải xác nhận thanh toán thành công.</p>}
  </section>
}
