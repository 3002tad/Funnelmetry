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
type Scaling = {
 checked_at: string;
 runtime: { status: string; reason: string | null; desired_replicas: number | null; running_replicas: number | null; memory_percent_max: number | null };
 kafka: { raw_offset_lag: string | null; partition_count: number | null };
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
function ObservationChart({ series, field, title }: { series: Decision[]; field: 'previous_replicas' | 'consumable_lag'; title: string }) {
 const points = series.filter(row => row[field] != null && Number.isSafeInteger(Number(row[field])));
 if (!points.length) return <p>Chưa có mẫu đo cho {title}.</p>;
 const start = Date.parse(points[0].at), duration = Math.max(1, Date.parse(points[points.length - 1].at) - start);
 const maximum = Math.max(1, ...points.map(row => Number(row[field])));
 const x = (row: Decision) => 45 + (Date.parse(row.at) - start) / duration * 410;
 const y = (row: Decision) => 135 - Number(row[field]) / maximum * 100;
 return <div><h3>{title}</h3><svg viewBox="0 0 500 175" role="img" aria-label={`${title}: ${points.length} mẫu từ đợt quan sát đã kết thúc`} style={{ width: '100%', color: 'var(--tpl-accent, #4263eb)' }}>
   <path d="M45 25 V135 H460" fill="none" stroke="currentColor" opacity=".25" />
   <text x="8" y="38" fontSize="12" fill="currentColor">{maximum}</text><text x="20" y="138" fontSize="12" fill="currentColor">0</text>
   <polyline points={points.map(row => `${x(row)},${y(row)}`).join(' ')} fill="none" stroke="currentColor" strokeWidth="2.5" />
   {points.map((row, index) => <circle key={row.at + index} cx={x(row)} cy={y(row)} r="4" fill="currentColor"><title>{time(row.at)} · {row[field]}</title></circle>)}
   <text x="45" y="162" fontSize="11" fill="currentColor">{new Date(points[0].at).toLocaleTimeString()}</text><text x="455" y="162" textAnchor="end" fontSize="11" fill="currentColor">{new Date(points[points.length - 1].at).toLocaleTimeString()}</text>
 </svg></div>;
}
export default function ScalingPage() {
 const { user } = useAuth();
 const [tab, setTab] = useState('services'), [policyOpen, setPolicyOpen] = useState(false);
 const query = useQuery({ queryKey: ['admin-scaling', user?.id], queryFn: ({ signal }) => apiRequest<Scaling>('/api/v2/admin/scaling', { signal }), retry: false, gcTime: 0 });
 const data = query.isError ? undefined : query.data, runtime = data?.runtime, controller = data?.controller;
 const policy = controller?.policy, last = controller?.last_decision;
 const replica = runtime?.desired_replicas == null ? 'Chưa có dữ liệu' : `${runtime.running_replicas} / ${runtime.desired_replicas}`;
 return <div className="tpl-page"><PageHeader title="Auto Scaling" description="Quan sát tài nguyên và trạng thái canonical-normalizer." />
 <div className="tpl-admin-scope"><Badge>Toàn bộ nguồn · chỉ đọc</Badge><Button variant="outline" disabled={query.isFetching} onClick={() => void query.refetch()}>{query.isFetching ? 'Đang tải…' : 'Làm mới'}</Button></div>
 {query.isError && <p role="alert">Không tải được dữ liệu Auto Scaling. Hãy thử lại.</p>}
 <section className="tpl-card tpl-admin-hero"><div><h2>Auto Scaling · canonical-normalizer</h2><p>{data ? `Kiểm tra API lúc ${time(data.checked_at)}` : 'Đang chờ API'}</p></div><Badge>{runtime?.status === 'OBSERVED' ? 'Đã đo runtime' : 'Runtime chưa có dữ liệu'}</Badge></section>
 <DesignStats items={[
 { label: 'Replica đang chạy / mong muốn', value: replica, detail: 'Swarm service và task state hiện tại' },
 { label: 'Kafka raw offset lag', value: show(data?.kafka.raw_offset_lag), detail: 'Offset positions hiện tại · không phải event count' },
 { label: 'RAM cao nhất', value: runtime?.memory_percent_max == null ? 'Chưa có dữ liệu' : `${runtime.memory_percent_max}%`, detail: 'Phần trăm giới hạn RAM của task hiện tại' },
 { label: 'Worker readiness', value: data?.readiness.status ?? 'Chưa có dữ liệu', detail: 'Readiness hiện tại, riêng biệt với số replica' }]} />
 {controller?.status === 'COMPLETED_OBSERVATION' && <section className="tpl-card"><div className="tpl-card-body"><Badge tone="warning">OBSERVE ONLY · Đợt thử đã kết thúc</Badge><p>{controller.series.length} mẫu · lần đo cuối {controller.last_observed_at ? time(controller.last_observed_at) : '—'}. {controller.stale ? 'Mẫu lịch sử đã quá thời hạn live.' : 'Dữ liệu từ đợt thử, không phải tiến trình nền.'} Policy bên dưới là cấu hình thử local; không có hành động scale được thực thi.</p></div></section>}
 <nav className="tpl-tabs tpl-module-tabs"><Button variant="ghost" className={tab === 'services' ? 'tpl-selected' : ''} onClick={() => setTab('services')}>Service & policy</Button><Button variant="ghost" className={tab === 'history' ? 'tpl-selected' : ''} onClick={() => setTab('history')}>Lịch sử quyết định</Button></nav>
 {tab === 'services' ? <>
 <DesignCard title="Service & policy" detail="Policy thử local · không tự bật controller hoặc thay đổi replica"><table><thead><tr><th>Service</th><th>Running / desired</th><th>Min / max thử</th><th>Policy</th><th /></tr></thead><tbody><tr><td>canonical-normalizer</td><td>{replica}</td><td>{policy ? `${policy.min_replicas} / ${policy.max_replicas}` : 'Chưa có dữ liệu'}</td><td><Badge>{policy ? 'Quan sát local' : 'Chưa kết nối policy'}</Badge></td><td><Button variant="outline" onClick={() => setPolicyOpen(true)}>Xem policy</Button></td></tr></tbody></table></DesignCard>
 <div className="tpl-grid tpl-equal"><DesignCard title="Capacity & guard"><table><thead><tr><th>Kiểm tra</th><th>Giá trị</th></tr></thead><tbody><tr><td>Worker readiness hiện tại</td><td>{data?.readiness.status ?? 'UNVERIFIED'}</td></tr><tr><td>Kafka partitions hiện tại</td><td>{show(data?.kafka.partition_count)}</td></tr><tr><td>CPU headroom cấu hình thử</td><td>{policy ? `${policy.cpu_headroom_nano / 1e9} CPU` : 'Chưa có dữ liệu'}</td></tr><tr><td>RAM headroom cấu hình thử</td><td>{policy ? `${policy.memory_headroom_bytes / 1024 ** 3} GiB` : 'Chưa có dữ liệu'}</td></tr><tr><td>Cooldown cấu hình thử</td><td>{policy ? `${policy.cooldown_ms / 1000} giây` : 'Chưa có dữ liệu'}</td></tr><tr><td>Consumable lag lần quan sát cuối</td><td>{show(last?.consumable_lag)}</td></tr></tbody></table></DesignCard>
 <DesignCard title="Quyết định quan sát gần nhất" detail={last ? time(last.at) : undefined}>{last ? <><Badge>Giữ nguyên {last.desired_replicas} replica</Badge><p className="tpl-semantic-footnote">{last.reason}</p><p>{reasons[last.reason] ?? last.reason}</p><p>Consumable lag: {show(last.consumable_lag)} · Raw offset lag: {show(last.raw_offset_lag)} · RAM: {show(last.memory_percent)}%</p><Badge>{last.result}</Badge></> : <div className="tpl-empty">Chưa kết nối audit controller.</div>}</DesignCard></div>
 <DesignCard title="Replica & backlog trong đợt quan sát" detail="Các điểm lấy từ audit thật; không nội suy thành lịch sử chạy liên tục.">{controller?.series?.length ? <div className="tpl-grid tpl-equal"><ObservationChart series={controller.series} field="previous_replicas" title="Replica đã quan sát" /><ObservationChart series={controller.series} field="consumable_lag" title="Consumable lag đã quan sát" /></div> : <div className="tpl-empty">Chưa có chuỗi quan sát.</div>}</DesignCard>
 </> : <DesignCard title="Lịch sử quyết định quan sát" detail="Bao gồm quyết định HOLD; đây không phải lịch sử thao tác scale đã thực thi.">{controller?.history?.length ? <table><thead><tr><th>Thời gian</th><th>Loại</th><th>Replica trước → đề xuất</th><th>Lý do</th><th>Kết quả</th></tr></thead><tbody>{controller.history.map((row, index) => <tr key={row.at + row.kind + index}><td>{time(row.at)}</td><td>{row.kind}</td><td>{row.previous_replicas == null ? '—' : `${row.previous_replicas} → ${row.desired_replicas}`}</td><td title={reasons[row.reason]}>{row.reason}</td><td><Badge>{row.result}</Badge></td></tr>)}</tbody></table> : <div className="tpl-empty">Chưa có audit quan sát.</div>}</DesignCard>}
 {runtime?.reason && <p className="tpl-semantic-footnote">{runtime.reason === 'NOT_CONFIGURED' ? 'API chưa được cấu hình file telemetry Swarm.' : 'File telemetry không truy cập được, không hợp lệ hoặc đã quá 60 giây.'}</p>}
 {policyOpen && <DesignDialog title="Scale policy · cấu hình thử local" onClose={() => setPolicyOpen(false)}>{policy ? <><Badge>OBSERVE ONLY · Không phải policy triển khai VPS</Badge><table><tbody>{[
 ['Min / max replica', `${policy.min_replicas} / ${policy.max_replicas}`], ['Ngưỡng lag tăng / giảm', `${policy.up_lag} / ${policy.down_lag}`], ['RAM tăng / giảm', `${policy.up_memory_percent}% / ${policy.down_memory_percent}%`], ['Cửa sổ tăng / giảm', `${policy.up_window_ms / 1000}s / ${policy.down_window_ms / 1000}s`], ['Cooldown', `${policy.cooldown_ms / 1000}s`],
 ].map(([label, value]) => <tr key={label}><th>{label}</th><td>{value}</td></tr>)}</tbody></table><p>Đợt thử không có attestation replay/drain cho image hiện tại. Không có quyền thực thi scale từ UI này.</p></> : <p>Chưa có policy quan sát đã xác minh.</p>}</DesignDialog>}
 </div>;
}
