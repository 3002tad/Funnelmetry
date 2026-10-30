// Read-only, shadow-only funnel candidate. It never publishes a Funnel Profile
// or aliases the retractable CDC terminal to canonical order.placed.
import { isDeepStrictEqual } from 'node:util'
import { REFERENCE_CDC_PROFILE_V2 as profile } from './reference-cdc-profile-v2.js'

const ACTIVE_BINDING_SQL = `SELECT b.source_instance_id,b.coverage_epoch_id,
  b.activation_at,b.state,b.activated_at,b.updated_at,
  r.profile_id,r.profile_version,r.contract_id,r.metric_id,r.definition
  FROM reference_cdc_v2_profile_bindings b
  JOIN reference_cdc_v2_profile_releases r
    ON r.profile_id=b.profile_id AND r.profile_version=b.profile_version
  WHERE b.source_instance_id=$1 AND b.profile_id=$2 AND b.profile_version=$3`
const QUALITY_SQL = `SELECT status,baseline_complete,historical_gap_status,
  verified_at,valid_until
  FROM reference_cdc_v2_quality_state
  WHERE source_instance_id=$1 AND coverage_epoch_id=$2`

export const FUNNEL_CANDIDATE_SQL = `WITH events AS (
  SELECT je.journey_id,c.event_type,c.occurred_at
  FROM journey_events je
  JOIN canonical_events c ON c.canonical_event_id=je.canonical_event_id
  WHERE c.source_id=$1 AND c.event_type IN
    ('behavior.product_viewed','cart.item_added','checkout.started')
), entries AS (
  SELECT journey_id,min(occurred_at) AS entry_at FROM events
  WHERE event_type='behavior.product_viewed' AND occurred_at >= $3::timestamptz
  GROUP BY journey_id
), cohort AS (
  SELECT * FROM entries
  WHERE ($4::timestamptz IS NULL OR entry_at >= $4::timestamptz)
    AND ($5::timestamptz IS NULL OR entry_at < $5::timestamptz)
), added AS (
  SELECT e.journey_id,min(e.occurred_at) AS added_at
  FROM events e JOIN cohort c ON c.journey_id=e.journey_id
  WHERE e.event_type='cart.item_added' AND e.occurred_at >= c.entry_at
  GROUP BY e.journey_id
), checkout AS (
  SELECT e.journey_id,min(e.occurred_at) AS checkout_at
  FROM events e JOIN added a ON a.journey_id=e.journey_id
  WHERE e.event_type='checkout.started' AND e.occurred_at >= a.added_at
  GROUP BY e.journey_id
), recorded AS (
  SELECT DISTINCT t.journey_id
  FROM reference_cdc_v2_funnel_terminal_candidate t
  JOIN checkout ch ON ch.journey_id=t.journey_id
  JOIN canonical_events checkout_event
    ON checkout_event.canonical_event_id=t.checkout_event_id
  WHERE t.source_instance_id=$1 AND t.coverage_epoch_id=$2
    AND t.observed_state_at::timestamptz >= $3::timestamptz
    AND checkout_event.occurred_at >= ch.checkout_at
    AND t.observed_state_at::timestamptz >= checkout_event.occurred_at
)
SELECT (SELECT count(*) FROM cohort)::bigint AS entrants,
       (SELECT count(*) FROM added)::bigint AS item_added,
       (SELECT count(*) FROM checkout)::bigint AS checkout_started,
       (SELECT count(*) FROM recorded)::bigint AS currently_recorded_journeys`

function validInstant(value) {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value))
}

function ready(row, now) {
  return row?.status === 'CURRENT_STATE_READY' &&
    row.baseline_complete === true && row.historical_gap_status === 'INCOMPLETE' &&
    row.valid_until != null && new Date(row.valid_until) > now
}

function blocked(reason = 'CDC_QUALITY_UNAVAILABLE') {
  return Object.freeze({status:'BLOCKED_BY_QUALITY',reason})
}

function activeBinding(row, sourceId, coverageEpochId, activation) {
  return row?.source_instance_id === sourceId && row.state === 'ACTIVE' &&
    row.coverage_epoch_id === coverageEpochId &&
    new Date(row.activation_at).getTime() === Date.parse(activation) &&
    row.profile_id === profile.profile_id && row.profile_version === profile.profile_version &&
    row.contract_id === profile.contract_id && row.metric_id === profile.metric_id &&
    isDeepStrictEqual(row.definition, profile)
}

export function createReferenceCdcFunnelCandidateRepository({pool, sourceId,
  coverageEpochId, activationAt, now = () => new Date()} = {}) {
  if (!pool?.connect || !pool?.query || !sourceId || !coverageEpochId ||
      !validInstant(activationAt)) throw Error('reference_cdc_funnel_candidate_config_invalid')
  const activation = new Date(activationAt).toISOString()
  async function read(scope) {
      if (scope?.sourceId !== sourceId) return null
      const client = await pool.connect()
      let quality, row
      try {
        await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
        await client.query("SET LOCAL statement_timeout='10s'")
        quality = (await client.query(QUALITY_SQL,[sourceId,coverageEpochId])).rows[0]
        if (ready(quality,now())) {
          row = (await client.query(FUNNEL_CANDIDATE_SQL,
            [sourceId,coverageEpochId,activation,scope.from ?? null,scope.to ?? null])).rows[0]
        }
        await client.query('COMMIT')
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {})
        throw error
      } finally { client.release() }
      if (!ready(quality,now())) return blocked()
      // A quality monitor can invalidate or refresh a lease while the journey
      // snapshot is read. Never serve numeric results from that stale lease.
      const after = (await pool.query(QUALITY_SQL,[sourceId,coverageEpochId])).rows[0]
      if (!ready(after,now()) ||
          new Date(after.valid_until).getTime() !== new Date(quality.valid_until).getTime() ||
          new Date(after.verified_at).getTime() !== new Date(quality.verified_at).getTime()) {
        return blocked('LEASE_CHANGED_DURING_READ')
      }
      if (!row) return blocked('CDC_FUNNEL_QUERY_EMPTY')
      const entrants = Number(row.entrants)
      const added = Number(row.item_added)
      const checkout = Number(row.checkout_started)
      const recorded = Number(row.currently_recorded_journeys)
      if (![entrants,added,checkout,recorded].every(Number.isSafeInteger) ||
          recorded > checkout || checkout > added || added > entrants) {
        return blocked('CDC_FUNNEL_COUNTS_INVALID')
      }
      return Object.freeze({
        status:'SHADOW_CURRENT_STATE',
        contract_id:'reference.medusa.order_recorded_state.v2',
        source_id:sourceId,coverage_epoch_id:coverageEpochId,
        historical_gap_status:'INCOMPLETE',
        profile_status:'UNPUBLISHED',
        cohort:{basis:'entry_at',activation_at:activation,from:scope.from ?? null,
          to:scope.to ?? null},
        quality_valid_until:new Date(after.valid_until).toISOString(),
        totals:{entrants,item_added:added,checkout_started:checkout,
          currently_recorded_journeys:recorded,
          current_state_reach_rate:entrants ? recorded / entrants : null},
      })
  }
  return Object.freeze({
    read,
    async readActive(scope) {
      if (scope?.sourceId !== sourceId) return null
      const params = [sourceId,profile.profile_id,profile.profile_version]
      const before = (await pool.query(ACTIVE_BINDING_SQL,params)).rows[0]
      if (!activeBinding(before,sourceId,coverageEpochId,activation)) {
        return blocked('REFERENCE_PROFILE_INACTIVE')
      }
      const result = await read(scope)
      if (result.status === 'BLOCKED_BY_QUALITY') return result
      const after = (await pool.query(ACTIVE_BINDING_SQL,params)).rows[0]
      if (!activeBinding(after,sourceId,coverageEpochId,activation) ||
          new Date(after.updated_at).getTime() !== new Date(before.updated_at).getTime() ||
          new Date(after.activated_at).getTime() !== new Date(before.activated_at).getTime()) {
        return blocked('REFERENCE_PROFILE_CHANGED_DURING_READ')
      }
      return Object.freeze({...result,status:'CURRENT_STATE_READY',
        profile_status:'ACTIVE',profile_id:profile.profile_id,
        profile_version:profile.profile_version,metric_id:profile.metric_id,
        metric_version:profile.metric_version,unit:'journeys',
        terminal_mode:profile.terminal_mode})
    },
  })
}
