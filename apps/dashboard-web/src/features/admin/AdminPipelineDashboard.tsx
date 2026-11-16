import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { RefreshCw, Database, Activity, ShieldAlert, ChartNoAxesCombined } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { apiRequest, analyticsSourceId } from '../../lib/api';
import { parsePipelineHealth } from '../../lib/pipeline-health';
import './saas-overview.css';
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
    const unsupported = stageData?.stages.find(s => s.stage === 'unsupported')?.retained_count;
    const needsMapping = unsupported != null && /^\d+$/.test(unsupported) && BigInt(unsupported) > 0n;
    return <div className="saas-overview">
      <header className="so-heading"><div><span className="so-eyebrow">WORKSPACE / ADMIN</span><h1>Tổng quan</h1><p>Mọi thứ bạn cần để quản lý hệ thống.</p></div><Button variant="outline" disabled={refreshing} onClick={() => { void pipeline.refetch(); void processing.refetch(); void workers.refetch(); void lag.refetch(); }}><RefreshCw size={16}/>Làm mới</Button></header>
      {(pipeline.isError || processing.isError || workers.isError || lag.isError) && <p role="alert" className="so-error">Một phần dữ liệu chưa đọc được. Hãy thử làm mới.</p>}
      <div className="so-layout">
        <div className="so-main">
          <section className="so-attention"><div className="so-section-title"><div><span className="so-eyebrow">ƯU TIÊN HÔM NAY</span><h2>Việc cần chú ý</h2></div><ShieldAlert size={23}/></div>
            {degraded > 0 && <Link className="so-task" to="/admin/recovery"><span className="so-task-icon amber"><Activity size={20}/></span><div><strong>{degraded} worker chưa sẵn sàng</strong><p>Kiểm tra trạng thái và khả năng phục hồi.</p></div><span className="so-task-go">Kiểm tra <span aria-hidden="true">↗</span></span></Link>}
            {uncertain && <Link className="so-task" to="/admin/recovery"><span className="so-task-icon amber"><Activity size={20}/></span><div><strong>Readiness chưa xác minh</strong><p>Xem các tín hiệu hiện có của worker.</p></div><span className="so-task-go">Kiểm tra ↗</span></Link>}
            {needsMapping && <Link className="so-task" to="/admin/investigate"><span className="so-task-icon violet"><ShieldAlert size={20}/></span><div><strong>{unsupported} sự kiện chưa được hỗ trợ</strong><p>Mở truy vết để kiểm tra lý do xử lý.</p></div><span className="so-task-go">Xem sự kiện ↗</span></Link>}
            {lagData?.status !== 'OBSERVED' && <button className="so-task" onClick={() => setTab('kafka')}><span className="so-task-icon"><ChartNoAxesCombined size={20}/></span><div><strong>Chưa có số đo Kafka lag</strong><p>{lagData?.reason || 'Chưa xác minh dữ liệu giám sát.'}</p></div><span className="so-task-go">Xem trạng thái ↓</span></button>}
            {!degraded && !uncertain && !needsMapping && lagData?.status === 'OBSERVED' && <p className="so-empty">Chưa thấy mục cần chú ý trong các tín hiệu hiện có. Đây không phải xác nhận toàn tuyến.</p>}
          </section>
          <section className="so-runtime"><div className="so-section-title"><div><h2>Hoạt động hệ thống</h2><p>{snapshot ? `Cập nhật ${new Date(snapshot.checked_at).toLocaleString('vi-VN')}` : 'Đang chờ dữ liệu quan sát'}</p></div><Link to="/admin/scaling" className="so-inline-link">Xem tài nguyên ↗</Link></div>
            <div className="so-tabs" aria-label="Hoạt động hệ thống">{[['workers','Workers & xử lý'],['kafka','Kafka'],['alerts','Cảnh báo']].map(([id,label])=><button key={id} aria-pressed={tab===id} onClick={()=>setTab(id)}>{label}</button>)}</div>
            {tab==='workers' && <><div className="so-worker-summary"><span><i/>{uncertain?'Chưa xác minh':`${ready} / ${total} worker sẵn sàng`}</span><span>Readiness tự báo · không phải E2E</span></div><div className="so-worker-list">{workerData?.workers.map(w=><div className="so-worker" key={w.worker}><span className="so-worker-symbol"><Activity size={18}/></span><div><strong>{w.worker}</strong><time>{w.checked_at ? new Date(w.checked_at).toLocaleString('vi-VN') : 'Chưa có thời điểm quan sát'}</time></div><Badge tone={w.ready===false?'warning':w.ready===true?'primary':'neutral'}>{w.status || 'UNVERIFIED'}</Badge></div>)}</div>{!total && <p className="so-empty">Chưa có dữ liệu worker.</p>}<Link to="/admin/recovery" className="so-footer-link">Mở quản lý worker <span>→</span></Link></>}
            {tab==='kafka' && <div className="so-kafka"><Badge>{lagData?.status || 'UNVERIFIED'}</Badge>{lagData?.groups?.length ? lagData.groups.map(g=><div className="so-worker" key={g.group_id+g.topic}><div><strong>{g.group_id}</strong><p>{g.topic} · {g.status}</p></div><span>{g.lag_offsets??'Chưa đo'} offset</span></div>):<p>Chưa có số đo hợp lệ; không coi lag bằng 0.</p>}</div>}
            {tab==='alerts' && <div className="so-kafka"><MonitoringAlerts/></div>}
          </section>
        </div>
        <aside className="so-context">
          <section className="so-data"><span className="so-data-icon"><Database size={22}/></span><p>Dữ liệu canonical đã lưu</p><strong>{snapshot?.metrics.canonical.toLocaleString('vi-VN')??'Chưa xác minh'}</strong><span>{analyticsSourceId}</span><Link to="/admin/sources">Quản lý nguồn dữ liệu <span>→</span></Link></section>
          <section className="so-shortcuts"><h2>Truy cập nhanh</h2>{[['/admin/scaling','Tài nguyên & mở rộng','Theo dõi replica và cấu hình'],['/admin/users','Thành viên & quyền','Quản lý truy cập workspace'],['/admin/audit','Lịch sử thay đổi','Tra cứu hoạt động tài khoản']].map(([to,title,description])=><Link key={to} to={to}><div><strong>{title}</strong><span>{description}</span></div><span aria-hidden="true">↗</span></Link>)}</section>
          <section className="so-retained"><h2>Các chặng dữ liệu</h2><dl>{snapshot&&<div><dt>Accepted receipts</dt><dd>{snapshot.metrics.accepted}</dd></div>}{stageData?.stages.map(s=><div key={s.stage}><dt>{stageLabels[s.stage]||s.stage}</dt><dd>{s.retained_count}</dd></div>)}</dl><p>Đơn vị đếm khác nhau, không lấy hiệu suy thất thoát.</p></section>
        </aside>
      </div>
      <details className="so-technical" onToggle={e=>setTechnicalOpen(e.currentTarget.open)}><summary>Chi tiết kỹ thuật & giới hạn quan sát <span>Mở / thu gọn ↕</span></summary><p>Số liệu là bản ghi còn lưu, không theo bộ lọc thời gian. Readiness, Kafka lag và dữ liệu lưu trữ là các tín hiệu độc lập; không chứng minh toàn tuyến.</p>{technicalOpen&&<ProcessingPage/>}</details>
    </div>;
}
