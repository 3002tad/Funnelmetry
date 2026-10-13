# Swarm PARALLEL_LIVE validation — 2026-10-13

## Scope and result

Local Docker Desktop single-node Swarm stack `funnelmetry-live-20261013` was created with independent PostgreSQL, Kafka, volumes, connector ID, cursor and Docker Secrets. This is a **parallel live candidate**, not authoritative cutover or full-capability acceptance. The previous synthetic stack `funnelmetry-swarm-offline-20261013` remains stopped at `0/0`; its two volumes and three secrets were **not deleted** because full acceptance has not passed.

API, Web and Workers images were built from Pipeline commit `7fa5c6a3305198b9f850a8a5baeb4f59adcfc7f0`, pushed to GHCR and pinned by digest in ignored `runtime/deploy.env`: API `sha256:a5e971449b697d6e61106478a7fdfbc98bdccc59934a2a2c16bdb1755efc7457`, Web `sha256:3c1f7a9b257e18f70a4556f8b505bef25b81b94186da4f9434dcba1a467d6dde`, Workers `sha256:cb8688feea715b5f271086ed4de69fa91963d1220d32ac7be46d23265c9bfc52`. The monitoring overlay/launcher is a subsequent source commit; no application image contents changed after `7fa5c6a`.

## Runtime evidence

- Feed read-only preflight matched `event_feed_id=5143bee7-b883-453f-a045-e696621dbd1d`, retention floor `0`, latest sequence `450`; fresh cursor started at `0`. Connector `/readyz` was `200 READY`, observed matching feed ID and cursor `450` with no connector error.
- New PostgreSQL holds 450 ingress accepted receipts and 450 canonicalization outcomes: `435 normalized`, `4 quarantined/mapping_failed`, `11 unsupported/mapping_not_found`. Read-only aggregate comparison against the HTTPS Feed matched all 15 non-normalized event IDs without printing payloads: 4 `behavior.product_viewed` schema `1.0` were quarantined; 5 `cart.add_clicked` schema `1.0` and 6 `medusa.order_placed` schema `1.0` were unsupported. These are legacy contract records, not a missing connector batch. The 435 canonical and journey records include 2 canonical `order.placed` events from the supported contract. Do **not** interpret cursor 450 as 450 analytically accepted events.
- Catalog Sync saved one Medusa Admin snapshot with 104 products.
- All 17 continuous services in the 20-service stack reached `1/1` at final check. Bootstrap, Kafka topic initialization and profile publisher are one-shot jobs and correctly show `0/1` after task `Complete`.
- Admin login, registry, worker readiness (7 workers), Kafka lag, analyst catalog, overview, events, data health, traffic-source registry and evidence returned HTTP 200. Temporary analyst account used for test was disabled. A user-authorized single chat request returned HTTP 200 with `status=generated`, `model=deterministic`; this exercised provider-backed tool selection but did not prove a free-form Qwen answer. No raw event or PII was printed.
- A self-signed 30-day `funnelmetry.local` certificate was generated outside the repository and trusted in Windows CurrentUser Root. Node HTTPS client with that CA/SNI verified `/healthz` HTTP 200 and `tls_authorized=true`. Edge (Playwright) with a **session-only host resolver override** opened `https://funnelmetry.local/login`, displayed the login form and correct page title with `ignoreHTTPSErrors=false`; no credential was entered. Windows `curl.exe` failed locally with Schannel `SEC_E_NO_CREDENTIALS`, and the Windows hosts entry for `funnelmetry.local` is absent. Normal browser navigation without that override remains **unverified**.
- Prometheus and Grafana run privately on the stack overlay. Prometheus target `funnelmetry-monitoring` is `up=1` with no scrape error. Grafana health reports database `ok`; authenticated datasource and dashboard API both returned 200. Monitoring machine credential expires `2026-10-20T15:09:47Z`; rotation is required.

## Outstanding acceptance gates

1. Explicitly decide historical schema `1.0` coverage/backfill policy; current V2 mapping does not accept those 15 records. Verify required current-contract event coverage with fresh source activity, not only historical replay. Do not silently remap legacy order events to the V2 `order.placed` fact.
2. Swarm Autoscaler Controller and Level-2 Recovery Controller have no reviewed Swarm actuator/acceptance yet. Existing `tools/autoscaler` is decision-only and `tools/resilience-watchdog` targets Compose container IDs. Do not grant them a Docker socket or claim full resilience by treating Swarm task restart as a substitute.
3. Establish secrets/DB backup and restore evidence, monitoring credential rotation, fault-injection and rolling rollback acceptance. Current local secret files are ignored artifacts, not a managed backup.
4. Add/review local hostname resolution and verify ordinary browser navigation without the session-only override. Investigate the separate Windows curl Schannel failure if curl is an operational health probe. No public/multi-node access is claimed.

The user's requested removal of the old synthetic stack, including volumes/secrets, is **deferred** until these full-capability acceptance gates are met or the user explicitly changes the cleanup condition. No old data was removed.
