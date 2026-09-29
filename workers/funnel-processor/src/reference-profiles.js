export const REFERENCE_FUNNEL_PROFILES = Object.freeze([
  Object.freeze({
    funnel_profile_id: "commerce-conversion",
    profile_version: "2.0.0",
    display_name: "Commerce conversion",
    subject_scope: "JOURNEY",
    entry_event_type: "behavior.product_viewed",
    conversion_horizon_seconds: null,
    late_arrival_grace_seconds: null,
    ordered_steps: Object.freeze([
      Object.freeze({ step_id: "product-viewed", event_type: "behavior.product_viewed", event_class: "BEHAVIOR_INTENT" }),
      Object.freeze({ step_id: "item-added", event_type: "cart.item_added", event_class: "BUSINESS_FACT" }),
      Object.freeze({ step_id: "checkout-started", event_type: "checkout.started", event_class: "BEHAVIOR_INTENT" }),
      Object.freeze({ step_id: "order-placed", event_type: "order.placed", event_class: "BUSINESS_FACT" }),
    ]),
    negative_events: Object.freeze([]),
  }),
  Object.freeze({
    funnel_profile_id: "online-payment",
    profile_version: "1.0.0",
    display_name: "Online payment",
    subject_scope: "JOURNEY",
    entry_event_type: "order.created",
    conversion_horizon_seconds: null,
    late_arrival_grace_seconds: null,
    ordered_steps: Object.freeze([
      Object.freeze({ step_id: "order-created", event_type: "order.created", event_class: "BUSINESS_FACT" }),
      Object.freeze({ step_id: "payment-attempted", event_type: "payment.attempted", event_class: "BUSINESS_FACT" }),
      Object.freeze({ step_id: "payment-captured", event_type: "payment.captured", event_class: "BUSINESS_FACT" }),
    ]),
    negative_events: Object.freeze([]),
  }),
])
