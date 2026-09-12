export const INGRESS_EVENT_SPEC_VERSION: "ingress-event.v1"
export const RELAY_RECEIPT_SPEC_VERSION: "relay-receipt.v1"
export const RECEIPT_STATUSES: readonly ["accepted", "duplicate", "rejected", "retryable_failure"]
export const RELAY_RECEIPT_STATUSES: readonly ["relay_queued"]

export type ReceiptStatus = (typeof RECEIPT_STATUSES)[number]
export type RelayReceiptStatus = (typeof RELAY_RECEIPT_STATUSES)[number]

export interface IngressEvent {
  specversion: "ingress-event.v1"
  source_id: string
  event_id: string
  source_event_type: string
  source_schema_version: string
  occurred_at?: string
  produced_at?: string
  producer: string
  anonymous_id?: string
  session_id?: string
  correlation_id?: string
  aggregate?: { type: string; id: string; version?: string }
  source_payload: Record<string, unknown>
  source_metadata?: Record<string, unknown>
}

export interface IngressReceipt {
  status: ReceiptStatus
  source_id: string
  event_id: string
  received_at: string
  ingestion_id?: string
  ingestion_attempt_id?: string
  reason_code?: string
}

export interface RelayReceipt {
  specversion: "relay-receipt.v1"
  status: RelayReceiptStatus
  relay_id: string
  source_id: string
  event_id: string
  relay_received_at: string
}

export function validateIngressEvent(input: unknown, options?: { maxPayloadBytes?: number; requireOccurredAt?: boolean }): Readonly<IngressEvent>
export function createIngressEvent(input: unknown, options?: { maxPayloadBytes?: number; requireOccurredAt?: boolean }): Readonly<IngressEvent>
export function validateIngressReceipt(input: unknown): Readonly<IngressReceipt>
export function validateRelayReceipt(input: unknown): Readonly<RelayReceipt>
export function isTerminalReceipt(status: ReceiptStatus): boolean
