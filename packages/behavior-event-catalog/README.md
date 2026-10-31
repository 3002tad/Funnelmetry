# Funnelmetry Behavior Event Catalog

Shared, versioned behavior semantics for Funnelmetry V2. It owns event type, producer
boundary, authority class and privacy-safe payload validation; it does not own transport,
event identity, consent, queueing or UI instrumentation.

Catalog v3 keeps `cart.add_clicked` retired. The active Medusa reference add-to-cart step
is `cart.item_added` derived from persisted `cart_line_item` CDC changes. New browser search
`behavior.search_query_submitted` carries a normalized/sanitized query, stable submit identity
and page instance. Browser SDK adds session/anonymous identity and event time in the envelope.
The former server event `behavior.search_submitted` remains recognizable for historical data
but is not emitted by the V3 installer. Neither browser search nor CDC cart events claim
search outcome, result count or a confirmed search-to-product causal link.
`context.cart_linked` is a browser observation carrying a consented session and the
cart ID after a successful storefront add. It is identity evidence, not a funnel add
fact; the current journey resolver does not merge already separate journeys.

Use `validateBehaviorEvent(eventType, payload)` at a semantic boundary before treating an
event as canonical. `IngressEvent` remains a generic source envelope.

The Browser SDK consumes this catalog for its configured allowlist and rejects events whose
producer is server-only. Medusa instrumentation remains a separate host/installer gate.

See `System_Backbone/docs/implementation/BEHAVIOR_EVENT_CATALOG_V2_ROLLOUT.md` for rollout
and acceptance gates.
