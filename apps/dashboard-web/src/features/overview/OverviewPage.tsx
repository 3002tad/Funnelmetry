import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Activity, ArrowRight, CircleDollarSign, MousePointerClick, ShoppingBag, Users } from "lucide-react"
import { TrendChart, SourceDonut } from "../../components/charts/AnalyticsChart"
import { Badge } from "../../components/ui/badge"
import { Button } from "../../components/ui/button"
import { ChartCard } from "../../components/ui/chart-card"
import { MetricCard } from "../../components/ui/metric-card"
import { PageHeader } from "../../components/ui/page"
import { compact, money } from "../../lib/utils"
import { funnelStages, products } from "../../mock/data"

const loadOverview = () => new Promise<{ ready: boolean }>((resolve) => setTimeout(() => resolve({ ready: true }), 500))

export function OverviewPage() {
  const { isLoading } = useQuery({ queryKey: ["overview-preview"], queryFn: loadOverview })
  const [selected, setSelected] = useState("Revenue")
  if (isLoading) return <div className="space-y-5"><div className="skeleton h-16 w-80" /><div className="grid grid-cols-2 gap-3 xl:grid-cols-4">{[1,2,3,4].map((n) => <div key={n} className="skeleton h-32" />)}</div><div className="skeleton h-80" /></div>

  return <>
    <PageHeader title="Overview" description="A live view of customer intent, conversion and authoritative commerce outcomes." badge={<Badge tone="success" dot>Live</Badge>} actions={<Button variant="outline">Export report</Button>} />
    <div className="mb-6 flex items-center gap-1 rounded-lg border bg-card p-1 sm:w-fit">{["Revenue", "Conversion", "Sessions"].map((item) => <button key={item} onClick={() => setSelected(item)} className={`rounded-md px-3 py-1.5 text-xs transition ${selected === item ? "bg-muted font-medium text-foreground" : "text-muted-foreground"}`}>{item}</button>)}</div>
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      <MetricCard label="Revenue" value="$214.8k" change={12.8} icon={CircleDollarSign} data={[12,15,14,21,19,25,28,31]} />
      <MetricCard label="Accepted orders" value="1,482" change={8.4} icon={ShoppingBag} data={[11,12,16,14,17,19,18,23]} />
      <MetricCard label="Conversion rate" value="4.82%" change={1.7} icon={MousePointerClick} data={[9,10,9,12,13,12,15,16]} />
      <MetricCard label="Active sessions" value="3,291" change={6.2} icon={Users} data={[12,14,13,18,17,22,24,23]} />
    </div>
    <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(320px,.7fr)]">
      <ChartCard title={`${selected} trend`} detail="Compared with the previous 30-day period"><TrendChart /></ChartCard>
      <ChartCard title="Traffic source" detail="Sessions by first-touch source"><SourceDonut /></ChartCard>
    </div>
    <div className="mt-4 grid gap-4 xl:grid-cols-3">
      <ChartCard title="Product performance" detail="Top products by accepted revenue" className="xl:col-span-2">
        <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead className="text-muted-foreground"><tr className="border-b"><th className="pb-3 font-medium">Product</th><th className="pb-3 font-medium">Views</th><th className="pb-3 font-medium">Conversion</th><th className="pb-3 text-right font-medium">Revenue</th></tr></thead><tbody>{products.slice(0,4).map((p) => <tr key={p.id} className="border-b last:border-0"><td className="py-3"><strong className="block font-medium">{p.name}</strong><span className="text-[10px] text-muted-foreground">{p.category}</span></td><td>{compact.format(p.views)}</td><td>{p.conversion}%</td><td className="text-right font-medium">{money.format(p.revenue)}</td></tr>)}</tbody></table></div>
      </ChartCard>
      <ChartCard title="Funnel snapshot" detail="30-day session conversion">
        <div className="space-y-4">{funnelStages.map((stage, index) => <div key={stage.name}><div className="mb-1.5 flex justify-between text-xs"><span>{stage.name}</span><strong>{stage.reached}%</strong></div><div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${stage.reached}%`, opacity: 1 - index * .14 }} /></div></div>)}</div>
        <Button variant="ghost" className="mt-5 w-full justify-between">Open funnel analysis <ArrowRight size={15} /></Button>
      </ChartCard>
    </div>
    <div className="mt-4 panel flex flex-col gap-4 p-4 sm:flex-row sm:items-center"><div className="grid h-10 w-10 place-items-center rounded-lg bg-success/10 text-success"><Activity size={18} /></div><div className="flex-1"><div className="flex items-center gap-2"><strong className="text-sm">Data quality is healthy</strong><Badge tone="success">99.72% valid</Badge></div><p className="mt-1 text-xs text-muted-foreground">All sources are within latency budget. 28 events require reconciliation.</p></div><Button variant="outline" size="sm">View data health</Button></div>
  </>
}
