/** Path belongs to manager (analytic) APIs — not admin/system/users. */
export function isShopApiPath(path) {
  if (path === "/api/chat") return true;
  if (path.startsWith("/api/chat/")) return false;
  return (
    path.startsWith("/api/overview")
    || path.startsWith("/api/events")
    || path.startsWith("/api/funnel")
    || path.startsWith("/api/products")
    || path.startsWith("/api/search")
    || path.startsWith("/api/banners")
    || path.startsWith("/api/revenue")
  );
}

/** Path belongs to admin APIs. */
export function isAdminApiPath(path) {
  return (
    path.startsWith("/api/system")
    || path.startsWith("/api/users")
    || path.startsWith("/api/chat/insights")
  );
}

/** Skip this mounted router when the path is handled elsewhere. */
export function skipUnlessZone(check) {
  return (req, res, next) => (check(req.path) ? next() : next("router"));
}
