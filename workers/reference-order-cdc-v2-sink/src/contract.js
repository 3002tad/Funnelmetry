export function validateRecord(value, {epoch, sourceId}) {
  if (!value || value.contract_id !== 'reference.medusa.order_recorded_state.v2' ||
      value.coverage_epoch_id !== epoch || value.source_instance_id !== sourceId ||
      value.historical_gap_status !== 'INCOMPLETE' ||
      value.coverage !== 'CURRENT_STATE_FROM_REBASELINE' ||
      value.quality !== 'REFERENCE_APPROXIMATE' ||
      !/^[0-9a-f]{64}$/.test(value.record_id ?? '') ||
      !['BASELINE', 'BASELINE_COMPLETE', 'STATE', 'TRANSITION', 'CORRECTION'].includes(value.record_type)) {
    throw Error('reference_cdc_v2_record_invalid')
  }
  if (value.record_type === 'BASELINE_COMPLETE') {
    if (value.order_id !== '__baseline__' || !Number.isSafeInteger(value.baseline_orders) ||
        !Number.isSafeInteger(value.baseline_active_orders) ||
        !/^[0-9a-f]{64}$/.test(value.baseline_digest ?? '')) {
      throw Error('reference_cdc_v2_baseline_marker_invalid')
    }
  } else if (!/^order_[A-Za-z0-9]+$/.test(value.order_id ?? '') ||
      typeof value.active !== 'boolean' ||
      (value.cart_id !== null && !/^cart_[A-Za-z0-9]+$/.test(value.cart_id ?? '')) ||
      (value.active && !value.cart_id) ||
      (value.record_type === 'BASELINE' ? value.revision_end_id !== null
        : !/^\d+:\d+$/.test(value.revision_end_id ?? ''))) {
    throw Error('reference_cdc_v2_state_invalid')
  }
  return value
}
