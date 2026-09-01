/** Path belongs to manager (analytic) APIs — not admin/system/users. */
/** POST /api/chat and session history — shared analytics (not shop-only). */
export function isChatApiPath(path) {
  return path === "/api/chat" || path.startsWith("/api/chat/sessions");
}

export function isShopApiPath(path) {
  if (isChatApiPath(path)) return false;
  return (
    path.startsWith("/api/v2/analytics")
    || path.startsWith("/api/overview")
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
