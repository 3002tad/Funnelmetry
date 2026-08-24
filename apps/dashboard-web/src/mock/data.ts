import type { AnalyticsEvent, FunnelStageData } from "../types/analytics"

export const funnelStages: FunnelStageData[] = [
  { name: "Product Viewed", sessions: 12480, reached: 100, transition: 67.4, dropoff: 4068, pending: 86 },
  { name: "Cart Item Added", sessions: 8412, reached: 67.4, transition: 61.2, dropoff: 3264, pending: 142 },
  { name: "Checkout Started", sessions: 5148, reached: 41.3, transition: 72.8, dropoff: 1400, pending: 317 },
  { name: "Order Accepted", sessions: 3748, reached: 30.0, transition: 100, dropoff: 0, pending: 0 },
]

export const events: AnalyticsEvent[] = [
  { name: "behavior.product_viewed", timestamp: "11:42:08.281", session: "ses_8A21", journey: "journey_10021", source: "web-sdk", kind: "Behavior", validation: "Valid", authority: "Observed", projection: "Live / Provisional" },
  { name: "cart.item_added", timestamp: "11:41:54.922", session: "ses_2F18", journey: "journey_10308", source: "medusa-webhook", kind: "Commerce", validation: "Valid", authority: "Authoritative", projection: "Reconciled" },
  { name: "checkout.started", timestamp: "11:41:31.108", session: "ses_8A21", journey: "journey_10021", source: "web-sdk", kind: "Behavior", validation: "Warning", authority: "Observed", projection: "Live / Provisional" },
  { name: "payment.failed", timestamp: "11:40:48.701", session: "ses_19CE", journey: "journey_10277", source: "medusa-webhook", kind: "Commerce", validation: "Valid", authority: "Authoritative", projection: "Matured" },
  { name: "payment.captured", timestamp: "11:40:12.402", session: "ses_4D11", journey: "journey_10098", source: "medusa-webhook", kind: "Commerce", validation: "Valid", authority: "Authoritative", projection: "Reconciled" },
  { name: "order.accepted", timestamp: "11:39:58.114", session: "ses_4D11", journey: "journey_10098", source: "medusa-subscriber", kind: "Commerce", validation: "Valid", authority: "Authoritative", projection: "Reconciled" },
]

export const products = [
  { id: "prod_401", name: "Cloud Runner Pro", category: "Footwear", revenue: 48290, views: 12480, cart: 1924, conversion: 8.4, trend: 18.2 },
  { id: "prod_119", name: "Everyday Tote", category: "Accessories", revenue: 34120, views: 8940, cart: 1430, conversion: 7.1, trend: 9.7 },
  { id: "prod_208", name: "Merino Layer", category: "Apparel", revenue: 29880, views: 7620, cart: 1218, conversion: 6.8, trend: -2.1 },
  { id: "prod_552", name: "Studio Headphones", category: "Electronics", revenue: 24640, views: 5810, cart: 920, conversion: 7.9, trend: 12.4 },
  { id: "prod_318", name: "Transit Pack", category: "Accessories", revenue: 18320, views: 4920, cart: 701, conversion: 6.2, trend: 4.3 },
]

export const journeySessions = [
  { id: "ses_31K2", day: "Aug 14", label: "Session 1", meta: "Organic · Mobile · 3m 42s", outcome: "Browsed", events: ["session.started", "behavior.product_viewed", "session.ended"] },
  { id: "ses_8A21", day: "Aug 16", label: "Session 2", meta: "Paid social · Mobile · 8m 14s", outcome: "Checkout abandoned", events: ["session.started", "behavior.product_viewed", "cart.item_added", "checkout.started", "session.ended"] },
  { id: "ses_9BC4", day: "Aug 21", label: "Session 3", meta: "Direct · Desktop · 5m 08s", outcome: "Converted", events: ["cart.restored", "checkout.started", "payment.captured", "order.accepted"] },
]

export const insights = [
  { title: "Mobile users drop heavily before checkout", text: "Mobile journeys lose 18.4% more users between cart and checkout than desktop.", impact: "High", confidence: 94, segment: "Mobile · New customers", cta: "View funnel" },
  { title: "Paid social creates intent, not orders", text: "Paid social drives 26% of product views but only 11% of accepted orders.", impact: "High", confidence: 88, segment: "Paid social", cta: "Explore journeys" },
  { title: "Returning journeys convert later", text: "31% of converted journeys complete in a later session, typically within seven days.", impact: "Medium", confidence: 91, segment: "Returning visitors", cta: "Explore journeys" },
  { title: "Payment failure is not always funnel failure", text: "19% of journeys with a failed attempt later reach payment captured through another attempt.", impact: "Medium", confidence: 86, segment: "Online payment", cta: "View funnel" },
]
