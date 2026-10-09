import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../../auth/AuthContext'
import { apiRequest } from '../../lib/api'

type Alerts = { checked_at: string; status: string; policy: { expiry_warning_seconds: number }; items: { id: string; level: string; code: string; subject?: string }[] }
const messages: Record<string,string> = {
  SCRAPE_FAILED: 'Prometheus thu thập metrics thất bại. Kiểm tra kết nối, API và khóa giám sát; chưa xác định nguyên nhân.',
  NOT_CONFIGURED: 'Chưa cấu hình quan sát Prometheus.',
  TARGET_MISSING_OR_AMBIGUOUS: 'Không xác định được một target giám sát duy nhất.',
  SCRAPE_STALE_OR_MISSING: 'Chưa có lần thu thập đủ mới để xác minh.',
  SCRAPE_UNKNOWN: 'Trạng thái thu thập chưa xác minh.',
  PROMETHEUS_UNAVAILABLE: 'Không đọc được Prometheus; chưa thể kết luận tình trạng Pipeline.',
  WORKER_UNVERIFIED: 'Không xác minh được worker; không đồng nghĩa worker đã dừng.',
  WORKER_NOT_READY: 'Worker đang báo chưa sẵn sàng.',
  CREDENTIALS_UNAVAILABLE: 'Không đọc được hạn dùng khóa giám sát.',
  NO_USABLE_CREDENTIAL_REGISTERED: 'Chưa có khóa chưa thu hồi thuộc tài khoản cấp đang hợp lệ.',
  CREDENTIAL_EXPIRED: 'Khóa đã hết hạn; thu hồi nếu không còn dùng hoặc thay khóa nếu đang dùng.',
  CREDENTIAL_EXPIRING: 'Khóa sắp hết hạn; chuẩn bị thay khóa nếu đang dùng.',
  CREDENTIAL_EXPIRY_UNKNOWN: 'Chưa xác minh được hạn dùng khóa.',
}
export default function MonitoringAlerts() {
  const {user} = useAuth()
  const q = useQuery({queryKey:['admin-monitoring-alerts',user?.id],
    queryFn:({signal})=>apiRequest<Alerts>('/api/v2/admin/monitoring-alerts',{signal}),
    retry:false,gcTime:0,refetchInterval:15000,refetchIntervalInBackground:false})
  const data = q.isError ? undefined : q.data
  return <section className="panel space-y-3 p-4" aria-label="Cảnh báo giám sát">
    <h2 className="font-semibold">Cảnh báo giám sát</h2>
    <p className="text-sm text-muted-foreground">Tự cập nhật mỗi 15 giây khi trang đang mở. Đây là quan sát hiện tại, chưa có gửi thông báo ngoài ứng dụng hoặc tự khôi phục.</p>
    {q.isPending && <p role="status">Đang kiểm tra cảnh báo…</p>}
    {q.isError && <p role="alert">Không đọc được cảnh báo; không coi là hệ thống bình thường.</p>}
    {data && <>
      <p className="text-xs text-muted-foreground">Quan sát: {data.checked_at} · mọi nguồn</p>
      {data.items.length===0 && <p>Không có cảnh báo trong lần kiểm tra này. Không chứng nhận dữ liệu đã xử lý đầy đủ.</p>}
      <ul className="space-y-2">{data.items.map(item=><li key={item.id} className={`rounded border p-3 ${item.level==='UNKNOWN'?'border-slate-300':'border-amber-400'}`}>
        <p className="font-medium">{item.level==='UNKNOWN'?'Chưa xác minh':'Cần kiểm tra'}{item.subject?` · ${item.subject}`:''}</p>
        <p className="text-sm">{messages[item.code]??'Chưa nhận diện được cảnh báo; kiểm tra API.'}</p>
      </li>)}</ul>
      <p className="text-xs text-muted-foreground">Nhắc hạn khóa trước {Math.round(data.policy.expiry_warning_seconds/3600)} giờ. Kiểm tra tối đa 200 khóa chưa thu hồi, ưu tiên hết hạn sớm;
        không khẳng định mọi khóa này đang được Prometheus sử dụng. Khóa được định danh bằng ID, không hiển thị secret.</p>
    </>}
  </section>
}
