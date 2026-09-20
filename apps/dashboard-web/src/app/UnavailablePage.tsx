import { Info } from 'lucide-react'
import type { NavigationItem } from './navigation'

export function UnavailablePage({ item }: { item: NavigationItem }) {
  return <section className="mx-auto max-w-3xl space-y-6">
    <header><p className="text-xs font-semibold uppercase tracking-widest text-primary">Funnelmetry · Workspace V2</p>
      <h1 className="mt-3 text-2xl font-semibold">{item.label}</h1></header>
    <div className="rounded-xl border bg-card p-6 md:p-8">
      <Info aria-hidden="true" className="mb-4 text-primary" size={28} />
      <h2 className="text-lg font-semibold">Chưa khả dụng</h2>
      <p className="mt-3 text-sm leading-7 text-muted-foreground">{item.unavailable}</p>
      <p className="mt-4 border-t pt-4 text-xs leading-6 text-muted-foreground">Đây là vị trí chức năng theo Master v0.3.12, chưa phải chức năng đã triển khai. Không có yêu cầu phân tích, gọi model hay thay đổi dữ liệu nào được thực hiện khi mở trang này.</p>
    </div>
  </section>
}
