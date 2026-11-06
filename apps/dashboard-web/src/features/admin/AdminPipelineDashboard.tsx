import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { apiRequest, analyticsSourceId } from '../../lib/api';
import { parsePipelineHealth } from '../../lib/pipeline-health';
import { PageHeader } from '../../components/ui/page';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import ProcessingPage from './ProcessingPage';
import MonitoringAlerts from './MonitoringAlerts';
type Workers = {
    reason?: string;
    workers: {
        worker: string;
        ready: boolean | null;
        status: string;
        checked_at: string;
    }[];
};
type Processing = {
    checked_at: string;
    stages: {
        stage: string;
        retained_count: string;
    }[];
};
type Lag = {
    status: string;
    reason?: string;
    checked_at: string;
    groups: {
        group_id: string;
        topic: string;
        status: string;
        lag_offsets: string | null;
    }[];
};
const stageLabels: Record<string, string> = { normalized: 'Normalized outcomes', unsupported: 'Unsupported', quarantined: 'Quarantined', canonical: 'Canonical ledger', kpi: 'KPI applications' };
export default function AdminPipelineDashboard() {
    const { user } = useAuth(), [tab, setTab] = useState('workers'), [technicalOpen, setTechnicalOpen] = useState(false);
    const pipeline = useQuery({ queryKey: ['admin-pipeline', analyticsSourceId], queryFn: async ({ signal }) => parsePipelineHealth(await apiRequest(`/api/v2/admin/pipeline?source_id=${analyticsSourceId}`, { signal })), retry: false });
    const processing = useQuery({ queryKey: ['admin-processing', user?.id, analyticsSourceId], queryFn: ({ signal }) => apiRequest<Processing>(`/api/v2/admin/processing?source_id=${analyticsSourceId}`, { signal }), retry: false });
    const workers = useQuery({ queryKey: ['admin-worker-readiness', user?.id], queryFn: ({ signal }) => apiRequest<Workers>('/api/v2/admin/worker-readiness', { signal }), retry: false });
    const lag = useQuery({ queryKey: ['admin-kafka-lag', user?.id], queryFn: ({ signal }) => apiRequest<Lag>('/api/v2/admin/kafka-lag', { signal }), retry: false });
    // A failed refresh must not present a previously cached ready flag as live.
    const workerData = workers.isError ? undefined : workers.data, stageData = processing.isError ? undefined : processing.data;
    const snapshot = pipeline.isError ? undefined : pipeline.data, lagData = lag.isError ? undefined : lag.data;
    const ready = workerData?.workers?.filter(w => w.ready === true).length ?? 0, total = workerData?.workers?.length ?? 0;
    const degraded = workerData?.workers?.filter(w => w.ready === false).length ?? 0;
    const refreshing = pipeline.isFetching || processing.isFetching || workers.isFetching || lag.isFetching;
    const uncertain = !workerData || !!workerData.reason || !total || workerData.workers?.some(w => w.ready === null);
    const cards = [
        ['Canonical đã lưu', snapshot?.metrics.canonical.toLocaleString('vi-VN') ?? 'Chưa xác minh', 'Retained PostgreSQL count'],
        ['Worker readiness', uncertain ? 'Chưa xác minh' : `${ready} / ${total}`, 'Tín hiệu tự báo · không phải E2E'],
        ['Unsupported', stageData?.stages?.find(s => s.stage === 'unsupported')?.retained_count ?? 'Chưa xác minh', 'Kết quả xử lý còn lưu'],
        ['Kafka consumer lag', lagData?.status === 'OBSERVED' ? 'Đã có số đo' : 'Chưa đo', lagData?.reason || lagData?.status || 'UNVERIFIED'],
    ];
    return <div className="space-y-5 admin-dashboard">
    <PageHeader title="Tổng quan Pipeline" description="Quản trị nguồn, xử lý và quyền truy cập hệ thống." actions={<Button variant="outline" disabled={refreshing} onClick={() => { void pipeline.refetch(); void processing.refetch(); void workers.refetch(); void lag.refetch(); }}><RefreshCw size={14}/>Làm mới</Button>}/>
    <div className="tpl-admin-scope"><Badge>{analyticsSourceId}</Badge><Badge>PostgreSQL · runtime probes</Badge>{snapshot && <span>Kiểm tra: {new Date(snapshot.checked_at).toLocaleString('vi-VN')}</span>}</div>
    <section className="tpl-card tpl-admin-hero"><div><h2>{degraded ? 'Pipeline cần kiểm tra' : uncertain ? 'Trạng thái runtime chưa xác minh' : 'Đã nhận tín hiệu readiness'}</h2><p>{degraded ? `${degraded} worker báo chưa sẵn sàng. ` : ''}Readiness, dữ liệu lưu trữ và Kafka lag là các tín hiệu độc lập.</p></div><Badge tone={degraded || uncertain ? 'warning' : 'neutral'}>{degraded ? 'Cần chú ý' : uncertain ? 'UNVERIFIED' : 'Readiness tự báo'}</Badge></section>
    {(pipeline.isError || processing.isError || workers.isError || lag.isError) && <p role="alert">Một phần dữ liệu chưa đọc được. Không dùng số 0 thay lỗi truy vấn.</p>}
    <div className="tpl-stats">{cards.map(([label, value, detail]) => <article className="tpl-card tpl-stat" key={label}><div className="tpl-stat-title">{label}</div><strong className="tpl-stat-value">{value}</strong><p className="tpl-stat-foot">{detail}</p></article>)}</div>
    <nav className="tpl-tabs" aria-label="Pipeline"><Button variant="ghost" className={tab === "workers" ? "tpl-selected" : ""} onClick={() => setTab('workers')}>Workers & xử lý</Button><Button variant="ghost" className={tab === "kafka" ? "tpl-selected" : ""} onClick={() => setTab('kafka')}>Kafka</Button><Button variant="ghost" className={tab === "alerts" ? "tpl-selected" : ""} onClick={() => setTab('alerts')}>Cảnh báo</Button></nav>
    {tab === 'workers' && <div className="tpl-grid"><section className="tpl-card"><div className="tpl-card-head"><div><h2>Worker readiness</h2><p>Endpoint nội bộ · tín hiệu tiến trình</p></div><Badge tone={degraded ? 'warning' : 'neutral'}>{uncertain ? 'UNVERIFIED' : `${ready} READY · ${degraded} DEGRADED`}</Badge></div><div className="tpl-worker-grid">{workerData?.workers?.map(w => <article className="tpl-worker" key={w.worker}><div><strong>{w.worker}</strong><Badge tone={w.ready === false ? 'danger' : w.ready === true ? 'primary' : 'neutral'}>{w.status || 'UNVERIFIED'}</Badge></div><small>{w.checked_at ? new Date(w.checked_at).toLocaleString('vi-VN') : 'Chưa có thời điểm quan sát'}</small></article>)}{(!workerData?.workers?.length || workerData.reason) && <p className="p-3 text-xs text-muted-foreground">Chưa có probe worker được cấu hình tại môi trường API này.</p>}</div></section><section className="tpl-card overflow-hidden"><div className="tpl-card-head"><div><h2>Các chặng dữ liệu</h2><p>Grain khác nhau, không lấy hiệu suy thất thoát</p></div></div><table><thead><tr><th>Chặng</th><th className="text-right">Retained</th></tr></thead><tbody>{snapshot && <tr><td>Accepted receipts</td><td className="text-right">{snapshot.metrics.accepted}</td></tr>}{stageData?.stages?.map(s => <tr key={s.stage}><td>{stageLabels[s.stage] || s.stage}</td><td className="text-right">{s.retained_count}</td></tr>)}</tbody></table><Link to="/admin/investigate" className="tpl-card-link">Điều tra sự kiện <span>→</span></Link></section></div>}
    {tab === 'kafka' && <section className="tpl-card"><div className="tpl-card-head"><h2>Kafka consumer lag</h2><Badge>{lagData?.status || 'UNVERIFIED'}</Badge></div>{lagData?.groups?.length ? <table><thead><tr><th>Consumer group</th><th>Topic</th><th>Trạng thái</th><th>Offset lag</th></tr></thead><tbody>{lagData.groups.map(g => <tr key={g.group_id + g.topic}><td>{g.group_id}</td><td>{g.topic}</td><td>{g.status}</td><td>{g.lag_offsets ?? 'Chưa xác minh'}</td></tr>)}</tbody></table> : <p className="p-5 text-sm text-muted-foreground">{lagData?.reason || 'Chưa có API probe Kafka được cấu hình ở môi trường local.'} · Không coi đây là lag bằng 0.</p>}</section>}
    {tab === 'alerts' && <section className="tpl-card p-5"><MonitoringAlerts /></section>}
    <details className="tpl-card tpl-technical-details" onToggle={e => setTechnicalOpen(e.currentTarget.open)}><summary>Chi tiết kỹ thuật và giới hạn quan sát</summary><p className="text-xs text-muted-foreground my-4">Số liệu retained không theo bộ lọc thời gian. READY không chứng minh mọi replica hoặc luồng end-to-end. Probe local có thể chưa truy cập endpoint nội bộ trên VPS.</p>{technicalOpen && <ProcessingPage />}</details>
  </div>;
}
