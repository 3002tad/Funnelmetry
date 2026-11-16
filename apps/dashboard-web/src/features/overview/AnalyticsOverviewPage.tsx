import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useOutletContext } from 'react-router-dom';
import { CalendarDays, ChartNoAxesCombined, Download, RefreshCw } from 'lucide-react';
import type { ShellContext } from '../../app/AppShell';
import { useAuth } from '../../auth/AuthContext';
import { Button } from '../../components/ui/button';

import { PageHeader } from '../../components/ui/page';
import { number } from '../../components/ui/prototype';
import { fetchExploration, type Exploration } from '../../lib/exploration-api';
import { dateWindow } from '../../lib/date-range';
import { InsightDashboard } from './InsightDashboard';
type Metric = 'views' | 'searches' | 'cart';
function exportCsv(data: Exploration) { const blob = new Blob(['date,total,views,searches,cart\n' + data.daily.map(r => [r.date, r.total, r.views, r.searches, r.cart].join(',')).join('\n')], { type: 'text/csv;charset=utf-8' }); const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = 'funnelmetry-activity.csv'; a.click(); URL.revokeObjectURL(url); }
export function AnalyticsOverviewPage() {
    const { range, sourceId, dataset } = useOutletContext<ShellContext>(), { user } = useAuth();
    const [selected, setSelected] = useState<string | null>(null);
    const [comparing,setComparing] = useState(false);
    useEffect(() => setSelected(null), [dataset]);
    const window = useMemo(() => dateWindow(range), [range]);
    const query = useQuery({ queryKey: ['exploration', user?.id, sourceId, dataset, window], queryFn: ({ signal }) => fetchExploration(sourceId, dataset, window, undefined, signal), retry: false, gcTime: 0 });
    const data = query.isError ? undefined : query.data;
    const totals = (data?.daily ?? []).filter(r => !selected || r.date.startsWith(selected)).reduce((n, r) => ({ total: n.total + Number(r.total), views: n.views + Number(r.views), searches: n.searches + Number(r.searches), cart: n.cart + Number(r.cart) }), { total: 0, views: 0, searches: 0, cart: 0 });
    const items = selected ? [
        { label: 'Sự kiện trình duyệt', value: number(totals.total), detail: `${selected} · ${data?.quality ?? 'UNVERIFIED'}` },
        { label: 'Lượt xem sản phẩm', value: number(totals.views), detail: `${selected} · Số lượt sự kiện` },
        { label: 'Lượt tìm kiếm', value: number(totals.searches), detail: `${selected} · Số lượt sự kiện` },
        { label: 'Lượng thêm vào giỏ', value: number(totals.cart), detail: `${selected} · Số lượng tăng` },
    ] : [
        { label: dataset === 'observed' ? 'Sự kiện đã chuẩn hóa' : 'Sự kiện trình duyệt', value: number(totals.total), detail: 'Số lượt sự kiện' },
        { label: 'Phiên truy cập', value: number(data?.counts?.sessions), detail: 'Không phải số khách hàng' },
        { label: 'Lượt tìm kiếm', value: number(totals.searches), detail: 'Số lượt tìm kiếm' },
        { label: 'Đơn hàng', value: number(data?.counts?.orders), detail: 'Không phải doanh thu' },
    ];
    return <div className="tpl-page overview-page overview-redesign">
      <PageHeader title="Tổng quan" description="Hoạt động và mức quan tâm trong khoảng thời gian đã chọn." actions={<><Button variant="outline" disabled={query.isFetching} onClick={()=>void query.refetch()} aria-label="Làm mới"><RefreshCw size={15}/></Button><Button variant="outline" aria-expanded={comparing} onClick={()=>setComparing(!comparing)}>So sánh kỳ</Button><Button disabled={!data} onClick={()=>data&&exportCsv(data)}><Download size={14}/>Xuất dữ liệu</Button></>}/>
      {query.isError&&<p role="alert">Không tải được dữ liệu. Hãy thử lại.</p>}
      {query.isPending&&<div className="skeleton h-64"/>}
      {comparing&&<section className="overview-comparison"><div className="overview-section-label"><h2>So sánh theo thời gian</h2><Button variant="ghost" onClick={()=>setComparing(false)}>Đóng so sánh</Button></div><PeriodComparison key={dataset} sourceId={sourceId} dataset={dataset} anchor={data?.daily[data.daily.length - 1]?.date}/></section>}
      {data&&<InsightDashboard data={data} items={items} selected={selected} onSelect={setSelected}/>}   </div>;
}

function period(date: string, unit: string) { const start = new Date(date + 'T00:00:00Z'); if (unit === 'week')
    start.setUTCDate(start.getUTCDate() - (start.getUTCDay() + 6) % 7); if (unit === 'month')
    start.setUTCDate(1); const end = new Date(start); if (unit === 'month')
    end.setUTCMonth(end.getUTCMonth() + 1);
else
    end.setUTCDate(end.getUTCDate() + (unit === 'week' ? 7 : 1)); return { from: start.toISOString(), to: end.toISOString() }; }
function PeriodComparison({ sourceId, dataset, anchor }: {
    sourceId: string;
    dataset: string;
    anchor?: string;
}) {
    const [unit, setUnit] = useState('month'), [a, setA] = useState(new Date().toISOString().slice(0, 10)), [b, setB] = useState(new Date(Date.now() - 31 * 86400000).toISOString().slice(0, 10)), [metric, setMetric] = useState<Metric>('views'), [partial, setPartial] = useState(false), [request, setRequest] = useState<{
        unit: string;
        a: string;
        b: string;
        partial: boolean;
    } | null>(null);
    const { user } = useAuth();
    useEffect(() => { if (!anchor)
        return; const previous = new Date(anchor + 'T00:00:00Z'); previous.setUTCDate(0); const earlier = previous.toISOString().slice(0, 10); setA(anchor); setB(earlier); setRequest({ unit: 'month', a: anchor, b: earlier, partial: false }); }, [anchor]);
    const result = useQuery({ queryKey: ['period-comparison', user?.id, sourceId, dataset, request], enabled: !!request, queryFn: async ({ signal }) => {
            const r = request!, windows = [period(r.a, r.unit), period(r.b, r.unit)], today = new Date();
            today.setUTCHours(0, 0, 0, 0);
            if (r.partial) {
                const active = windows.find(w => Date.parse(w.from) <= today.getTime() && Date.parse(w.to) > today.getTime());
                if (active) {
                    const elapsed = today.getTime() - Date.parse(active.from);
                    for (const w of windows)
                        w.to = new Date(Math.min(Date.parse(w.to), Date.parse(w.from) + elapsed)).toISOString();
                    if (windows.some(w => w.from === w.to))
                        throw Error('Chưa có ngày hoàn tất trong kỳ đang diễn ra.');
                }
            }
            return Promise.all(windows.map(w => fetchExploration(sourceId, dataset, w, undefined, signal)));
        }, retry: false, gcTime: 0 });
    const sums = result.data?.map(d => d.daily.reduce((n, r) => n + Number(r[metric]), 0)), delta = sums ? sums[0] - sums[1] : 0, change = sums && sums[1] !== 0 ? delta / sums[1] * 100 : null;
    return <section className="tpl-card tpl-compare-panel">
    <div className="tpl-card-head"><div className="tpl-row"><span className="tpl-section-icon"><CalendarDays size={17}/></span><div><h2>So sánh hai kỳ</h2><p>So sánh thay đổi theo thời gian</p></div></div></div>
    <form className="tpl-compare-controls" onSubmit={e => { e.preventDefault(); setRequest({ unit, a, b, partial }); }}>
      <label>Chỉ tiêu<select value={metric} onChange={e => setMetric(e.target.value as Metric)}><option value="views">Lượt xem sản phẩm</option><option value="searches">Lượt tìm kiếm</option><option value="cart">Event thêm giỏ</option></select></label>
      <label>Đơn vị kỳ<select value={unit} onChange={e => { setUnit(e.target.value); setRequest(null); }}><option value="day">Ngày</option><option value="week">Tuần</option><option value="month">Tháng</option></select></label>
      <label>Mốc thuộc kỳ A<input required type="date" value={a} onChange={e => { setA(e.target.value); setRequest(null); }}/></label><label>Mốc thuộc kỳ B<input required type="date" value={b} onChange={e => { setB(e.target.value); setRequest(null); }}/></label><Button disabled={result.isFetching}><ChartNoAxesCombined size={14}/>So sánh</Button>
    </form><div className="tpl-compare-options"><label><input type="checkbox" checked={partial} onChange={e => { setPartial(e.target.checked); setRequest(null); }}/>Với kỳ đang diễn ra, so cùng số ngày đã hoàn tất</label></div>
    {result.isError && <p role="alert">{result.error.message || 'Không tính được hai kỳ. Hãy thử lại.'}</p>}
    {request && result.data && sums && <div className="tpl-compare-result"><div className="tpl-compare-result-heading">{metric === 'views' ? 'Lượt xem sản phẩm' : metric === 'searches' ? 'Lượt tìm kiếm' : 'Event thêm giỏ'}</div><div className="tpl-compare-result-grid">{result.data.map((d, i) => <div className="tpl-comparison-total" key={i}><small>KỲ {i ? 'B' : 'A'} · {d.window.from.slice(0, 10)} → trước {d.window.to.slice(0, 10)}</small><strong>{number(sums[i])}</strong><small>{(Date.parse(d.window.to) - Date.parse(d.window.from)) / 86400000} ngày · UNVERIFIED</small></div>)}<div className="tpl-comparison-total tpl-delta"><small>THAY ĐỔI A SO VỚI B</small><strong>{change == null ? 'Chưa tính %' : `${change > 0 ? '+' : ''}${change.toFixed(1)}%`}</strong><small>Chênh lệch: {delta > 0 ? '+' : ''}{number(delta)} event</small></div></div><div className="tpl-compare-bars">{sums.map((value, i) => <div className="tpl-compare-bar-row" key={i}><span>Kỳ {i ? 'B' : 'A'}</span><div><i style={{ width: `${value / Math.max(1, ...sums) * 100}%`, opacity: i ? .5 : 1 }}/></div><strong>{number(value)}</strong></div>)}</div><p className="tpl-semantic-footnote">Các kỳ có thể có độ dài khác nhau.</p></div>}
  </section>;
}
