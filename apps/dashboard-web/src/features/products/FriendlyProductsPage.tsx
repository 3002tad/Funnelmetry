import { useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import { CircleOff, Eye, RefreshCw, ShoppingBag } from "lucide-react"
import { useOutletContext } from "react-router-dom"
import type { ShellContext } from "../../app/AppShell"
import { useAuth } from "../../auth/AuthContext"
import { Button } from "../../components/ui/button"
import { EmptyState, PageHeader } from "../../components/ui/page"
import { ProgressiveDetails } from "../../components/ui/progressive-details"
import { apiRequest } from "../../lib/api"
import ProductObservationsPage from "./ProductObservationsPage"

type Product = { product_id: string; views: string; adds: string; reference?: { title: string } | null }
type ProductResponse = { items: Product[] }

export default function FriendlyProductsPage() {
  const { range, sourceId } = useOutletContext<ShellContext>()
  const { user } = useAuth()
  const window = useMemo(() => {
    const to = new Date()
    const days = range === "Last 7 days" ? 7 : range === "Last 90 days" ? 90 : 30
    return { from: new Date(to.getTime() - days * 86400000).toISOString(), to: to.toISOString() }
  }, [range])
  const products = useQuery({ queryKey: ["products-friendly", user?.id, sourceId, window], queryFn: ({ signal }) => {
    const params = new URLSearchParams({ source_id: sourceId, ...window, sort: "views", offset: "0" })
    return apiRequest<ProductResponse>(`/api/v2/products?${params}`, { signal })
  }, retry: false })

  return <>
    <PageHeader title="Sản phẩm" description="Xem sản phẩm nào được ghi nhận nhiều lượt xem và thêm vào giỏ." actions={<Button variant="outline" disabled={products.isFetching} onClick={() => void products.refetch()}><RefreshCw size={14} className={products.isFetching ? "animate-spin" : ""} /> Làm mới</Button>} />
    <section className="panel relative mb-5 overflow-hidden p-6 sm:p-7"><div className="absolute -right-16 -top-20 h-60 w-60 rounded-full bg-emerald-200/25 blur-3xl dark:bg-emerald-500/10" aria-hidden="true" /><div className="relative flex items-start gap-4"><span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-emerald-500/10 text-emerald-600"><ShoppingBag size={23} /></span><div><h2 className="text-lg font-bold">Khám phá sự quan tâm tới sản phẩm</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">Các số ở đây đếm event, không phải số người mua, số lượng hàng hay doanh thu. Tên sản phẩm, nếu có, là dữ liệu catalog tham chiếu gần nhất.</p></div></div></section>
    {products.isLoading && <div className="skeleton h-80" />}
    {products.isError && <EmptyState icon={<CircleOff size={20} />} title="Chưa tải được sản phẩm" detail="Kiểm tra kết nối và nguồn dữ liệu, rồi thử lại." />}
    {products.data && (products.data.items.length ? <section aria-label="Sản phẩm nổi bật"><h2 className="mb-4 text-base font-bold">Được xem nhiều trong khoảng đã chọn</h2><div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{products.data.items.slice(0, 9).map((product, index) => <article key={product.product_id} className="panel group p-5 transition hover:-translate-y-0.5 hover:border-primary/35 hover:shadow-md"><div className="flex items-start justify-between gap-3"><span className="grid h-11 w-11 place-items-center rounded-2xl bg-sky-500/10 text-sky-600"><ShoppingBag size={21} /></span><span className="text-xs font-bold text-muted-foreground">#{index + 1}</span></div><h3 className="mt-4 line-clamp-2 min-h-10 text-sm font-semibold">{product.reference?.title ?? "Chưa có tên từ catalog"}</h3><p className="mt-1 truncate font-mono text-[11px] text-muted-foreground" title={product.product_id}>{product.product_id}</p><div className="mt-5 flex flex-wrap gap-2"><span className="inline-flex items-center gap-1.5 rounded-full bg-sky-500/10 px-3 py-1.5 text-xs font-semibold text-sky-700 dark:text-sky-300"><Eye size={14} /> {product.views} lượt xem</span><span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300"><ShoppingBag size={14} /> {product.adds} lượt thêm giỏ</span></div></article>)}</div></section> : <EmptyState icon={<CircleOff size={20} />} title="Chưa có sản phẩm phù hợp" detail="Thử đổi khoảng thời gian hoặc kiểm tra nguồn event." />)}
    <ProgressiveDetails label="Xem so sánh kỳ trước, bộ lọc và mã kỹ thuật"><ProductObservationsPage /></ProgressiveDetails>
    <p className="mt-4 text-xs text-muted-foreground">Nguồn: {sourceId} · Khoảng xem: {range}. Không suy ra tỷ lệ chuyển đổi hay doanh thu từ các số đếm này.</p>
  </>
}
