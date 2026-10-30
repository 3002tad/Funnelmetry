// Separate from canonical funnel_profiles: CDC terminal is a retractable
// current-state observation, not an immutable order.placed conversion event.
export const REFERENCE_CDC_PROFILE_V2 = Object.freeze({
  profile_id: 'reference-commerce-current-state',
  profile_version: '2.0.0',
  contract_id: 'reference.medusa.order_recorded_state.v2',
  metric_id: 'metric.reference_currently_recorded_journey_count',
  metric_version: '2.0.0',
  display_name: 'Reference commerce current state',
  subject_scope: 'JOURNEY',
  grain: ['source_instance_id', 'coverage_epoch_id', 'journey_id'],
  cohort_time_basis: 'product_viewed.occurred_at',
  terminal_time_basis: 'cdc_transition.observed_state_at',
  terminal_binding: 'public.reference_cdc_v2_funnel_terminal_candidate',
  terminal_mode: 'RETRACTABLE_CURRENT_STATE',
  steps: [
    { step_id: 'product-viewed', event_type: 'behavior.product_viewed', source: 'canonical_events' },
    { step_id: 'item-added', event_type: 'cart.item_added', source: 'canonical_events' },
    { step_id: 'checkout-started', event_type: 'checkout.started', source: 'canonical_events' },
    { step_id: 'currently-recorded', event_type: 'reference.medusa.order_recorded_state.v2', source: 'CDC_CURRENT_STATE' },
  ],
  metric: {
    formula: 'COUNT(DISTINCT journey_id) with a current terminal ON after checkout and activation',
    unit: 'journeys',
    correction: 'OFF retracts the terminal from the current query result',
  },
  quality_requirements: [
    'verified initial snapshot', 'fresh order-v2 quality lease',
    'single strong cart journey', 'matching checkout event',
    'post-activation ON',
  ],
  limitations: [
    'Historical WAL gap remains INCOMPLETE',
    'Not immutable order.placed conversion or placed-order revenue',
    'No paid, captured, refunded or net-revenue claim',
  ],
});
