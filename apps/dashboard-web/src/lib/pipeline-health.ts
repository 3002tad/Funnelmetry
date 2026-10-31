export type PipelineHealth = {
  source_id: string
  checked_at: string
  runtime_status: string
  metrics: {
    accepted: number
    terminal: number
    canonical: number
    kpi_applications: number
    pending_claims: number
    last_canonical_at: string | null
    last_kpi_at: string | null
  }
  unavailable: string[]
}

export function parsePipelineHealth(value: unknown): PipelineHealth {
  if (!value || typeof value !== 'object') throw new Error('Invalid pipeline health response')
  const snapshot = value as Partial<PipelineHealth>
  const metrics = snapshot.metrics
  if (typeof snapshot.checked_at !== 'string' || !metrics ||
    !['accepted', 'terminal', 'canonical', 'kpi_applications', 'pending_claims'].every(
      key => Number.isFinite(metrics[key as keyof typeof metrics]),
    ) || !Array.isArray(snapshot.unavailable)) {
    throw new Error('Invalid pipeline health response')
  }
  return snapshot as PipelineHealth
}
