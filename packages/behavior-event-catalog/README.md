# Funnelmetry Behavior Event Catalog

Shared, versioned Browser behavior semantics for Funnelmetry V2. It owns event type,
authority class and privacy-safe payload validation; it does not own transport, event
identity, consent, queueing or UI instrumentation.

The catalog is based on DEC-073. Use `validateBehaviorEvent(eventType, payload)` at a
semantic boundary before treating a Browser source event as canonical. `IngressEvent`
remains a generic source envelope.

The Browser SDK consumes `isBehaviorEventType` to keep its configured allowlist inside
the approved vocabulary. Full payload validation in SDK hooks is a later SDK gate because
the existing Medusa binding has not yet been regenerated with `page_instance_id`.

See `System_Backbone/docs/implementation/BEHAVIOR_EVENT_CATALOG_V1_ROLLOUT.md` for the
cross-repository rollout and acceptance gates.
