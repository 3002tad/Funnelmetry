import { useState } from 'react';
import { Button } from '../../components/ui/button';
import { FunnelsPage } from './FunnelsPage';
import { JourneysPage } from '../journeys/JourneysPage';
import { PageHeader } from '../../components/ui/page';
export default function FunnelWorkspacePage() { const [tab, setTab] = useState('funnel'); return <div className="tpl-page funnel-workspace"><PageHeader title="Hành trình chuyển đổi" description="Từ góc nhìn phễu tổng hợp tới timeline của từng hành trình."/><nav className="tpl-tabs" aria-label="Hành trình chuyển đổi"><Button variant="ghost" className={tab === "funnel" ? "tpl-selected" : ""} onClick={() => setTab('funnel')}>Biểu đồ phễu</Button><Button variant="ghost" className={tab === "journeys" ? "tpl-selected" : ""} onClick={() => setTab('journeys')}>Timeline tham khảo</Button></nav><div className="embedded-funnel">{tab === 'funnel' ? <FunnelsPage /> : <><p className="text-xs text-muted-foreground">Danh sách journey hiện theo nguồn, không lọc theo khoảng ngày phía trên.</p><JourneysPage /></>}</div></div>; }
