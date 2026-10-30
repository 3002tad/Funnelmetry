import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button } from '../../components/ui/button'
import { Badge } from '../../components/ui/badge'
import { ApiError } from '../../lib/api'
import { fetchReferenceCdcCurrentState } from '../../lib/analytics-api'

export function ReferenceCdcCandidatePanel({sourceId,range}:{sourceId:string;range:string}) {
  const [opened,setOpened] = useState(false)
  const query = useQuery({
    queryKey:['reference-cdc-funnel-candidate',sourceId,range],
    queryFn:()=>fetchReferenceCdcCurrentState(range),
    enabled:opened,
    retry:false,
  })
  const data = query.data
  const blocked = query.error instanceof ApiError && query.error.status === 503
  return <section className="panel mt-5 p-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 className="text-sm font-semibold">CDC reference · current state</h2>
        <p className="mt-1 text-xs text-muted-foreground">Trạng thái đơn hiện còn được ghi nhận sau checkout. Có thể giảm khi order chuyển OFF; không phải placed-order conversion hay doanh thu. Chỉ đọc được khi coverage và quality hợp lệ.</p>
      </div>
      <Button variant="outline" onClick={()=>{setOpened(true);if(opened)void query.refetch()}}>
        {opened?'Làm mới CDC reference':'Xem CDC reference'}
      </Button>
    </div>
    {query.isPending && opened && <p className="mt-4 text-xs text-muted-foreground">Đang kiểm tra coverage và quality…</p>}
    {blocked && <div className="mt-4 rounded-lg border border-amber-500/40 p-3 text-xs">
      BLOCKED_BY_QUALITY — dữ liệu CDC chưa đủ điều kiện đọc. Không hiển thị số liệu cũ.
    </div>}
    {query.isError && !blocked && <p className="mt-4 text-xs text-muted-foreground">
      Candidate chưa khả dụng trong môi trường này.
    </p>}
    {data && !query.isError && <>
      <div className="mt-4 flex flex-wrap gap-2"><Badge>{data.profile_status === 'ACTIVE' ?
        `${data.profile_id}@${data.profile_version} · ACTIVE` : 'SHADOW / UNPUBLISHED'}</Badge>
        <Badge>Coverage gap: {data.historical_gap_status}</Badge>
        <Badge>{data.coverage_epoch_id}</Badge></div>
      <div className="mt-4 grid gap-3 sm:grid-cols-4">
        {[
          ['Product viewed',data.totals.entrants],
          ['Item added',data.totals.item_added],
          ['Checkout started',data.totals.checkout_started],
          ['Currently recorded',data.totals.currently_recorded_journeys],
        ].map(([label,value])=><div key={label} className="rounded-lg border p-3">
          <span className="block text-[11px] text-muted-foreground">{label}</span>
          <strong className="mt-1 block text-lg">{value}</strong>
        </div>)}
      </div>
      <p className="mt-3 text-[11px] text-muted-foreground">Cohort từ {new Date(data.cohort.activation_at).toLocaleString()} · quality hợp lệ đến {new Date(data.quality_valid_until).toLocaleString()}.</p>
    </>}
  </section>
}
