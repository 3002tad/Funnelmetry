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
  { label: 'PHÂN TÍCH', items: [
    analytics('/overview', 'Tổng quan'), analytics('/funnels', 'Hành trình chuyển đổi'),
    analytics('/products', 'Sản phẩm'), analytics('/events', 'Sự kiện'), analytics('/data-health', 'Chất lượng dữ liệu'),
  ] },
  { label: 'QUẢN TRỊ', items: [
    admin('pipeline', 'Tổng quan Pipeline'), admin('scaling', 'Auto Scaling'), admin('recovery', 'Health & Recovery'),
    admin('sources', 'Nguồn dữ liệu', undefined, 'integration.read'), admin('investigate', 'Điều tra sự kiện'),
    admin('users', 'Tài khoản & phân quyền', undefined, 'user.manage'), admin('audit', 'Audit tài khoản', undefined, 'audit.read'),
  ] },
]
export function visibleNavigation(permissions: readonly string[]): NavigationGroup[] {
  return navigation.map(group => ({ ...group, items: group.items.filter(item =>
    permissions.includes(item.permission) && (item.path !== '/traffic' || permissions.includes('analytics.read')),
  ) })).filter(group => group.items.length > 0)
}

export const primaryPaths = new Set([
  '/overview', '/funnels', '/products', '/events', '/data-health', '/settings',
  '/admin/pipeline', '/admin/processing',
])

export function displayedNavigation(groups: NavigationGroup[], expanded: boolean, currentPath: string): NavigationGroup[] {
  if (expanded) return groups
  return groups.map(group => ({
    ...group,
    items: group.items.filter(item => primaryPaths.has(item.path) || item.path === currentPath),
  })).filter(group => group.items.length > 0)
}
