/** Default landing after login */
export function homeForRole(role) {
  if (role === "super_admin") return "/admin";
  if (isAnalystRole(role)) return "/shop";
  return "/login";
}

export function resolvePostLoginPath(role, dest) {
  if (dest?.startsWith("/admin") && canAccessAdmin(role, dest)) return dest;
  if (dest?.startsWith("/shop") && canAccessShop(role, dest)) return dest;
  return homeForRole(role);
}

export function isAdminRole(role) {
  return role === "super_admin";
}

export function isAnalystRole(role) {
  return role === "analyst" || role === "viewer";
}

const SHOP_PATHS = [
  "/shop",
  "/shop/revenue",
  "/shop/products",
  "/shop/funnel",
  "/shop/chat",
  "/shop/events",
  "/shop/search",
  "/shop/banners",
];

export function canAccessAdmin(role, pathname) {
  if (!isAdminRole(role)) return false;
  return pathname.startsWith("/admin");
}

export function canAccessShop(role, pathname) {
  if (!isAnalystRole(role)) return false;
  return SHOP_PATHS.some((p) => pathname === p || (p !== "/shop" && pathname.startsWith(p)));
}
