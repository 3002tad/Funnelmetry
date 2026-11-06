import { useState } from 'react';
import { useAuth } from '../../auth/AuthContext';
import { Button } from '../../components/ui/button';
import Pipeline from './FriendlyPipelineHealthPage';
import Processing from './FriendlyProcessingPage';
import Sources from './SourcesPage';
import Feed from './EventFeedPage';
import Connectors from './ConnectorsPage';
import Mappings from './MappingsPage';
import Trace from './EventTracePage';
import Quarantine from './QuarantinePage';
import AdminPipelineDashboard from './AdminPipelineDashboard';
import HealthRecoveryPage from './HealthRecoveryPage';
import { PageHeader } from '../../components/ui/page';
import { Badge } from '../../components/ui/badge';
import { useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
export default function AdminWorkspacePage({ kind }: {
    kind: 'pipeline' | 'sources' | 'investigate' | 'health';
}) {
    const { user } = useAuth();
    const [traceTarget, setTraceTarget] = useState<{
        source: string;
        event: string;
    } | null>(null);
    const cache = useQueryClient();
    const tabs = kind === 'pipeline' ? [['summary', 'Tổng quan'], ['processing', 'Workers · Kafka · Cảnh báo']] : kind === 'sources' ? [['sources', 'Nguồn'], ['feed', 'Event Feed & Cursor'], ['mappings', 'Mappings']] : kind === 'health' ? [['processing', 'Health & readiness'], ['policy', 'Recovery policy']] : [['quarantine', 'Quarantine / Unsupported'], ['trace', 'Event Trace']];
    const allowed = tabs.filter(([id]) => !['feed', 'cursor'].includes(id) || user?.permissions?.includes('pipeline.monitor'));
    const [selected, setSelected] = useState(allowed[0][0]);
    const active = allowed.some(t => t[0] === selected) ? selected : allowed[0][0];
    if (kind === 'pipeline')
        return <AdminPipelineDashboard />;
    if (kind === 'health')
        return <HealthRecoveryPage />;
    return <div className="tpl-page"><PageHeader title={kind === 'sources' ? 'Nguồn dữ liệu' : 'Điều tra sự kiện'} description="Quản trị nguồn, xử lý và quyền truy cập hệ thống." actions={<Button variant="outline" onClick={() => void cache.refetchQueries({ type: 'active' })}><RefreshCw size={14}/>Làm mới</Button>}/><div className="tpl-admin-scope"><Badge>medusa-reference</Badge><Badge>Retained PostgreSQL</Badge></div><nav className="tpl-tabs tpl-module-tabs" aria-label="Các mục quản trị">{allowed.map(([id, label]) => <Button key={id} variant="ghost" className={active === id ? "tpl-selected" : ""} onClick={() => setSelected(id)}>{label}</Button>)}</nav><div className="embedded-admin-module">
  {active === 'summary' ? <Pipeline /> : active === 'processing' ? <Processing /> : active === 'sources' ? <Sources /> : active === 'feed' ? <><Feed /><Connectors /></> : active === 'cursor' ? <Connectors /> : active === 'mappings' ? <Mappings /> : active === 'trace' ? <Trace initialSource={traceTarget?.source} initialEvent={traceTarget?.event}/> : active === 'quarantine' ? <Quarantine onTrace={(source, event) => { setTraceTarget({ source, event }); setSelected('trace'); }}/> : null}</div></div>;
}
