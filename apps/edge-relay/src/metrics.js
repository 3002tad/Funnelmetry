function escapeLabel(value) {
  return String(value).replaceAll("\\", "\\\\").replaceAll("\"", "\\\"").replaceAll("\n", "\\n")
}

export function createMetrics() {
  const counters = new Map()

  function key(name, labels) {
    const entries = Object.entries(labels ?? {}).sort(([left], [right]) => left.localeCompare(right))
    return `${name}|${entries.map(([label, value]) => `${label}=${value}`).join(",")}`
  }

  function increment(name, labels = {}, amount = 1) {
    const metricKey = key(name, labels)
    const current = counters.get(metricKey) ?? { name, labels, value: 0 }
    current.value += amount
    counters.set(metricKey, current)
  }

  function render(status) {
    const lines = []
    for (const counter of counters.values()) {
      const labels = Object.entries(counter.labels)
        .map(([name, value]) => `${name}="${escapeLabel(value)}"`)
        .join(",")
      lines.push(`${counter.name}${labels ? `{${labels}}` : ""} ${counter.value}`)
    }
    lines.push(`funnelmetry_relay_spool_bytes ${status.spool.spool_bytes}`)
    lines.push(`funnelmetry_relay_event_count ${status.spool.event_count}`)
    lines.push(`funnelmetry_relay_oldest_queued_age_seconds ${status.spool.oldest_queued_age_seconds}`)
    for (const [state, count] of Object.entries(status.spool.state_counts)) {
      lines.push(`funnelmetry_relay_spool_depth{state="${escapeLabel(state)}"} ${count}`)
    }
    lines.push(`funnelmetry_relay_upstream_enabled ${status.upstream.enabled ? 1 : 0}`)
    lines.push(`funnelmetry_relay_upstream_connected ${status.upstream.connected ? 1 : 0}`)
    return `${lines.join("\n")}\n`
  }

  return Object.freeze({ increment, render })
}
