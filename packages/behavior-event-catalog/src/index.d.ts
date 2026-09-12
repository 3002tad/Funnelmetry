export const BEHAVIOR_EVENT_CATALOG_VERSION: "behavior-event-catalog.v1"
export const BEHAVIOR_EVENT_TYPES: readonly BehaviorEventType[]
export const SCROLL_DEPTH_MILESTONES: readonly [25, 50, 75, 100]

export type BehaviorEventType =
  | "behavior.page_viewed"
  | "behavior.scroll_depth_reached"
  | "promotion.banner_impression"
  | "promotion.banner_clicked"
  | "behavior.search_submitted"
  | "behavior.filter_applied"
  | "behavior.product_viewed"
  | "cart.add_clicked"
  | "checkout.started"

export type BehaviorEventClass = "CLIENT_OBSERVATION" | "BEHAVIOR_INTENT"

export interface BehaviorEventDefinition {
  event_class: BehaviorEventClass
}

export const BEHAVIOR_EVENT_DEFINITIONS: Readonly<Record<BehaviorEventType, Readonly<BehaviorEventDefinition>>>

export interface ValidatedBehaviorEvent {
  catalog_version: "behavior-event-catalog.v1"
  event_type: BehaviorEventType
  event_class: BehaviorEventClass
  data: Readonly<Record<string, unknown>>
}

export function isBehaviorEventType(eventType: unknown): eventType is BehaviorEventType
export function getBehaviorEventDefinition(eventType: BehaviorEventType): Readonly<BehaviorEventDefinition>
export function validateBehaviorPayload(eventType: BehaviorEventType, payload: unknown): Readonly<Record<string, unknown>>
export function validateBehaviorEvent(eventType: BehaviorEventType, payload: unknown): Readonly<ValidatedBehaviorEvent>
