import { useState } from "react"
import { ArrowRight, Lightbulb, Sparkles, Target, TrendingUp } from "lucide-react"
import { Badge } from "../../components/ui/badge"
import { Button } from "../../components/ui/button"
import { PageHeader } from "../../components/ui/page"
import { insights } from "../../mock/data"

export function InsightsPage() {
  const [tab, setTab] = useState("All insights")
  return <>
    <PageHeader title="Insights" description="Evidence-backed opportunities generated from funnel, journey and quality signals." badge={<Badge tone="primary"><Sparkles size={12} /> Updated 8m ago</Badge>} actions={<Button>Generate report</Button>} />
    <div className="mb-5 flex items-center gap-1 rounded-lg border bg-card p-1 sm:w-fit">{["All insights","Conversion","Acquisition","Data quality"].map((item) => <button key={item} onClick={() => setTab(item)} className={`rounded-md px-3 py-1.5 text-xs ${tab === item ? "bg-muted font-medium" : "text-muted-foreground"}`}>{item}</button>)}</div>
    <div className="grid gap-4 lg:grid-cols-2">{insights.map((insight,index) => <article key={insight.title} className="panel panel-hover p-5"><div className="flex items-start justify-between gap-4"><div className={`grid h-10 w-10 place-items-center rounded-lg ${index < 2 ? "bg-primary/10 text-primary" : "bg-success/10 text-success"}`}>{index % 2 ? <TrendingUp size={18} /> : <Lightbulb size={18} />}</div><div className="flex gap-2"><Badge tone={insight.impact === "High" ? "warning" : "neutral"}>{insight.impact} impact</Badge><Badge tone="success">{insight.confidence}% confidence</Badge></div></div><h2 className="mt-5 text-base font-semibold">{insight.title}</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">{insight.text}</p><div className="mt-5 rounded-lg border bg-muted/25 p-3"><span className="text-[10px] uppercase tracking-wider text-muted-foreground">Affected segment</span><div className="mt-1 flex items-center gap-2 text-xs"><Target size={13} className="text-primary" />{insight.segment}</div></div><div className="mt-5 flex items-center justify-between"><span className="text-[10px] text-muted-foreground">Related: Order conversion funnel</span><Button variant="ghost" size="sm">{insight.cta} <ArrowRight size={13} /></Button></div></article>)}</div>
    <div className="mt-4 panel border-dashed p-8 text-center"><Sparkles size={22} className="mx-auto text-primary" /><h3 className="mt-3 text-sm font-medium">Insights stay grounded in measured evidence</h3><p className="mx-auto mt-2 max-w-xl text-xs leading-5 text-muted-foreground">Confidence, affected segment and related analysis remain visible so every recommendation can be reviewed before action.</p></div>
  </>
}
