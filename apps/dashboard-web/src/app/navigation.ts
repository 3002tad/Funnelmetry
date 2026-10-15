export type NavigationItem = {
  path: string
  label: string
  permission: string
  unavailable?: string
}
export type NavigationGroup = { label: string; items: NavigationItem[] }

const analytics = (path: string, label: string, unavailable?: string): NavigationItem =>
  ({ path, label, permission: 'analytics.read', unavailable })
const admin = (path: string, label: string, unavailable?: string, permission = 'pipeline.monitor'): NavigationItem =>
  ({ path: `/admin/${path}`, label, permission, unavailable })

// Availability reflects implemented screens, not backend service health.
// Optional evaluation capabilities are deliberately absent until implemented.
export const navigation: NavigationGroup[] = [
  { label: 'BẮT ĐẦU', items: [analytics('/overview', 'Tổng quan')] },
  { label: 'PHÂN TÍCH', items: [
    analytics('/workspace', 'Data Workspace'),
    analytics('/analysis-runs', 'Analysis Runs'),
    analytics('/evidence', 'Evidence Explorer'),
  ] },
  { label: 'KHÁM PHÁ', items: [
    analytics('/funnels', 'Hành trình chuyển đổi'), analytics('/journeys', 'Hành trình'),
    analytics('/products', 'Sản phẩm'),
    { path: '/traffic', label: 'Traffic · UTM input', permission: 'analytics.workspace.use' },
    analytics('/campaigns', 'Campaigns', 'Chưa kết nối analytical asset và metric chiến dịch.'),
  ] },
  { label: 'DỮ LIỆU', items: [
    analytics('/metrics', 'Metrics'),
    analytics('/assets', 'Analytical Assets'),
  ] },
  { label: 'KẾT QUẢ', items: [
    analytics('/findings', 'Findings · đánh giá DA'),
    analytics('/reports', 'Reports · bản xem'),
  ] },
  { label: 'CÔNG CỤ', items: [
    analytics('/events', 'Sự kiện'), analytics('/data-health', 'Chất lượng dữ liệu'),
    { path: '/chat', label: 'AI Chat · hiện tại', permission: 'chat.use' },
  ] },
  { label: 'HỆ THỐNG', items: [
    admin('pipeline', 'Tình trạng Pipeline'),
    admin('recovery', 'Recovery / Auto-Healing', 'Chưa kết nối watchdog và lịch sử phục hồi. Không có thao tác khởi động lại hoặc điều khiển Docker tại đây.'),
    admin('resources', 'Host / Container Resources', 'Chưa kết nối telemetry tài nguyên host/container. Không hiển thị số liệu giả hoặc claim tự động mở rộng tài nguyên.'),
    admin('audit', 'Audit tài khoản', undefined, 'audit.read'),
  ] },
  { label: 'TIẾP NHẬN', items: [
    admin('sources', 'Source Ingress / Sources', undefined, 'integration.read'),
    admin('event-feed', 'Event Feed · quan sát nguồn'),
    admin('event-trace', 'Event Trace · theo ID'),
    admin('connector', 'Source Connector / Cursor'),
    admin('processing', 'Processing · dữ liệu đã lưu'),
    admin('quarantine', 'Quarantine / Unsupported'),
  ] },
  { label: 'QUẢN TRỊ DỮ LIỆU', items: [
    admin('schemas', 'Schemas / Mappings', undefined, 'integration.read'),
    admin('metadata', 'Metadata Catalog', undefined, 'integration.read'),
    admin('metric-catalog', 'Metric / Dimension / Relationship Catalog', undefined, 'integration.read'),
    admin('recipes', 'Analysis Recipes', 'Chưa có giao diện quản trị recipe và compatibility.'),
    admin('tools', 'Tool Registry', undefined, 'integration.read'),
  ] },
  { label: 'AI / GIÁM SÁT', items: [
    admin('agent', 'Agent Observability · tool evidence'),
    admin('run-diagnostics', 'Analysis Run Diagnostics'),
    admin('model-provider', 'Model / Provider · trạng thái'),
  ] },
  { label: 'QUYỀN / THIẾT LẬP', items: [
    admin('users', 'Users / Roles', undefined, 'user.manage'),
    admin('integration-settings', 'Secrets / Integration Settings', 'Chưa có API quản lý cấu hình tích hợp và secret an toàn.'),
    admin('system-settings', 'System Settings', 'Chưa có API thay đổi cấu hình hệ thống có audit.'),
  ] },
]

export function visibleNavigation(permissions: readonly string[]): NavigationGroup[] {
  return navigation.map(group => ({ ...group, items: group.items.filter(item =>
    permissions.includes(item.permission) && (item.path !== '/chat' || permissions.includes('analytics.read')),
  ) })).filter(group => group.items.length > 0)
}
