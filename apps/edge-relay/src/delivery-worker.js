function retryDelayMs(attemptCount, retryMinMs, retryMaxMs, random) {
  const exponential = Math.min(retryMaxMs, retryMinMs * (2 ** Math.max(0, attemptCount - 1)))
  const jitter = Math.floor(exponential * 0.2 * random())
  return Math.min(retryMaxMs, exponential + jitter)
}

export function createDeliveryWorker({
  repository,
  upstream,
  upstreamEnabled,
  instanceId,
  leaseMs,
  intervalMs,
  batchSize,
  retryMinMs,
  retryMaxMs,
  metrics,
  now = () => new Date().toISOString(),
  random = Math.random,
}) {
  let timer = null
  let running = false
  let connected = false
  let lastErrorCode = null
  let lastSuccessAt = null

  async function deliver(record) {
    try {
      const receipt = await upstream.forward(record)
      if (receipt.status === "accepted" || receipt.status === "duplicate") {
        const deliveredAt = now()
        repository.markDelivered({ relayId: record.relay_id, owner: instanceId, receipt, deliveredAt })
        metrics.increment("funnelmetry_relay_forward_attempt_total", { outcome: receipt.status })
        metrics.increment("funnelmetry_relay_delivery_lag_seconds_total", {}, Math.max(0, (Date.parse(deliveredAt) - Date.parse(record.relay_received_at)) / 1000))
        connected = true
        lastErrorCode = null
        lastSuccessAt = deliveredAt
        return
      }
      if (receipt.status === "rejected") {
        repository.markQuarantined({ relayId: record.relay_id, owner: instanceId, reasonCode: receipt.reason_code ?? "gateway_rejected" })
        metrics.increment("funnelmetry_relay_forward_attempt_total", { outcome: "rejected" })
        connected = true
        lastErrorCode = null
        return
      }
      throw new Error(receipt.reason_code ?? "gateway_retryable_failure")
    } catch (error) {
      const reasonCode = error instanceof Error && error.message ? error.message : "upstream_delivery_failed"
      const delay = retryDelayMs(record.attempt_count, retryMinMs, retryMaxMs, random)
      repository.markRetry({
        relayId: record.relay_id,
        owner: instanceId,
        nextAttemptAt: new Date(Date.parse(now()) + delay).toISOString(),
        reasonCode,
      })
      metrics.increment("funnelmetry_relay_forward_attempt_total", { outcome: "retryable_failure" })
      connected = false
      lastErrorCode = reasonCode
    }
  }

  async function tick() {
    if (!upstreamEnabled || running) return
    running = true
    try {
      const claimed = repository.claimDue({ now: now(), owner: instanceId, leaseMs, limit: batchSize })
      for (const record of claimed) await deliver(record)
    } finally {
      running = false
    }
  }

  function start() {
    if (!upstreamEnabled || timer) return
    timer = setInterval(() => { void tick() }, intervalMs)
    void tick()
  }

  function stop() {
    if (timer) clearInterval(timer)
    timer = null
  }

  function getStatus() {
    return {
      enabled: upstreamEnabled,
      connected: upstreamEnabled && connected,
      state: !upstreamEnabled ? "waiting_for_upstream" : connected ? "connected" : "retrying",
      last_error_code: lastErrorCode,
      last_success_at: lastSuccessAt,
    }
  }

  return Object.freeze({ start, stop, tick, getStatus })
}
