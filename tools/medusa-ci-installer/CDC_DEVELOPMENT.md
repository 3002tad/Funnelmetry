# Medusa CDC primary integration

Status: CDC-13 reference cutover. `funnelmetry.integration.yaml` is the source of truth for the Medusa reference CI planner. The planner validates the pinned Medusa host, emits a reviewable patch on the already selected integration branch, and verifies the resulting files. It does not provision logical replication or change a running CDC connector.

The manifest must declare cart, order v2, catalog and inventory/price CDC profiles, with empty `bindings.storefront_server` and `bindings.medusa_backend`. A new checkout receives Browser SDK hooks plus the four CDC profile files. Existing checkouts receive a guarded cleanup: the installer deletes the retired subscriber/dispatcher/server-delivery files, Backend Integration Kit dependency, occurred-at helper and CDC v1 profile when present. No backend event producer is generated.

For a new integration branch based on the pinned Medusa `main` storefront, the installer creates `store-search` and wires its sanitized query and opaque interaction ID to Browser SDK event `behavior.search_query_submitted`. Search is demand-observation only; no server outcome event is produced. Cart/order/catalog data comes from CDC. The public installer supports only manifest V3.

The CDC profile files retain their established filenames and technical status for compatibility with operator-owned CDC provisioning. The **analytical authority** is the approved current-state contract with coverage epoch and quality gate. Browser behavioral events use HTTP ingress; Medusa commerce/master data uses CDC. These are the only two active acquisition paths.

Use `node src/cli.mjs plan --config <manifest> --project <checkout> --out <outside-checkout-dir>` and `node src/cli.mjs verify --config <manifest> --project <checkout>`. CI applies the patch on the existing non-main branch. Logical replication slots, publications, Kafka topics and analytical state remain operator-owned; CDC recovery uses the existing epoch/quality procedures, never a rollback to the old message adapter or Admin API catalog pull.
