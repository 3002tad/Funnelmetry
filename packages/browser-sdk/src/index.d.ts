export interface BrowserSdkOptions {
  sourceId: string
  sourceKeyId: string
  endpoint: string
  writeKey: string
  allowedEventTypes: string[]
  maxAttempts?: number
  maxQueueSize?: number
  hasConsent?: () => boolean
  createPageInstanceId?: () => string
}

export interface BrowserEventContext {
  occurredAt?: string
  anonymousId?: string
  sessionId?: string
  correlationId?: string
  metadata?: Record<string, unknown>
}

export interface PageContextInput {
  page_type: string
  path_template: string
  page_instance_id?: string
}

export interface PageContext {
  page_type: string
  path_template: string
  page_instance_id: string
}

export interface ScrollPageIdentity {
  page_type: string
  page_instance_id: string
}

export interface BrowserSdk {
  track(sourceEventType: string, sourcePayload: Record<string, unknown>, context?: BrowserEventContext): Promise<{ status: string }>
  trackBehavior(sourceEventType: string, sourcePayload: Record<string, unknown>, context?: BrowserEventContext): Promise<{ status: string }>
  createPageContext(page: PageContextInput): PageContext
  trackPageView(page: PageContextInput, context?: BrowserEventContext): Promise<{ status: string }>
  trackScrollDepth(page: ScrollPageIdentity, depthPercent: 25 | 50 | 75 | 100, context?: BrowserEventContext): Promise<{ status: string }>
  attachScrollDepthObserver(options: {
    page: ScrollPageIdentity
    milestones?: Array<25 | 50 | 75 | 100>
    context?: BrowserEventContext
    emitInitial?: boolean
    window?: Window
    document?: Document
  }): () => void
  trackBannerClick(payload: Record<string, unknown>, context?: BrowserEventContext): Promise<{ status: string }>
  attachBannerImpressionObserver(options: {
    element: Element
    bannerId: string
    placementId: string
    pageInstanceId: string
    campaignId?: string
    dwellMs?: number
    context?: BrowserEventContext
  }): () => void
  flush(): Promise<{ status: string }>
  attachLifecycle(): () => void
  getMetrics(): Record<string, number>
}

export function createBrowserSdk(options: BrowserSdkOptions): BrowserSdk
