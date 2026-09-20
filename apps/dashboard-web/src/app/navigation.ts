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
  { label: 'OVERVIEW', items: [analytics('/overview', 'Overview')] },
  { label: 'ANALYZE', items: [
    analytics('/workspace', 'Data Workspace', 'Cần kết nối kế hoạch phân tích, thực thi công cụ và bằng chứng có nguồn gốc. Chat hiện tại chưa đáp ứng toàn bộ quy trình này.'),
    analytics('/analysis-runs', 'Analysis Runs', 'Chưa có API lưu và truy xuất Analysis Run cùng lịch sử thực thi. Lịch sử chat không thay thế Analysis Run.'),
    analytics('/evidence', 'Evidence Explorer', 'Chưa có API tra cứu bằng chứng cùng phiên bản công cụ, metric và analytical asset.'),
  ] },
  { label: 'EXPLORE', items: [
    analytics('/funnels', 'Funnels'), analytics('/journeys', 'Journeys'),
    analytics('/products', 'Products', 'Chưa kết nối analytical asset và metric sản phẩm. Không hiển thị doanh thu hoặc biểu đồ mẫu như dữ liệu thật.'),
    analytics('/traffic', 'Traffic', 'Chưa kết nối analytical asset và metric nguồn truy cập.'),
    analytics('/campaigns', 'Campaigns', 'Chưa kết nối analytical asset và metric chiến dịch.'),
  ] },
  { label: 'DATA', items: [
    analytics('/metrics', 'Metrics', 'Chưa có API Metric Catalog để tra cứu công thức, grain, time basis và phiên bản.'),
    analytics('/assets', 'Analytical Assets', 'Chưa có API Analytical Asset Catalog để tra cứu nguồn, grain, chất lượng và quan hệ dữ liệu.'),
  ] },
  { label: 'KNOWLEDGE', items: [
    analytics('/findings', 'Findings', 'Chưa có API finding liên kết Analysis Run và evidence. Không sử dụng các insight mẫu trước đây.'),
    analytics('/reports', 'Reports', 'Chưa có API báo cáo phân biệt finding, bằng chứng, diễn giải và giới hạn phân tích.'),
  ] },
  { label: 'CURRENT TOOLS', items: [
    analytics('/events', 'Events'), analytics('/data-health', 'Data Health'),
    { path: '/chat', label: 'AI Chat · hiện tại', permission: 'chat.use' },
  ] },
  { label: 'SYSTEM', items: [
    admin('pipeline', 'System Health'),
    admin('recovery', 'Recovery / Auto-Healing', 'Chưa kết nối watchdog và lịch sử phục hồi. Không có thao tác khởi động lại hoặc điều khiển Docker tại đây.'),
    admin('resources', 'Host / Container Resources', 'Chưa kết nối telemetry tài nguyên host/container. Không hiển thị số liệu giả hoặc claim tự động mở rộng tài nguyên.'),
    admin('audit', 'Audit / Recovery History', 'Chưa kết nối API lịch sử audit và phục hồi hệ thống.'),
  ] },
  { label: 'INGESTION', items: [
    admin('sources', 'Source Ingress / Sources', undefined, 'integration.read'),
    admin('event-feed', 'Durable Event Log / Event Feed', 'Chưa kết nối màn hình availability và retention boundary của Event Feed.'),
    admin('connector', 'Source Connector / Cursor / Lag', 'Chưa kết nối API cursor, lag và catch-up. Pipeline chủ động pull HTTPS Event Feed; đây không phải Relay push.'),
    admin('processing', 'Kafka / Processing Lag', 'Chưa kết nối API consumer lag và lỗi xử lý từng stage.'),
    admin('quarantine', 'Rejected / DLQ / Quarantine', 'Chưa kết nối màn hình quản trị bản ghi bị từ chối/cách ly và thao tác replay có kiểm soát.'),
  ] },
  { label: 'GOVERNANCE', items: [
    admin('schemas', 'Schemas / Mappings', 'Chưa có giao diện quản trị phiên bản schema và mapping.'),
    admin('metadata', 'Metadata Catalog', 'Chưa có giao diện quản trị semantic metadata.'),
    admin('metric-catalog', 'Metric / Dimension / Relationship Catalog', 'Chưa có giao diện quản trị catalog và audit thay đổi.'),
    admin('recipes', 'Analysis Recipes', 'Chưa có giao diện quản trị recipe và compatibility.'),
    admin('tools', 'Tool Registry', 'Chưa có giao diện quản trị công cụ và phiên bản.'),
  ] },
  { label: 'AI / OBSERVABILITY', items: [
    admin('agent', 'Agent Observability', 'Chưa kết nối telemetry Agent và tool execution.'),
    admin('run-diagnostics', 'Analysis Run Diagnostics', 'Chưa kết nối chẩn đoán lỗi, retry và re-plan theo Analysis Run.'),
    admin('model-provider', 'Model / Provider Configuration', 'Chưa có API cấu hình provider có phân quyền và audit. Không nhập API key vào trang này.'),
  ] },
  { label: 'ACCESS / SETTINGS', items: [
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
