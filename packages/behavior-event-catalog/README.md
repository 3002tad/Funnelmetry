# Funnelmetry Behavior Event Catalog

Shared, versioned behavior semantics for Funnelmetry V2. It owns event type, producer
boundary, authority class and privacy-safe payload validation; it does not own transport,
event identity, consent, queueing or UI instrumentation.

Catalog v2 follows DEC-115. `cart.add_clicked` is not an active event. The authoritative
add-to-cart step is `cart.item_added`, emitted only by a source-confirmed server hook.
`behavior.search_submitted` has producer `source_server`; its payload requires a stable
`search_interaction_id`, normalized/sanitized query and original search outcome.

Use `validateBehaviorEvent(eventType, payload)` at a semantic boundary before treating an
event as canonical. `IngressEvent` remains a generic source envelope.

The Browser SDK consumes this catalog for its configured allowlist and rejects events whose
producer is server-only. Medusa instrumentation remains a separate host/installer gate.

See `System_Backbone/docs/implementation/BEHAVIOR_EVENT_CATALOG_V2_ROLLOUT.md` for rollout
and acceptance gates.
