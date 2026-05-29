# browser-behavior-sdk

**Spec:** Capture `page_view`, `product_view`, `product_click`, `scroll_depth`, `search`, `banner_impression`, `banner_click` → POST Tracking API.

**Required fields:** `anonymous_id`, `session_id`; optional `user_id` after login.

**Banner auto-tracking:** mark DOM with `data-banner-id` (and optional `data-banner-name`, `data-banner-position`, `data-campaign-id`, `data-target-product-id`), then `sdk.initBannerTracking()` — impression when ≥50% visible for 1s, click on interaction.

**Schema:** [SPEC.md](../../docs/SPEC.md) §5.
