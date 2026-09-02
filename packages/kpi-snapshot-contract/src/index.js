import { createHash } from "node:crypto"

function iso(value) {
  return value === null || value === undefined ? null : new Date(value).toISOString()
}

export function buildKpiSnapshot(instance, steps, branches) {
  if (!instance || !Array.isArray(steps) || !Array.isArray(branches)) {
    throw new Error("Complete KPI snapshot rows are required")
  }
  return Object.freeze({
    funnel_instance_id: instance.funnel_instance_id,
    source_id: instance.source_id,
    journey_id: instance.journey_id,
    funnel_profile_id: instance.funnel_profile_id,
    profile_version: instance.profile_version,
    entry_at: iso(instance.entry_at),
    conversion_deadline: iso(instance.conversion_deadline),
    outcome_status: instance.outcome_status,
    quality_status: instance.quality_status,
    converted_at: iso(instance.converted_at),
    reached_step_count: steps.length,
    total_step_count: Number(instance.total_step_count),
    branch_count: branches.length,
    steps: steps.map((step) => ({
      step_index: step.step_index,
      step_id: step.step_id,
      event_type: step.event_type,
      first_reached_at: iso(step.first_reached_at),
      last_reached_at: iso(step.last_reached_at),
      occurrence_count: Number(step.occurrence_count),
    })),
    branches: branches.map((branch) => ({
      canonical_event_id: branch.canonical_event_id,
      event_type: branch.event_type,
      occurred_at: iso(branch.occurred_at),
      branch_kind: branch.branch_kind,
    })),
  })
}

export function hashKpiSnapshot(snapshot) {
  return createHash("sha256").update(JSON.stringify(snapshot)).digest("hex")
}
