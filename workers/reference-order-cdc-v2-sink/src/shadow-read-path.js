// Read-only order-v2 correlation candidate. It never writes canonical events or
// activates a Funnel Profile. The order and journey stores may be separate DBs.
function required(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw Error(`${name} is required`)
  return value
}

function ready(quality, now = new Date()) {
  return quality?.status === 'CURRENT_STATE_READY' &&
    quality.baseline_complete === true &&
    quality.historical_gap_status === 'INCOMPLETE' &&
    quality.valid_until != null && new Date(quality.valid_until) > now
}

export function assessShadowOrderJourney({quality, state, sourceId, lastOn, lastTransition,
  journey, checkout, now = new Date()}) {
  if (!ready(quality, now)) return {status:'BLOCKED_BY_QUALITY'}
  if (!state) return {status:'ORDER_NOT_FOUND'}
  const base = {
    source_id: sourceId ?? null,
    source_instance_id: state.source_instance_id,
    coverage_epoch_id: state.coverage_epoch_id,
    order_id: state.order_id,
    cart_id: state.cart_id,
    active: state.active,
    last_record_id: state.last_record_id,
    last_topic_offset: String(state.last_topic_offset),
    historical_gap_status: 'INCOMPLETE',
    quality_valid_until: new Date(quality.valid_until).toISOString(),
    on_record_id: lastOn?.record_id ?? null,
    observed_state_at: lastOn?.observed_state_at ?? null,
  }
  // Only a post-baseline transition can be a funnel terminal candidate.
  if (lastTransition && lastTransition.active !== state.active) {
    return {...base,status:'BLOCKED_BY_QUALITY',reason:'TRANSITION_STATE_MISMATCH'}
  }
  if (!state.active) return {...base,status:lastOn ? 'RETRACTED_SHADOW' : 'INACTIVE'}
  if (!lastOn) return {...base,status:'BASELINE_ONLY'}
  if (lastTransition?.record_id !== lastOn.record_id) {
    return {...base,status:'BLOCKED_BY_QUALITY',reason:'LATEST_TRANSITION_NOT_ON'}
  }
  if (lastOn.cart_id !== state.cart_id) {
    return {...base,status:'CORRECTED_CART_UNVERIFIED'}
  }
  if (!lastOn.observed_state_at || Number.isNaN(Date.parse(lastOn.observed_state_at))) {
    return {...base,status:'TIME_UNVERIFIED'}
  }
  if (!journey || journey.link_confidence !== 'STRONG') {
    return {...base,status:'JOURNEY_UNVERIFIED'}
  }
  if (!checkout) return {...base,status:'CHECKOUT_UNVERIFIED',journey_id:journey.journey_id}
  return {...base,status:'BOUND_SHADOW',journey_id:journey.journey_id,
    checkout_event_id:checkout.canonical_event_id}
}

export const SHADOW_ORDER_STATE_SQL = `SELECT s.source_instance_id,s.coverage_epoch_id,s.order_id,s.cart_id,
 s.active,s.last_record_id,s.last_topic_offset,
 on_record.record_id AS on_record_id,
 on_record.payload->>'cart_id' AS on_cart_id,
 on_record.payload->>'observed_state_at' AS on_observed_state_at,
 last_transition.record_id AS transition_record_id,
 (last_transition.payload->>'active')::boolean AS transition_active
 FROM reference_cdc_v2_order_current_state_readable s
 JOIN reference_cdc_v2_record_inbox current_record
   ON current_record.record_id=s.last_record_id
 LEFT JOIN LATERAL (
   SELECT r.record_id,r.payload FROM reference_cdc_v2_record_inbox r
   WHERE r.source_instance_id=s.source_instance_id
     AND r.coverage_epoch_id=s.coverage_epoch_id AND r.order_id=s.order_id
     AND r.fact_topic=current_record.fact_topic
     AND r.kafka_partition=current_record.kafka_partition
     AND r.record_type='TRANSITION' AND r.payload->>'active'='true'
     AND r.kafka_offset<=s.last_topic_offset
   ORDER BY r.kafka_offset DESC LIMIT 1
 ) on_record ON true
 LEFT JOIN LATERAL (
   SELECT r.record_id,r.payload FROM reference_cdc_v2_record_inbox r
   WHERE r.source_instance_id=s.source_instance_id
     AND r.coverage_epoch_id=s.coverage_epoch_id AND r.order_id=s.order_id
     AND r.fact_topic=current_record.fact_topic
     AND r.kafka_partition=current_record.kafka_partition
     AND r.record_type='TRANSITION' AND r.kafka_offset<=s.last_topic_offset
   ORDER BY r.kafka_offset DESC LIMIT 1
 ) last_transition ON true
 WHERE s.source_instance_id=$1 AND s.coverage_epoch_id=$2 AND s.order_id=$3`

const QUALITY_SQL = `SELECT status,baseline_complete,historical_gap_status,valid_until
 FROM reference_cdc_v2_quality_state
 WHERE source_instance_id=$1 AND coverage_epoch_id=$2
   AND status='CURRENT_STATE_READY' AND baseline_complete
   AND historical_gap_status='INCOMPLETE' AND valid_until>clock_timestamp()`

export const SHADOW_CART_JOURNEY_SQL = `SELECT e.journey_id,e.link_confidence,
 checkout.canonical_event_id AS checkout_event_id
 FROM journey_entities e JOIN journeys j ON j.journey_id=e.journey_id
 LEFT JOIN LATERAL (
   SELECT c.canonical_event_id FROM journey_events je
   JOIN canonical_events c ON c.canonical_event_id=je.canonical_event_id
   WHERE je.journey_id=e.journey_id AND c.source_id=$1
     AND c.event_type='checkout.started' AND c.relations->>'cart_id'=$2
   ORDER BY c.occurred_at DESC,c.canonical_event_id DESC LIMIT 1
 ) checkout ON true
 WHERE e.source_id=$1 AND j.source_id=$1 AND e.entity_type='CART'
   AND e.entity_key=$2 AND e.link_confidence='STRONG'`

export function createShadowOrderJourneyReadPath({orderPool, journeyPool,
  now = () => new Date()} = {}) {
  if (!orderPool?.connect || !journeyPool?.query) throw Error('order and journey pools are required')
  return Object.freeze({
    async read({sourceInstanceId, sourceId, coverageEpochId, orderId}) {
      const sourceInstance = required(sourceInstanceId,'sourceInstanceId')
      const source = required(sourceId,'sourceId')
      const epoch = required(coverageEpochId,'coverageEpochId')
      const order = required(orderId,'orderId')
      const client = await orderPool.connect()
      let quality, row, journey, checkout
      try {
        await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
        const key = [sourceInstance,epoch]
        quality = (await client.query(QUALITY_SQL,key)).rows[0]
        if (ready(quality,now())) {
          row = (await client.query(SHADOW_ORDER_STATE_SQL,[...key,order])).rows[0]
          if (row?.active && row.on_record_id && row.on_cart_id === row.cart_id &&
              row.on_observed_state_at && !Number.isNaN(Date.parse(row.on_observed_state_at))) {
            const links = await journeyPool.query(SHADOW_CART_JOURNEY_SQL,
              [source,row.cart_id])
            journey = links.rows[0]
            if (links.rowCount === 1 && journey.checkout_event_id) {
              checkout = {canonical_event_id:journey.checkout_event_id}
            }
          }
        }
        await client.query('COMMIT')
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {})
        throw error
      } finally { client.release() }

      // The two stores have no shared snapshot. Recheck the lease and exact
      // order revision after the journey read, and fail closed on any change.
      const final = await orderPool.query(`SELECT q.status,q.baseline_complete,
        q.historical_gap_status,q.valid_until,s.last_record_id,s.last_topic_offset
        FROM reference_cdc_v2_quality_state q
        LEFT JOIN reference_cdc_v2_order_current_state s
          ON s.source_instance_id=q.source_instance_id
         AND s.coverage_epoch_id=q.coverage_epoch_id AND s.order_id=$3
        WHERE q.source_instance_id=$1 AND q.coverage_epoch_id=$2
          AND q.status='CURRENT_STATE_READY' AND q.baseline_complete
          AND q.historical_gap_status='INCOMPLETE'
          AND q.valid_until>clock_timestamp()`,
      [sourceInstance,epoch,order])
      const after = final.rows[0]
      if (!ready(after,now()) || after?.last_record_id !== row?.last_record_id ||
          String(after?.last_topic_offset ?? '') !== String(row?.last_topic_offset ?? '') ||
          new Date(after.valid_until).getTime() !== new Date(quality.valid_until).getTime()) {
        return Object.freeze({status:'BLOCKED_BY_QUALITY',reason:'LEASE_OR_STATE_CHANGED'})
      }
      return Object.freeze(assessShadowOrderJourney({quality,state:row,sourceId:source,
        lastOn:row?.on_record_id ? {record_id:row.on_record_id,cart_id:row.on_cart_id,
          observed_state_at:row.on_observed_state_at} : null,
        lastTransition:row?.transition_record_id ? {record_id:row.transition_record_id,
          active:row.transition_active} : null,
        journey,checkout,now:now()}))
    },
  })
}
