/** DB role values */
export const ROLE_ADMIN = "super_admin";
export const ROLE_ANALYST = "analyst";
/** Legacy — treated as analyst for shop APIs */
export const ROLE_VIEWER = "viewer";

export const ADMIN_ROLES = [ROLE_ADMIN];
export const SHOP_ROLES = [ROLE_ANALYST, ROLE_VIEWER];

export function canAccessShop(role) {
  return SHOP_ROLES.includes(role);
}

export function canAccessAdmin(role) {
  return ADMIN_ROLES.includes(role);
}

/** Chat analytics — both admin and analyst UIs. */
export function canAccessChat(role) {
  return canAccessShop(role) || canAccessAdmin(role);
}
