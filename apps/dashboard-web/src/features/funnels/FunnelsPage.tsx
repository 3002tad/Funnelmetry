import {FunnelView} from '../../ui-template/FunnelView'
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CircleOff } from "lucide-react";
import { useOutletContext } from "react-router-dom";
import type { ShellContext } from "../../app/AppShell";
import { Button } from "../../components/ui/button";
import { EmptyState } from "../../components/ui/page";
import { fetchV2Funnel, fetchV2Overview } from "../../lib/analytics-api";
export function FunnelsPage() {
    const { range, sourceId } = useOutletContext<ShellContext>();
    const [selectedKey, setSelectedKey] = useState("");
    const [activeStep, setActiveStep] = useState(0);
    const profiles = useQuery({ queryKey: ["v2-overview", sourceId, range], queryFn: ({ signal }) => fetchV2Overview(range, signal) });
    const selected = profiles.data?.profiles.find((profile) => `${profile.funnel_profile_id}:${profile.profile_version}` === selectedKey) ?? profiles.data?.profiles[0];
    useEffect(() => {
        if (selected && selectedKey !== `${selected.funnel_profile_id}:${selected.profile_version}`)
            setSelectedKey(`${selected.funnel_profile_id}:${selected.profile_version}`);
    }, [selected, selectedKey]);
    const funnel = useQuery({
        queryKey: ["v2-funnel", sourceId, range, selected?.funnel_profile_id, selected?.profile_version],
        queryFn: ({ signal }) => fetchV2Funnel(selected!.funnel_profile_id, selected!.profile_version, range, signal),
        enabled: Boolean(selected),
    });
    useEffect(() => setActiveStep(0), [selectedKey]);
    if (profiles.isLoading)
        return <div className="space-y-4"><div className="skeleton h-16 w-80"/><div className="skeleton h-32"/><div className="skeleton h-96"/></div>;
    if (profiles.isError)
        return <><EmptyState icon={<CircleOff size={20}/>} title="Không tải được danh sách funnel" detail="Kiểm tra Dashboard API V2 và phiên đăng nhập."/><Button disabled={profiles.isFetching} onClick={() => void profiles.refetch()}>Thử tải lại danh sách funnel</Button></>;
    if (!selected)
        return <EmptyState icon={<CircleOff size={20}/>} title="Chưa có Funnel Profile data" detail="Publish reference profile và chạy pipeline trước khi mở Funnel analysis."/>;
    if (funnel.isError)
        return <><EmptyState icon={<CircleOff size={20}/>} title="Không tải được funnel projection" detail="Profile có thể chưa active hoặc migration KPI chưa được áp dụng."/><Button disabled={funnel.isFetching} onClick={() => void funnel.refetch()}>Thử tải lại funnel projection</Button></>;
    if (funnel.isLoading || !funnel.data)
        return <div className="space-y-4"><div className="skeleton h-16 w-80"/><div className="skeleton h-32"/><div className="skeleton h-96"/></div>;
    const data = funnel.data;
  return <>{profiles.data&&profiles.data.profiles.length>1&&<select aria-label="Funnel profile" value={selectedKey} onChange={e=>setSelectedKey(e.target.value)}>{profiles.data.profiles.map(p=><option key={p.funnel_profile_id+':'+p.profile_version} value={p.funnel_profile_id+':'+p.profile_version}>{p.display_name} · {p.profile_version}</option>)}</select>}<FunnelView data={data} selected={activeStep} onSelect={setActiveStep}/></>
}
