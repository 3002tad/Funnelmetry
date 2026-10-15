import { Badge } from "./badge"

type Tone = "neutral" | "primary" | "success" | "warning" | "danger"

function statusTone(status: string): Tone {
  switch (status.toUpperCase()) {
    case "ACTIVE":
    case "RECONCILED":
      return "success"
    case "CONFIGURED":
    case "PROVISIONAL":
      return "primary"
    case "INSUFFICIENT_DATA":
    case "UNSUPPORTED":
      return "warning"
    case "BLOCKED_BY_QUALITY":
    case "QUARANTINED":
    case "INVALID":
    case "ERROR":
      return "danger"
    default:
      return "neutral"
  }
}

export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={statusTone(status)} dot>{status}</Badge>
}
