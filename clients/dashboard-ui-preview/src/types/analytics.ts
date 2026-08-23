export type ProjectionState = "Live / Provisional" | "Matured" | "Reconciled" | "Degraded"
export type EventKind = "Behavior" | "Commerce"

export type AnalyticsEvent = {
  name: string
  timestamp: string
  session: string
  journey: string
  source: string
  kind: EventKind
  validation: "Valid" | "Warning" | "Invalid"
  authority: "Observed" | "Authoritative"
  projection: ProjectionState
}

export type FunnelStageData = {
  name: string
  sessions: number
  reached: number
  transition: number
  dropoff: number
  pending: number
}
