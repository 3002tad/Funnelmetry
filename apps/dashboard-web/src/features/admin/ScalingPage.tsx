import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../auth/AuthContext';
import { apiRequest } from '../../lib/api';
import { PageHeader } from '../../components/ui/page';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { DesignCard, DesignStats } from '../../components/ui/prototype';
import { DesignDialog } from '../../components/ui/design-dialog';

type Decision = { at: string; kind: string; reason: string; result: string; action: string; previous_replicas: number | null; desired_replicas: number | null; consumable_lag: string | null; raw_offset_lag: string | null; memory_percent: number | null };
type Policy = { scope: string; min_replicas: number; max_replicas: number; up_lag: string; down_lag: string; up_memory_percent: number | null; down_memory_percent: number | null; up_window_ms: number; down_window_ms: number; cooldown_ms: number; cpu_headroom_nano: number; memory_headroom_bytes: number };
type Controller = { status: string; mode?: string; stale?: boolean; last_observed_at?: string; recovery_status?: string; policy: Policy | null; last_decision?: Decision; history: Decision[]; series: Decision[] };
type TelemetryPoint = { observed_at: string; running_replicas: number | null; consumable_lag: string | null; memory_percent_max: number | null };
type TelemetryHistory = { items: TelemetryPoint[]; bucket_seconds: number; from: string; to: string };
type Scaling = {
 checked_at: string;
 runtime: { status: string; reason: string | null; desired_replicas: number | null; running_replicas: number | null; memory_percent_max: number | null };
 kafka: { raw_offset_lag: string | null; partition_count: number | null; consumable_lag: string | null; consumable_observed_at?: string | null };
 readiness: { status: string; ready: boolean | null };
 controller: Controller;
};
const show = (value: string | number | null | undefined) => value == null ? 'Chưa có dữ liệu' : String(value);
const time = (value: string) => new Date(value).toLocaleString();
const reasons: Record<string, string> = {
 REPLICA_SAFETY_UNVERIFIED: 'Chưa đủ bằng chứng an toàn replica/replay cho image đang chạy.',
 LIVE_AND_READY: 'Worker đang sống và sẵn sàng xử lý.',
 UNKNOWN_WORKLOAD_OR_CAPACITY: 'Chưa xác minh đầy đủ workload hoặc capacity.',
};
function ObservationChart({ series, field, title, bucketSeconds }: { series: TelemetryPoint[]; field: 'running_replicas' | 'consumable_lag' | 'memory_percent_max'; title: string; bucketSeconds: number }) {
 const valid = (row: TelemetryPoint) => row[field] != null && (field === 'memory_percent_max' ? Number.isFinite(Number(row[field])) : Number.isSafeInteger(Number(row[field])));
 const points = series.filter(valid);
 if (!points.length) return <p>Chưa có mẫu đo hợp lệ cho {title}.</p>;
 const start = Date.parse(series[0].observed_at), duration = Math.max(1, Date.parse(series[series.length-1].observed_at)-start);
 const maximum = Math.max(1, ...points.map(row => Number(row[field])));
 const x = (row: TelemetryPoint) => 45 + (Date.parse(row.observed_at)-start)/duration*410;
 const y = (row: TelemetryPoint) => 135-Number(row[field])/maximum*100;
 const segments: TelemetryPoint[][] = [];
 let current: TelemetryPoint[] = [];
 for (const row of series) {
   if (!valid(row)) { if(current.length) segments.push(current); current=[]; continue; }
   if (current.length && Date.parse(row.observed_at)-Date.parse(current[current.length-1].observed_at) > (bucketSeconds*2+30)*1000) { segments.push(current); current=[]; }
   current.push(row);
 }
 if(current.length) segments.push(current);
 return <div><h3>{title}</h3><svg viewBox="0 0 500 175" role="img" aria-label={title + ': ' + points.length + ' mẫu telemetry thực tế'} style={{width:'100%',color:'var(--tpl-accent, #4263eb)'}}>
 <path d="M45 25 V135 H460" fill="none" stroke="currentColor" opacity=".25" />
 <text x="8" y="38" fontSize="12" fill="currentColor">{maximum}</text><text x="20" y="138" fontSize="12" fill="currentColor">0</text>
 {segments.map((rows,i)=><polyline key={i} points={rows.map(row=>x(row)+','+y(row)).join(' ')} fill="none" stroke="currentColor" strokeWidth="2.5" />)}
 {points.map(row=><circle key={row.observed_at} cx={x(row)} cy={y(row)} r="4" fill="currentColor"><title>{time(row.observed_at)} · {row[field]}</title></circle>)}
 <text x="45" y="162" fontSize="11" fill="currentColor">{new Date(series[0].observed_at).toLocaleTimeString()}</text><text x="455" y="162" textAnchor="end" fontSize="11" fill="currentColor">{new Date(series[series.length-1].observed_at).toLocaleTimeString()}</text>
 </svg></div>;
}
export default function ScalingPage() {
 const { user } = useAuth();
 const [hours, setHours] = useState('24');
 const [tab, setTab] = useState('services'), [policyOpen, setPolicyOpen] = useState(false);
 const query = useQuery({ queryKey: ['admin-scaling', user?.id], queryFn: ({ signal }) => apiRequest<Scaling>('/api/v2/admin/scaling', { signal }), retry: false, gcTime: 0 });
 const historyQuery = useQuery({ queryKey: ['admin-scaling-history', user?.id, hours], queryFn: ({ signal }) => apiRequest<TelemetryHistory>('/api/v2/admin/scaling/history?hours=' + hours, { signal }), retry: false, gcTime: 0 });
 const history = historyQuery.isError ? undefined : historyQuery.data;
 const refreshing = query.isFetching || historyQuery.isFetching;
 const data = query.isError ? undefined : query.data, runtime = data?.runtime, controller = data?.controller;
 const policy = controller?.policy, last = controller?.last_decision;
 const missingPolicy = query.isError ? 'Chưa xác minh policy' : query.isPending ? 'Đang tải…' : 'Chưa cấu hình policy';
 const replica = runtime?.desired_replicas == null ? 'Chưa có dữ liệu' : `${runtime.running_replicas} / ${runtime.desired_replicas}`;
 return <div className="tpl-page"><PageHeader title="Auto Scaling" description="Quan sát tài nguyên và trạng thái canonical-normalizer." />
 <div className="tpl-admin-scope"><Badge>Toàn bộ nguồn · chỉ đọc</Badge><Button variant="outline" disabled={refreshing} onClick={() => { void query.refetch(); void historyQuery.refetch(); }}>{refreshing ? 'Đang tải…' : 'Làm mới'}</Button></div>
 {query.isError && <p role="alert">Không tải được dữ liệu Auto Scaling. Hãy thử lại.</p>}
 <section className="tpl-card tpl-admin-hero"><div><h2>Auto Scaling · canonical-normalizer</h2><p>{data ? `Kiểm tra API lúc ${time(data.checked_at)}` : 'Đang chờ API'}</p></div><Badge>{runtime?.status === 'OBSERVED' ? 'Đã đo runtime' : 'Runtime chưa có dữ liệu'}</Badge></section>
 <DesignStats items={[
 { label: 'Replica đang chạy / mong muốn', value: replica, detail: 'Trạng thái hiện tại' },
 { label: 'Kafka raw offset lag', value: show(data?.kafka.raw_offset_lag), detail: 'Độ lệch offset Kafka' },
 { label: 'RAM cao nhất', value: runtime?.memory_percent_max == null ? 'Chưa có dữ liệu' : `${runtime.memory_percent_max}%`, detail: 'Phần trăm giới hạn RAM của task hiện tại' },
 { label: 'Worker readiness', value: data?.readiness.status ?? 'Chưa có dữ liệu', detail: 'Trạng thái sẵn sàng xử lý' }]} />
 {controller?.status === 'COMPLETED_OBSERVATION' && <section className="tpl-card"><div className="tpl-card-body"><Badge tone="warning">OBSERVE ONLY · Đợt thử đã kết thúc</Badge><p>{controller.series.length} mẫu · lần đo cuối {controller.last_observed_at ? time(controller.last_observed_at) : '—'}. Chế độ quan sát đã kết thúc; chưa bật tự động scale.</p></div></section>}
 <nav className="tpl-tabs tpl-module-tabs"><Button variant="ghost" className={tab === 'services' ? 'tpl-selected' : ''} onClick={() => setTab('services')}>Service & policy</Button><Button variant="ghost" className={tab === 'history' ? 'tpl-selected' : ''} onClick={() => setTab('history')}>Lịch sử quyết định</Button></nav>
 {tab === 'services' ? <>
 <DesignCard title="Service & policy"><table><thead><tr><th>Service</th><th>Running / desired</th><th>Min / max replica</th><th>Policy</th><th /></tr></thead><tbody><tr><td>canonical-normalizer</td><td>{replica}</td><td>{policy ? `${policy.min_replicas} / ${policy.max_replicas}` : missingPolicy}</td><td><Badge>{policy ? 'Policy đợt quan sát' : missingPolicy}</Badge></td><td><Button variant="outline" onClick={() => setPolicyOpen(true)}>Xem policy</Button></td></tr></tbody></table></DesignCard>
 <div className="tpl-grid tpl-equal"><DesignCard title="Capacity & guard"><table><thead><tr><th>Kiểm tra</th><th>Giá trị</th></tr></thead><tbody><tr><td>Worker readiness hiện tại</td><td>{data?.readiness.status ?? 'UNVERIFIED'}</td></tr><tr><td>Kafka partitions hiện tại</td><td>{show(data?.kafka.partition_count)}</td></tr><tr><td>CPU dự phòng theo policy</td><td>{policy ? `${policy.cpu_headroom_nano / 1e9} CPU` : missingPolicy}</td></tr><tr><td>RAM dự phòng theo policy</td><td>{policy ? `${policy.memory_headroom_bytes / 1024 ** 3} GiB` : missingPolicy}</td></tr><tr><td>Cooldown theo policy</td><td>{policy ? `${policy.cooldown_ms / 1000} giây` : missingPolicy}</td></tr><tr><td>Consumable lag hiện tại</td><td>{data?.kafka.consumable_lag == null ? 'Chưa có số đo hợp lệ' : show(data.kafka.consumable_lag)}</td></tr></tbody></table></DesignCard>
 <DesignCard title="Quyết định quan sát gần nhất" detail={last ? time(last.at) : undefined}>{last ? <><Badge>Giữ nguyên {last.desired_replicas} replica</Badge><p>{reasons[last.reason] ?? last.reason}</p><p>Consumable lag: {show(last.consumable_lag)} · Raw offset lag: {show(last.raw_offset_lag)} · RAM: {show(last.memory_percent)}%</p><Badge>{last.result}</Badge></> : <div className="tpl-empty">Chưa có quyết định được ghi nhận.</div>}</DesignCard></div>
 <DesignCard title="Tài nguyên & backlog theo thời gian"><label className="tpl-block-label">Khoảng dữ liệu<select aria-label="Khoảng telemetry" value={hours} onChange={e=>setHours(e.target.value)}><option value="1">1 giờ</option><option value="6">6 giờ</option><option value="24">24 giờ</option><option value="168">7 ngày</option></select></label>
 {historyQuery.isError ? <p role="alert">Không tải được lịch sử. Hãy thử làm mới.</p> : historyQuery.isPending ? <div className="tpl-empty">Đang tải dữ liệu…</div> : history?.items.length ? <><p className="tpl-semantic-footnote">{history.items.length} điểm dữ liệu</p><div className="tpl-grid tpl-equal"><ObservationChart series={history.items} field="running_replicas" title="Replica đang chạy" bucketSeconds={history.bucket_seconds}/><ObservationChart series={history.items} field="consumable_lag" title="Consumable lag" bucketSeconds={history.bucket_seconds}/><ObservationChart series={history.items} field="memory_percent_max" title="RAM cao nhất (%)" bucketSeconds={history.bucket_seconds}/></div></> : <div className="tpl-empty">Chưa có dữ liệu trong khoảng đã chọn.</div>}</DesignCard>
 </> : <DesignCard title="Lịch sử quyết định quan sát">{controller?.history?.length ? <table><thead><tr><th>Thời gian</th><th>Loại</th><th>Replica trước → đề xuất</th><th>Lý do</th><th>Kết quả</th></tr></thead><tbody>{controller.history.map((row, index) => <tr key={row.at + row.kind + index}><td>{time(row.at)}</td><td>{row.kind}</td><td>{row.previous_replicas == null ? '—' : `${row.previous_replicas} → ${row.desired_replicas}`}</td><td title={reasons[row.reason]}>{row.reason}</td><td><Badge>{row.result}</Badge></td></tr>)}</tbody></table> : <div className="tpl-empty">Chưa có audit quan sát.</div>}</DesignCard>}
 {runtime?.reason && <p className="tpl-semantic-footnote">{runtime.reason === 'NOT_CONFIGURED' ? 'Chưa kết nối nguồn đo.' : 'Số đo chưa cập nhật. Hãy thử làm mới.'}</p>}
 {policyOpen && <DesignDialog title="Scale policy" onClose={() => setPolicyOpen(false)}>{policy ? <><Badge>OBSERVE ONLY · Không phải policy triển khai VPS</Badge><table><tbody>{[
 ['Min / max replica', `${policy.min_replicas} / ${policy.max_replicas}`], ['Ngưỡng lag tăng / giảm', `${policy.up_lag} / ${policy.down_lag}`], ['RAM tăng / giảm', `${policy.up_memory_percent}% / ${policy.down_memory_percent}%`], ['Cửa sổ tăng / giảm', `${policy.up_window_ms / 1000}s / ${policy.down_window_ms / 1000}s`], ['Cooldown', `${policy.cooldown_ms / 1000}s`],
 ].map(([label, value]) => <tr key={label}><th>{label}</th><td>{value}</td></tr>)}</tbody></table><p>Chế độ quan sát, chưa bật tự động scale.</p></> : <p>{missingPolicy}. Các thông số sẽ hiển thị khi có policy đã xác minh.</p>}</DesignDialog>}
 </div>;
}
