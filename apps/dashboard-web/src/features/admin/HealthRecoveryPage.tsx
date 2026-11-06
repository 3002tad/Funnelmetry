import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { apiRequest, analyticsSourceId } from '../../lib/api';
import { PageHeader } from '../../components/ui/page';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { DesignCard, DesignStats } from '../../components/ui/prototype';
import { DesignDialog } from '../../components/ui/design-dialog';
type Worker = {
    worker: string;
    status: string;
    ready: boolean | null;
    checked_at: string;
};
type RecoveryObservation = {
    controller: {
        status: string;
        stale?: boolean;
        last_observed_at?: string;
        recovery_status?: string;
        history: { at: string; kind: string; reason: string; action: string; result: string }[];
    };
};
export default function HealthRecoveryPage() {
    const { user } = useAuth(), [tab, setTab] = useState('health'), [selected, setSelected] = useState<Worker | null>(null);
    const query = useQuery({ queryKey: ['admin-worker-readiness', user?.id], queryFn: ({ signal }) => apiRequest<{
            reason?: string;
            workers: Worker[];
        }>('/api/v2/admin/worker-readiness', { signal }), retry: false });
    const controllerQuery = useQuery({ queryKey: ['admin-scaling', user?.id],
        queryFn: ({ signal }) => apiRequest<RecoveryObservation>('/api/v2/admin/scaling', { signal }),
        retry: false, gcTime: 0 });
    const controller = controllerQuery.isError ? undefined : controllerQuery.data?.controller;
    const observed = controller?.status === 'COMPLETED_OBSERVATION';
    const history = observed ? controller.history.filter(row => row.kind === 'RECOVERY') : [];
    const data = query.isError ? undefined : query.data, workers = data?.workers ?? [], ready = workers.filter(w => w.ready === true).length, degraded = workers.filter(w => w.ready === false).length, known = workers.length > 0 && !data?.reason;
    return <div className="tpl-page"><PageHeader title="Health & Recovery" description="Quản trị nguồn, xử lý và quyền truy cập hệ thống." actions={<Button variant="outline" disabled={query.isFetching || controllerQuery.isFetching} onClick={() => { void query.refetch(); void controllerQuery.refetch(); }}><RefreshCw size={14}/>Làm mới</Button>}/><div className="tpl-admin-scope"><Badge>{analyticsSourceId}</Badge><Badge>Runtime probes</Badge></div>
 <section className="tpl-card tpl-admin-hero"><div><h2>Health, readiness & recovery</h2><p>Phân biệt tiến trình đang chạy, sẵn sàng xử lý và tiến độ dữ liệu thực.</p></div><Badge tone="warning">{degraded ? 'Cần kiểm tra' : 'UNVERIFIED'}</Badge></section>
 <DesignStats items={[{ label: 'Readiness', value: known ? `${ready} / ${workers.length}` : 'Chưa đo', detail: 'Worker sẵn sàng xử lý' }, { label: 'Liveness trực tiếp', value: 'Chưa đo', detail: 'Trạng thái sống của worker' }, { label: 'Worker cần kiểm tra', value: known ? degraded : 'Chưa đo', detail: 'Worker tự báo chưa sẵn sàng' }, { label: 'Recovery controller', value: observed ? 'Đợt thử đã kết thúc' : controllerQuery.isFetching ? 'Đang tải…' : 'Chưa xác minh', detail: observed ? `canonical-normalizer · ${controller.recovery_status ?? 'UNVERIFIED'} trong đợt thử đã kết thúc` : 'Chưa có audit quan sát hợp lệ' }]}/>
 {observed && <section className="tpl-card"><div className="tpl-card-body"><Badge tone="warning">OBSERVE ONLY · Đợt thử đã kết thúc</Badge><p>Phạm vi recovery: canonical-normalizer. Lần quan sát cuối: {controller.last_observed_at ? new Date(controller.last_observed_at).toLocaleString() : '—'}. {controller.stale ? 'Kết quả lịch sử đã quá thời hạn live.' : 'Kết quả từ đợt thử có giới hạn.'} Controller không chạy nền và không thực thi restart.</p></div></section>}
 {controllerQuery.isError && <p role="alert">Không tải được lịch sử controller. Hãy thử lại.</p>}
 <nav className="tpl-tabs tpl-module-tabs">{[['health', 'Health'], ['policy', 'Recovery policy'], ['history', 'Lịch sử recovery']].map(([id, label]) => <Button key={id} variant="ghost" className={id === tab ? "tpl-selected" : ""} onClick={() => setTab(id)}>{label}</Button>)}</nav>
 {query.isError && <p role="alert">Không tải được trạng thái worker. Hãy thử lại.</p>}
 {tab === 'health' && <DesignCard title="Trạng thái worker"><table><thead><tr><th>Worker</th><th>Readiness</th><th>Progress</th><th /></tr></thead><tbody>{workers.map(w => <tr key={w.worker}><td className="mono">{w.worker}</td><td><Badge tone={w.ready === false ? 'warning' : w.ready === true ? 'primary' : 'neutral'}>{w.status}</Badge></td><td>Chưa đo trong màn này</td><td><Button variant="outline" onClick={() => setSelected(w)}>Chi tiết</Button></td></tr>)}</tbody></table>{!workers.length && <div className="tpl-empty">Chưa có dữ liệu trạng thái worker.</div>}</DesignCard>}
 {tab === 'policy' && <DesignCard title="Recovery policy"><table><thead><tr><th>Trường hợp</th><th>Cách xử lý theo baseline</th></tr></thead><tbody>{[['Dependency unavailable', 'Readiness false → backoff/alert, không restart mù'], ['Liveness failure', 'Swarm replacement theo policy đã cấu hình'], ['Application recovery', 'Controller allowlist, cooldown, crash-loop guard, audit'], ['Replay / recreated Kafka', 'Kiểm tra checkpoint, lineage và RESTORE_REPLAY evidence'], ['Node loss / stateful HA', 'Chưa claim HA khi chưa có thiết kế và acceptance riêng']].map(r => <tr key={r[0]}>{r.map(c => <td key={c}>{c}</td>)}</tr>)}</tbody></table></DesignCard>}
 {tab === 'history' && <DesignCard title="Lịch sử quan sát recovery" detail="Chế độ quan sát">{history.length ? <table><thead><tr><th>Thời gian</th><th>Quyết định</th><th>Lý do</th><th>Kết quả</th></tr></thead><tbody>{history.map((row, index) => <tr key={row.at + index}><td>{new Date(row.at).toLocaleString()}</td><td>{row.action}</td><td>{row.reason}</td><td><Badge>{row.result}</Badge></td></tr>)}</tbody></table> : <div className="tpl-empty">Chưa có audit quan sát recovery hợp lệ.</div>}</DesignCard>}
 {selected && <DesignDialog title={`Health · ${selected.worker}`} onClose={() => setSelected(null)}><table><tbody>{[['Readiness', selected.status], ['Thời điểm', selected.checked_at], ['Liveness', 'Chưa xác minh'], ['Progress / lag', 'Chưa đủ bằng chứng'], ['Recovery recommendation', 'Không tự động suy restart']].map(r => <tr key={r[0]}>{r.map(c => <td key={c}>{c}</td>)}</tr>)}</tbody></table></DesignDialog>}
 </div>;
}
