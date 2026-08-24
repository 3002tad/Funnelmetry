/**
 * Auto banner_impression / banner_click per SPEC §banner analytics.
 * Mark elements: data-banner-id (required), optional data-banner-name, data-banner-position,
 * data-campaign-id, data-target-product-id, data-target-url.
 */
function bannerFromElement(el) {
  const ds = el.dataset;
  return {
    banner_id: ds.bannerId || ds.banner_id || "",
    banner_name: ds.bannerName || ds.banner_name,
    position: ds.bannerPosition || ds.banner_position || "unknown",
    campaign_id: ds.campaignId || ds.campaign_id,
    target_product_id: ds.targetProductId || ds.target_product_id,
    target_url: ds.targetUrl || ds.target_url || el.getAttribute("href") || undefined,
  };
}

export function createBannerTracking(sdk, options = {}) {
  const selector = options.selector || "[data-banner-id]";
  const minRatio = options.minVisibleRatio ?? 0.5;
  const dwellMs = options.minVisibleMs ?? 1000;
  const seenImpressions = new Set();
  const dwellTimers = new WeakMap();

  function clearDwell(el) {
    const t = dwellTimers.get(el);
    if (t) {
      clearTimeout(t);
      dwellTimers.delete(el);
    }
  }

  function scheduleImpression(el, ratio) {
    const banner = bannerFromElement(el);
    if (!banner.banner_id || seenImpressions.has(banner.banner_id)) return;

    clearDwell(el);
    const timer = setTimeout(() => {
      dwellTimers.delete(el);
      if (seenImpressions.has(banner.banner_id)) return;
      seenImpressions.add(banner.banner_id);
      sdk
        .trackBannerImpression({
          ...banner,
          viewport_visible_percent: Math.round(ratio * 100),
        })
        .catch(() => {});
    }, dwellMs);
    dwellTimers.set(el, timer);
  }

  const observer =
    typeof IntersectionObserver !== "undefined"
      ? new IntersectionObserver(
          (entries) => {
            for (const entry of entries) {
              const el = entry.target;
              if (entry.intersectionRatio >= minRatio && entry.isIntersecting) {
                scheduleImpression(el, entry.intersectionRatio);
              } else {
                clearDwell(el);
              }
            }
          },
          { threshold: [0, minRatio, 0.75, 1] }
        )
      : null;

  function observeAll(root = document) {
    if (!observer) return;
    root.querySelectorAll(selector).forEach((el) => observer.observe(el));
  }

  function onClick(event) {
    const el = event.target?.closest?.(selector);
    if (!el) return;
    const banner = bannerFromElement(el);
    if (!banner.banner_id) return;
    sdk.trackBannerClick(banner).catch(() => {});
  }

  return {
    start(root = document) {
      if (typeof window === "undefined") return () => {};
      observeAll(root);
      root.addEventListener("click", onClick, true);
      return () => {
        root.removeEventListener("click", onClick, true);
        observer?.disconnect();
      };
    },
    observeAll,
  };
}
