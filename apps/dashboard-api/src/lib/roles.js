/** DB role values */
export const ROLE_ADMIN = "super_admin";
export const ROLE_ANALYST = "analyst";
export const ROLE_STAFF = "staff";
export const ASSIGNABLE_ROLES = Object.freeze([ROLE_ADMIN, ROLE_ANALYST, ROLE_STAFF]);
/** Legacy — treated as analyst for shop APIs */
export const ROLE_VIEWER = "viewer";

export const ADMIN_ROLES = [ROLE_ADMIN];
export const SHOP_ROLES = [ROLE_ANALYST, ROLE_STAFF, ROLE_VIEWER];

// Initial capability bundles for the currently supported database roles.
export const ROLE_PERMISSIONS = Object.freeze({
  super_admin: Object.freeze(['pipeline.monitor', 'integration.read', 'user.manage', 'role.manage', 'audit.read']),
  analyst: Object.freeze(['analytics.read', 'analytics.workspace.use', 'analytics.notes.write', 'chat.use', 'insight.read']),
  staff: Object.freeze(['analytics.read', 'chat.use', 'insight.read']),
  viewer: Object.freeze(['analytics.read', 'analytics.workspace.use']),
});
export function permissionsFor(role) { return ROLE_PERMISSIONS[role] ?? []; }
export function hasPermission(role, permission) { return permissionsFor(role).includes(permission); }

export function canAccessShop(role) {
  return hasPermission(role, 'analytics.read');
}

export function canAccessAdmin(role) {
  return hasPermission(role, 'user.manage');
}

/** Capability authorization is independent of module activation. */
export function canAccessChat(role) {
  return hasPermission(role, 'chat.use');
}
