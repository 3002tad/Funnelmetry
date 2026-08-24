export interface BrowserSdkOptions {
  sourceId: string
  sourceKeyId: string
  endpoint: string
  writeKey: string
  allowedEventTypes: string[]
  maxAttempts?: number
  maxQueueSize?: number
  hasConsent?: () => boolean
}

export interface BrowserSdk {
  track(sourceEventType: string, sourcePayload: Record<string, unknown>, context?: {
    occurredAt?: string
    anonymousId?: string
    sessionId?: string
    correlationId?: string
    metadata?: Record<string, unknown>
  }): Promise<{ status: string }>
  flush(): Promise<{ status: string }>
  attachLifecycle(): () => void
  getMetrics(): Record<string, number>
}

export function createBrowserSdk(options: BrowserSdkOptions): BrowserSdk
