export type EvidenceBarChart = {
  schema_version: 'evidence-bars-v1'
  kind: 'horizontal_bar'
  evidence_id: string
  title: string
  meaning: string
  truncated: boolean
  panels: Array<{ label: string; unit: string; items: Array<{ label: string; value: string }> }>
}

const decimal = /^(0|[1-9][0-9]*)(\.[0-9]+)?$/

function scaled(value: string, places: number): bigint {
  const [whole, fraction = ''] = value.split('.')
  return BigInt(whole + fraction.padEnd(places, '0'))
}

function panelWidths(items: EvidenceBarChart['panels'][number]['items']): number[] {
  const places = Math.max(...items.map(item => item.value.split('.')[1]?.length ?? 0))
  const values = items.map(item => scaled(item.value, places))
  const maximum = values.reduce((max, value) => value > max ? value : max, 0n)
  return values.map(value => maximum === 0n ? 0 : Number(value * 1000n / maximum) / 10)
}

export function EvidenceChart({ chart }: { chart: EvidenceBarChart }) {
  if (chart.schema_version !== 'evidence-bars-v1' || chart.kind !== 'horizontal_bar'
    || !Array.isArray(chart.panels) || !chart.panels.length || chart.panels.length > 8
    || chart.panels.some(panel => !Array.isArray(panel.items) || !panel.items.length || panel.items.length > 12
      || panel.items.some(item => typeof item.label !== 'string' || item.label.length > 200
        || typeof item.value !== 'string' || item.value.length > 256 || !decimal.test(item.value)))) return null
  return <figure className="rounded-2xl border bg-card p-4" aria-label={chart.title}>
    <figcaption className="font-semibold">{chart.title}</figcaption>
    <p className="mt-1 text-xs leading-5 text-muted-foreground">{chart.meaning}</p>
    <div className="mt-4 space-y-5">{chart.panels.map((panel, panelIndex) => {
      const widths = panelWidths(panel.items)
      return <section key={`${panel.label}-${panelIndex}`} aria-label={`${chart.title} · ${panel.label}`}>
        <h3 className="mb-2 text-xs font-medium text-muted-foreground">{panel.label}</h3>
        <ol className="space-y-2">{panel.items.map((item, index) => <li key={`${item.label}-${index}`} className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)_auto] items-center gap-3 text-xs">
          <span className="truncate" title={item.label}>{item.label}</span>
          <span className="h-3 overflow-hidden rounded-full bg-muted" aria-hidden="true"><span className="block h-full rounded-full bg-primary" style={{ width: `${widths[index]}%` }} /></span>
          <span className="tabular-nums">{item.value} {panel.unit}</span>
        </li>)}</ol>
      </section>
    })}</div>
    {chart.truncated && <p className="mt-3 text-xs text-muted-foreground">Biểu đồ chỉ hiển thị một phần kết quả; xem bảng bằng chứng để đối chiếu đầy đủ.</p>}
    <p className="mt-3 text-[11px] text-muted-foreground">Dữ liệu từ bằng chứng [{chart.evidence_id}]. Thanh chỉ thể hiện tỷ lệ trong từng nhóm, không tính lại số liệu.</p>
  </figure>
}
