import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../../auth/AuthContext'
import { Button } from '../../components/ui/button'
import { apiRequest } from '../../lib/api'

type ProviderSnapshot = {
  provider_id: string
  model_id: string
  region: string
  configuration_state: 'CONFIGURED' | 'DISABLED' | 'INVALID'
  diagnostic_code: string | null
  external_probe: false
  read_only: true
  checked_at: string
}

export default function ModelProviderPage() {
  const { user } = useAuth()
  const query = useQuery({
    queryKey: ['admin-model-provider', user?.id],
    queryFn: ({ signal }) => apiRequest<ProviderSnapshot>('/api/v2/admin/model-provider', { signal }),
    retry: false, gcTime: 0,
  })
  const snapshot = query.isError ? undefined : query.data
  return <div className="space-y-5">
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div><h1 className="text-2xl font-semibold">Model / Provider · trạng thái</h1>
        <p className="text-sm text-muted-foreground">Cấu hình Qwen của Dashboard API · chỉ đọc</p></div>
      <Button variant="outline" disabled={query.isFetching} onClick={() => void query.refetch()}>Làm mới</Button>
    </header>
    <p className="panel p-4">Trang này chỉ kiểm tra cấu hình của tiến trình API đang trả lời yêu cầu. Không gọi Alibaba Model Studio,
      không kiểm tra key còn hiệu lực, không chứng minh chat hoặc tool đang hoạt động. Không nhập API key vào UI.</p>
    {query.isPending && <p role="status">Đang kiểm tra…</p>}
    {query.isError && <p role="alert">Không đọc được trạng thái provider. Kiểm tra quyền và Dashboard API; không suy ra Qwen đã tắt.</p>}
    {snapshot && <section className="panel space-y-4 p-5">
      <p>Trạng thái cấu hình: <strong>{snapshot.configuration_state}</strong></p>
      <dl className="grid gap-3 sm:grid-cols-2">
        {[
          ['Provider', snapshot.provider_id], ['Model', snapshot.model_id],
          ['Region', snapshot.region], ['Kiểm tra lúc', snapshot.checked_at],
        ].map(([label, value]) => <div className="rounded-lg border p-3" key={label}>
          <dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 break-all text-sm">{value}</dd>
        </div>)}
      </dl>
      {snapshot.diagnostic_code && <p>Mã cấu hình cần kiểm tra: <code>{snapshot.diagnostic_code}</code>. Giá trị key và endpoint được ẩn.</p>}
      {snapshot.configuration_state === 'CONFIGURED' && <p className="text-sm text-muted-foreground">Đã bật cờ và cấu hình hợp lệ về mặt cú pháp; trạng thái kết nối, quota và kết quả trả lời vẫn chưa được xác minh.</p>}
      {snapshot.configuration_state === 'DISABLED' && <p className="text-sm text-muted-foreground">Qwen đang tắt trong cấu hình runtime của API này.</p>}
    </section>}
    <p className="text-sm text-muted-foreground">Đổi cấu hình trong <code>runtime/deploy.env</code> của máy triển khai rồi chạy lại deployment theo runbook. UI này không ghi secret và không thay đổi cấu hình.</p>
  </div>
}
