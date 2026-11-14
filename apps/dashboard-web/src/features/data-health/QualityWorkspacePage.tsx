import { reconciliationMessage } from '../../lib/reconciliation-message';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useOutletContext } from 'react-router-dom';
import { RefreshCw, ShieldCheck } from 'lucide-react';
import type { ShellContext } from '../../app/AppShell';
import { useAuth } from '../../auth/AuthContext';
import { fetchExploration } from '../../lib/exploration-api';
import { fetchV2DataHealth, type DataHealthResponse } from '../../lib/analytics-api';
import { dateWindow } from '../../lib/date-range';
import { PageHeader } from '../../components/ui/page';
import { DatasetSelect } from '../../components/ui/dataset-select';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { DesignCard, DesignStats, number } from '../../components/ui/prototype';
export default function QualityWorkspacePage() {
    const { range, sourceId } = useOutletContext<ShellContext>(), { user } = useAuth(), [view, setView] = useState('observed'), [dataset, setDataset] = useState('observed');
    const window = useMemo(() => dateWindow(range), [range]);
    const demo = useQuery({ queryKey: ['demo-quality', user?.id, sourceId, dataset, window], queryFn: ({ signal }) => fetchExploration(sourceId, dataset, window, undefined, signal), enabled: view === 'demo' && dataset !== 'observed', retry: false, gcTime: 0 });
    const health = useQuery({ queryKey: ['v2-data-health', sourceId, range], queryFn: ({ signal }) => fetchV2DataHealth(range, signal), enabled: view === 'observed', retry: false });
    const data = demo.isError ? undefined : demo.data, observed = health.isError ? undefined : health.data;
    const syntheticPoints = new Map<string, {
        date: string;
        total: number;
        other: number;
    }>();
    for (const row of data?.daily ?? []) {
        const date = (data?.daily.length ?? 0) > 31 ? row.date.slice(0, 7) : row.date;
        const point = syntheticPoints.get(date) ?? { date, total: 0, other: 0 };
        point.total += Number(row.total);
        syntheticPoints.set(date, point);
    }
    const points = view === 'observed' ? (observed?.hourly ?? []).map(r => ({ date: r.bucket_start, total: r.canonical_events, other: r.non_authoritative_time })) : [...syntheticPoints.values()];
    const max = Math.max(1, ...points.flatMap(p => [p.total, p.other])), x = (i: number) => 50 + (points.length === 1 ? 375 : i * 750 / Math.max(1, points.length - 1)), y = (v: number) => 210 - v / max * 170;
    return <div className="tpl-page quality-page"><PageHeader title="Chất lượng dữ liệu" description="Theo dõi chất lượng xử lý và đối soát dữ liệu." actions={<Button variant="outline" onClick={() => void (view === 'observed' ? health.refetch() : demo.refetch())}><RefreshCw size={14}/>Làm mới</Button>}/>
 <nav className="tpl-tabs tpl-module-tabs"><Button variant="ghost" className={view === "demo" ? "tpl-selected" : ""} onClick={() => setView('demo')}>Dữ liệu minh họa</Button><Button variant="ghost" className={view === "observed" ? "tpl-selected" : ""} onClick={() => setView('observed')}>Dữ liệu thực tế</Button></nav>
 {view === 'demo' && <div className="tpl-dataset-toolbar"><DatasetSelect sourceId={sourceId} value={dataset} onChange={setDataset}/></div>}
 {(view === 'observed' ? health.isError : demo.isError) && <p role="alert">Không tải được chất lượng dữ liệu. Hãy thử lại.</p>}
 {view === 'demo' && dataset === 'observed' && <div className="tpl-card tpl-empty">Chọn bộ dữ liệu minh họa để xem.</div>}
 {view === 'demo' && data && <><section className="tpl-card tpl-health-notice"><ShieldCheck size={25}/><h2>Dùng để thử phân tích; chưa xác minh coverage</h2></section><DesignStats items={[{ label: 'Nguồn gốc', value: 'Synthetic', detail: 'SYNTHETIC_BACKFILL' }, { label: 'Phạm vi', value: data.daily.length + ' ngày', detail: 'Ngày có bản ghi · UTC' }, { label: 'Domain có coverage record', value: data.coverage.length, detail: 'Có khai báo không có nghĩa đã đối soát' }, { label: 'Domain UNVERIFIED', value: data.coverage.filter(r => r.status === 'UNVERIFIED').length, detail: 'Chưa được xác minh' }]}/>
 <DesignCard title="Dữ liệu nào dùng được đến đâu?"><table><thead><tr><th>Dữ liệu</th><th>Có thể dùng</th><th>Giới hạn</th></tr></thead><tbody>{[['Browser / session', 'Đếm, xu hướng, so sánh kỳ, tìm kiếm', 'Synthetic; không chứng nhận observed coverage'], ['Catalog / giá', 'Tra cứu variant, lịch sử giá theo rule', 'Cùng dataset / currency / channel / region'], ['Cart / order', 'Phân bố và thay đổi trong fixture', 'Không suy conversion từ tỷ lệ tổng độc lập'], ['Payment / fulfillment', 'Khám phá dữ liệu synthetic', 'Không phải tiền thu thực tế hoặc SLA thực tế']].map(r => <tr key={r[0]}>{r.map(c => <td key={c}>{c}</td>)}</tr>)}</tbody></table></DesignCard>
 <DesignCard title="Coverage theo domain" action={<Badge tone="warning">UNVERIFIED</Badge>}><table><thead><tr><th>Domain</th><th>Trạng thái</th><th>Từ UTC</th><th>Đến UTC</th></tr></thead><tbody>{data.coverage.map((c, i) => <tr key={i}><td>{c.domain}</td><td><Badge tone="warning">{c.status}</Badge></td><td>{c.interval_start}</td><td>{c.interval_end}</td></tr>)}</tbody></table></DesignCard></>}
 {view === 'observed' && observed && <><ObservedSummary data={observed}/>{reconciliationMessage(observed.reconciliation.quality_gate.reasons) && <p role="status" className="tpl-semantic-footnote">{reconciliationMessage(observed.reconciliation.quality_gate.reasons)}</p>}</>}
 {!!points.length && <DesignCard title={view === 'observed' ? 'Canonical persistence theo giờ' : 'Khối lượng event trong dataset'} className="tpl-health-chart-panel"><div className="tpl-health-plot"><svg viewBox="0 0 850 260" role="img" aria-label="Khối lượng dữ liệu theo thời gian">{[0, .5, 1].map(r => <g key={r}><line x1="50" x2="800" y1={y(r * max)} y2={y(r * max)} stroke="currentColor" className="text-border"/><text x="40" y={y(r * max) + 4} textAnchor="end">{number(Math.round(r * max))}</text></g>)}<polyline points={points.map((p, i) => `${x(i)},${y(p.total)}`).join(' ')} fill="none" stroke="currentColor" className="text-primary" strokeWidth="2.5"/>{view === 'observed' && <polyline points={points.map((p, i) => `${x(i)},${y(p.other)}`).join(' ')} fill="none" stroke="#c99535" strokeWidth="2"/>}{points.map((p, i) => <circle key={p.date} cx={x(i)} cy={y(p.total)} r="3" fill="currentColor" className="text-primary"><title>{p.date}: {p.total}</title></circle>)}{points.filter((_, i) => i % Math.max(1, Math.ceil(points.length / 6)) === 0 || i === points.length - 1).map(p => <text key={p.date} x={x(points.indexOf(p))} y="240" textAnchor="middle">{p.date.slice(0, 10)}</text>)}</svg><div className="tpl-chart-legend"><span><i /> {view === 'observed' ? 'Canonical persisted' : 'Browser events'}</span>{view === 'observed' && <span><i className="tpl-warning"/>Non-authoritative time</span>}</div></div></DesignCard>}
 {view === 'observed' && observed && <ObservedDetails data={observed}/>}
 </div>;
}
function ObservedSummary({ data }: {
    data: DataHealthResponse;
}) { const c = data.canonicalization, l = data.canonical, r = data.reconciliation; return <><section className="tpl-card tpl-health-notice"><ShieldCheck size={25}/><h2>{r.quality_gate.eligible_for_authoritative_business_analysis ? 'Đã có bằng chứng đối soát' : 'Có dữ liệu cần kiểm tra; chưa đủ bằng chứng đối soát'}</h2></section><DesignStats items={[{ label: 'Sự kiện đã tiếp nhận', value: number(c.accepted_events), detail: 'Sự kiện đã lưu' }, { label: 'Canonical đã lưu', value: number(l.events), detail: 'Sự kiện đã chuẩn hóa' }, { label: 'Unsupported / Quarantine', value: `${c.unsupported} / ${c.quarantined}`, detail: 'Kết quả xử lý gần nhất' }, { label: 'Reconciliation gate', value: r.quality_gate.state, detail: 'Trạng thái đối soát' }]}/><div className="tpl-grid tpl-equal"><DesignCard title="Chất lượng xử lý"><table><thead><tr><th>Chỉ tiêu</th><th>Kết quả</th></tr></thead><tbody>{[['Normalized', number(c.normalized)], ['Unsupported', number(c.unsupported)], ['Quarantined', number(c.quarantined)], ['Authoritative event time', l.authoritative_event_time_rate == null ? 'Chưa đo' : (l.authoritative_event_time_rate * 100).toFixed(1) + '%']].map(r => <tr key={r[0]}><td>{r[0]}</td><td>{r[1]}</td></tr>)}</tbody></table></DesignCard><DesignCard title="Đối soát & Funnel"><table><thead><tr><th>Chỉ tiêu</th><th>Kết quả</th></tr></thead><tbody>{[['Snapshot / comparison', `${r.snapshots} / ${r.comparisons}`], ['Funnel instances', number(data.projection_quality.funnel_instances)], ['Provisional', number(data.projection_quality.provisional)], ['Reconciled / Degraded', `${data.projection_quality.reconciled} / ${data.projection_quality.degraded}`]].map(r => <tr key={r[0]}><td>{r[0]}</td><td>{r[1]}</td></tr>)}</tbody></table></DesignCard></div></>; }
function ObservedDetails({ data }: {
    data: DataHealthResponse;
}) { return <details className="tpl-card tpl-technical-details"><summary>Chi tiết kỹ thuật xử lý & các chỉ tiêu chưa đo được</summary><div className="tpl-card-body"><p className="tpl-semantic-footnote">Ingress: received_at · Canonical: persisted_at · Funnel: entry_at · Reconciliation: coverage_end_at. Không lấy hiệu các tổng khác time basis để suy thất thoát.</p><table><thead><tr><th>Thông số</th><th>Giá trị</th></tr></thead><tbody>{[['Terminal outcomes', data.canonicalization.terminal_outcomes], ['Canonicalization p95', data.canonicalization.canonicalization_latency_p95_ms], ['Canonical persistence p95', data.canonical.canonical_persistence_latency_p95_ms], ['Verified repairs', data.reconciliation.verified_repairs], ['Repair success rate', data.reconciliation.repair_success_rate]].map(([label, value]) => <tr key={String(label)}><td>{label}</td><td>{value ?? 'Chưa đo'}</td></tr>)}</tbody></table><div className="tpl-unavailable-badges">{data.unavailable_metrics.map(v => <Badge key={v}>{v}</Badge>)}</div></div></details>; }
