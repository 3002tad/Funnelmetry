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
    lines.push(`funnelmetry_source_event_log_bytes ${status.event_log.event_log_bytes}`)
    lines.push(`funnelmetry_source_event_log_records ${status.event_log.event_count}`)
    lines.push(`funnelmetry_source_event_log_oldest_event_age_seconds ${status.event_log.oldest_event_age_seconds}`)
    lines.push(`funnelmetry_source_event_log_latest_ingress_seq ${status.event_log.latest_ingress_seq}`)
    lines.push(`funnelmetry_source_event_log_retention_floor_seq ${status.event_log.retention_floor_seq}`)
    return `${lines.join("\n")}\n`
  }

  return Object.freeze({ increment, render })
}
