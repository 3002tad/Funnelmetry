import type { IngressReceipt } from "@3002tad/funnelmetry-input-contract"

export interface MappedSourceEvent {
  eventId: string
  sourceEventType: string
  sourceSchemaVersion?: string
  occurredAt: string
  producedAt?: string
  aggregate?: { type: string; id: string; version?: string }
  correlationId?: string
  sourcePayload: Record<string, unknown>
  sourceMetadata?: Record<string, unknown>
}

export interface BackendForwarder {
  forward(event: MappedSourceEvent): Promise<IngressReceipt | { status: "retryable_failure" | "rejected"; reason_code?: string }>
  getMetrics(): Record<string, number>
}

export function createBackendForwarder(options: {
  sourceId: string
  sourceKeyId: string
  endpoint: string
  signingKey: string
  timeoutMs?: number
  maxAttempts?: number
  logger?: { warn(entry: unknown): void }
}): BackendForwarder
