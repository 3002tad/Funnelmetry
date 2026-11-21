import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Users, ShoppingBag, ChartNoAxesCombined, Link2 } from 'lucide-react'
import { Button } from '../../components/ui/button'
import { Badge } from '../../components/ui/badge'
import { DesignStats, number } from '../../components/ui/prototype'
import { ApiError } from '../../lib/api'
import { fetchReferenceCdcCurrentState } from '../../lib/analytics-api'

const percent = (value:number,base:number) => base > 0 ? `${(value/base*100).toFixed(1)}%` : '—'
export function ReferenceCdcCandidatePanel({sourceId,range}:{sourceId:string;range:string}) {
  const [selected,setSelected] = useState(0)
  useEffect(()=>setSelected(0),[sourceId,range])
  const query = useQuery({queryKey:['reference-cdc-current-state',sourceId,range],queryFn:({signal})=>fetchReferenceCdcCurrentState(range,signal),retry:false})
  const data = query.isError ? undefined : query.data
  const blocked = query.error instanceof ApiError && query.error.status === 503
  const t = data?.totals
  const steps = t ? [
    {label:'Xem sản phẩm',value:t.entrants,description:'Hành trình có lần xem sản phẩm đầu tiên trong khoảng đã chọn.'},
    {label:'Thêm vào giỏ hàng',value:t.item_added,description:'Đã có sự kiện thêm giỏ từ CDC sau lượt xem, nối bằng bằng chứng phiên, trang sản phẩm và giỏ hàng.'},
    {label:'Bắt đầu thanh toán',value:t.checkout_started,description:'Đã bắt đầu thanh toán sau bước thêm giỏ trên cùng giỏ hàng.'},
    {label:'Có đơn hiện còn ghi nhận',value:t.currently_recorded_journeys,description:'Hành trình có đơn hiện còn ghi nhận sau thanh toán. Số này có thể giảm khi trạng thái CDC chuyển OFF; không xác nhận đã trả tiền hay doanh thu.'},
  ] : []
  return <section aria-label="Phễu CDC hiện hành" className="mt-5">
    <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
      <div><h2 className="text-sm font-semibold">Hành trình mua sắm · trạng thái CDC hiện hành</h2><p className="mt-1 text-xs text-muted-foreground">Mỗi bước đếm hành trình, không phải lượt sự kiện hoặc số đơn hàng.</p></div>
      <Button variant="outline" disabled={query.isFetching} onClick={()=>void query.refetch()}>Làm mới CDC reference</Button>
    </div>
    {query.isPending && <p role="status">Đang kiểm tra chất lượng dữ liệu…</p>}
    {blocked && <p role="alert">BLOCKED_BY_QUALITY — dữ liệu CDC chưa đủ điều kiện đọc. Không hiển thị số liệu cũ.</p>}
    {query.isError && !blocked && <p role="alert">Không đọc được trạng thái CDC hiện hành. Hãy thử làm mới; dữ liệu lịch sử không thay thế kết quả này.</p>}
    {data && t && <>
      <DesignStats items={[
        {label:'Hành trình vào phễu',value:number(t.entrants),detail:'Theo lần xem sản phẩm đầu tiên',icon:Users},
        {label:'Có đơn hiện còn ghi nhận',value:number(t.currently_recorded_journeys),detail:'Hành trình · trạng thái có thể giảm',icon:ShoppingBag},
        {label:'Tỷ lệ có đơn hiện còn ghi nhận',value:percent(t.currently_recorded_journeys,t.entrants),detail:'So với hành trình vào phễu',icon:ChartNoAxesCombined},
        {label:'Hành trình đã nối giỏ',value:data.linkage ? number(data.linkage.linked_entry_journeys) : '—',detail:'Có bằng chứng liên kết rõ ràng',icon:Link2},
      ]}/>

      <div className="tpl-card" style={{padding:16,marginBottom:16}}><Badge>Phễu hiện hành · {data.profile_version}</Badge>
        {data.linkage && <p className="mt-2 text-xs">Đã nối {data.linkage.linked_entry_journeys} hành trình với giỏ. {data.linkage.entries_without_cart_context} hành trình chưa có bằng chứng nối giỏ; {data.linkage.ambiguous_carts} giỏ liên quan nhiều hành trình được loại khỏi các bước sau để tránh đếm nhầm.</p>}
        <p className="mt-2 text-xs text-muted-foreground">Dữ liệu lịch sử chưa đầy đủ. Số liệu có thể thay đổi khi nhận thêm bằng chứng đến trễ.</p>
      </div>
      <div className="tpl-funnel-chart-layout tpl-funnel-compact">
        <section className="tpl-card" aria-label="Biểu đồ phễu hiện hành"><div className="tpl-card-head"><h2>Hành trình mua sắm hiện tại</h2><Badge>CDC · {data.profile_version}</Badge></div>
          {!t.entrants && <p className="tpl-semantic-footnote">Chưa có hành trình trong khoảng đã chọn.</p>}
          <div className="tpl-funnel-chart-steps">{steps.map((step,i)=><button key={step.label} className={`tpl-funnel-chart-step ${selected===i?'tpl-chosen':''}`} style={{width:'100%'}} aria-pressed={selected===i} onClick={()=>setSelected(i)}>
            <div><small>Bước {i+1}</small><strong>{step.label}</strong></div>
            <div className="tpl-funnel-step-values"><div><small>Qua bước trước</small><b>{i ? percent(step.value,steps[i-1].value) : '—'}</b></div><div><b>{number(step.value)}</b><small>{percent(step.value,t.entrants)} so với đầu phễu</small></div></div>
            <div className="tpl-funnel-reach-track" aria-hidden="true"><span data-funnel-reach style={{width:`${t.entrants ? Math.min(100,Math.max(0,step.value/t.entrants*100)) : 0}%`}}/></div>
          </button>)}</div>
        </section>
        <section className="tpl-card tpl-funnel-selected" aria-label="Chi tiết bước hiện hành" style={{padding:20}}><h3>Chi tiết bước: {steps[selected].label}</h3><p className="mt-3 text-sm">{steps[selected].description}</p><p className="mt-3 text-sm">{number(steps[selected].value)} hành trình · {percent(steps[selected].value,t.entrants)} so với đầu phễu.</p></section>
      </div>
      <details className="tpl-card tpl-technical-details"><summary>Cấu hình phễu hiện hành · {data.profile_version}</summary><p className="tpl-small tpl-muted">{data.profile_id}@{data.profile_version} · {data.profile_status}. Khoảng vào phễu: {data.cohort.from ?? data.cohort.activation_at} → trước {data.cohort.to ?? 'hiện tại'} (UTC). Quality hợp lệ đến {data.quality_valid_until}. Coverage: {data.historical_gap_status}.</p></details>
    </>}
  </section>
}
