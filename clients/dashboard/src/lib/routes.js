/** Default landing after login */
export function homeForRole(role) {
  if (role === "super_admin" || role === "analyst") return "/shop";
  return "/shop";
}

export function isAdminRole(role) {
  return role === "super_admin" || role === "analyst";
}

const SHOP_PATHS = ["/shop", "/shop/revenue", "/shop/products", "/shop/funnel", "/shop/chat", "/shop/events", "/shop/search", "/shop/banners"];

export function canAccessAdmin(role, pathname) {
  if (!isAdminRole(role)) return false;
  if (!pathname.startsWith("/admin")) return false;
  if (role === "analyst" && pathname.startsWith("/admin/users")) return false;
  return true;
}

export function canAccessShop(_role, pathname) {
  return SHOP_PATHS.some((p) => pathname === p || (p !== "/shop" && pathname.startsWith(p)));
}
