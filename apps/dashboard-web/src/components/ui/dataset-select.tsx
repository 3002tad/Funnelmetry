import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../../auth/AuthContext'
import { apiRequest } from '../../lib/api'



export function DatasetSelect({sourceId,value,onChange}:{sourceId:string;value:string;onChange:(id:string)=>void}){const {user}=useAuth();const query=useQuery({queryKey:['dataset-catalog',user?.id,sourceId],queryFn:({signal})=>apiRequest<{items:{id:string;origin:string;first_event_at?:string;last_event_at?:string}[]}>(`/api/v2/analytics/datasets?${new URLSearchParams({source_id:sourceId})}`,{signal}),retry:false});return <div className="tpl-database-banner"><label className="">Bộ dữ liệu<select className="" aria-label="Bộ dữ liệu" value={value} onChange={e=>onChange(e.target.value)}>{value!=="observed"&&!query.data?.items.some(d=>d.id===value)&&<option value={value}>{value} · {query.isPending?"Đang kiểm tra":"Chưa khả dụng"}</option>}<option value="observed">Medusa · dữ liệu quan sát</option>{query.data?.items.filter(d=>d.id!=='observed').map(d=><option key={d.id} value={d.id}>{d.id.includes('historical')?'Demo · lịch sử':'Demo · bổ sung'}{d.first_event_at?' · '+d.first_event_at.slice(0,7)+'–'+d.last_event_at?.slice(0,7):' · Synthetic'}</option>)}</select></label>{query.isError&&<span className="text-xs text-warning">Chưa tải được danh sách dataset demo.</span>}</div>}
