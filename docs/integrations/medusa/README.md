# Medusa reference acquisition

The current target has two source paths:

1. Browser SDK sends consented behavioral events over HTTPS to Source Ingress.
2. PostgreSQL logical CDC streams Medusa commerce and reference data into Pipeline.

`behavior.search_query_submitted` is emitted when the storefront search form is submitted.
Its payload has `query_normalized`, `search_interaction_id` and `page_instance_id` only.
The SDK envelope supplies `occurred_at`, `anonymous_id`, `session_id`, the default
session `correlation_id`, and raw first-touch `utm_source` when present. The page instance
links the search to a page view. The approved use is standalone Search Demand Analytics:
submission volume, normalized keyword popularity/frequency, time trends, sessions with
search, and optional raw `utm_source` breakdown. No result count, outcome, conversion or
search-to-product/cart/order attribution claim is made.
When add-to-cart succeeds, the Browser SDK emits `context.cart_linked` with cart ID and
page instance. It retains the session-to-cart relationship in the canonical record
without counting as an additional add-to-cart step. This identity evidence is not a
dependency of Search Demand Analytics. Search-to-cart is not part of the current contract;
any future attribution requires a separately governed, versioned analytical projection.

`cart.item_added` is derived from positive quantity changes in `cart_line_item` CDC after
an initial snapshot establishes baseline. The CDC event carries cart, line item, variant,
quantity and source position. Snapshot rows do not create historical add events. The
event time is the source-produced timestamp, not an authoritative user-action timestamp.

Order current-state, catalog, inventory and price remain separate CDC profiles with
their own coverage epochs. The reference order current-state fact does not become
`order.placed`, captured payment or revenue. Historical `order.placed` data is preserved.

The Medusa main branch stays unmodified. A source owner creates an integration branch;
`funnelmetry.integration.yaml` declares V3 bindings and the pinned planner generates the
patch on that same branch. CDC role, publication, connector and snapshot are installed by
the source/target operators from the generated profile. Browser search fails open and
does not alter the Medusa search API.
