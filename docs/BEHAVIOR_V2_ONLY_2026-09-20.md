# Demo V2-only behavior cutover

User-directed breaking demo cutover: do not provide behavior v1 replay compatibility.
This does not change the generic `IngressEvent` envelope version or native commerce
source schemas.

- Behavior envelope `source_schema_version`: `2.0` (shared catalog constant).
- Behavior mapping: `canonical-behavior-v2`, distinct from old `canonical-passthrough-v2`.
- Explicit schema selection; behavior schema 1.0/unknown versions are unsupported.
- `cart.add_clicked` is unsupported, never translated to `cart.item_added`.
- Browser produces only browser catalog events. Search requires `source_bridge`,
  schema 2.0 and sanitized v2 payload. Wrong producer/invalid payload quarantines.
- Browser queue key is v2; restored custom queues cannot forward old-schema events.
- Backend forwarder defaults search schema to 2.0. Native Medusa order schemas and
  source-scoped mapping artifact remain unchanged; Catalog v2 is not Medusa v2.

## Source deployment coordination

Revised by user request: deployed `medusa-reference` browser may keep schema `1.0`
for the seven unchanged browser event payloads. Pipeline binds those explicitly to
`medusa-browser-schema1-catalog-v2`, validates with Catalog v2 and requires
`browser_sdk`. No other source receives this alias; browser search/add-click remain
unsupported. This binding does not rename or mutate incoming envelopes.

New sources should deploy the new Browser SDK and update server-only intentional
search hook: stable interaction/event identity, sanitized query, outcome/result
count, asynchronous managed delivery. These local changes do not deploy the public
Medusa website or implement its server action hook. Until coordinated, old browser
events may be unsupported; never fall back to interpreting v1 payload as v2.

## Demo reset already performed

33 local history tables and nine Kafka topics cleared at operator request. Users,
account settings/audit and two funnel profiles retained. Source cursor set to 49;
records up to that cutover boundary deliberately excluded from the new demo.
PostgreSQL backup exists outside Git under local Funnelmetry backups. Remote Source
Event Log was not deleted. Old recovery-check volumes/backups are not the active demo.
