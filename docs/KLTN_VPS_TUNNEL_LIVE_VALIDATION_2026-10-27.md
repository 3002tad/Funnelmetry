# KLTN VPS — Tunnel + Swarm live validation (2026-10-27)

Status: **deployed for development/demo; scoped runtime validation passed**. This is a single-node Swarm and does not establish node HA, restore, autoscale, or production cutover acceptance. DB-GPT remains outside this deployment.

## Deployment boundaries

- Medusa and Source Ingress run separately under Docker Compose on the same VPS. Their host origins bind to loopback (`shop/store:8000`, `api:9000`, `ingest:32000`).
- Cloudflare Tunnel `kltn-vps` routes `shop.entidi.io.vn`, `store.entidi.io.vn`, `api.entidi.io.vn`, `ingest.entidi.io.vn`, and `analyst.entidi.io.vn`. Both storefront hostnames target HTTP `localhost:8000`; the analyst route targets HTTP `localhost:31080`. Cloudflare provides public HTTPS.
- Pipeline uses the `funnelmetry_vps_live` single-node Swarm stack at `/srv/KLTN/Funnelmetry`, source commit `0de191b`. `runtime/deploy.env` and all credentials are ignored/local. The Feed ID and initial cursor were observed before deployment: `22c74ac3-fc46-4b3a-bc65-d4c9e117453e`, `after_seq=0`, retention floor `0`.
- `SWARM_TLS_MODE=tunnel` uses the HTTP origin edge. The Swarm host-published port is restricted from `eth0` by the Docker-aware IPv4/IPv6 rules in `infra/firewall/restrict-tunnel-origin.sh`, installed as `funnelmetry-origin-firewall.service`. Do not rely on UFW alone for Docker published ports.

## Checks performed

1. Medusa Secret API Key (stored only on VPS at `/etc/funnelmetry/medusa-catalog.key`, mode `600`) returned HTTP 200 from `https://api.entidi.io.vn/admin/products`; response count was 104. No key or product payload was copied into this record.
2. Authenticated HTTPS Event Feed returned HTTP 200 with the expected Feed ID. DashScope `/models` authentication returned HTTP 200; no Qwen analytical prompt was sent in this validation.
3. Swarm preflight and `check-host` passed; immutable image references pulled. PostgreSQL and Kafka reached healthy state; bootstrap and Kafka topic jobs completed. Catalog Sync logged `catalog_reference_saved` with 104 products.
4. All 15 long-running Swarm services showed `1/1` replicas. Dashboard `/healthz` returned 200 via `https://analyst.entidi.io.vn`. A direct request to the VPS public IP at port `31080` timed out, while the same origin and tunnel route returned 200. The temporary port probe was removed.
5. Pipeline Admin API login, registry, worker readiness (`7/7`), and Kafka lag endpoints returned 200. The repository's `runtime/swarm-live-smoke.cjs` passed catalog, analytics, data-health, traffic-source-registry, and evidence checks under a temporary analyst account; the test disabled that account in cleanup. Qwen chat was not requested by the smoke run.
6. Edge browser test: after closing the storefront tracking notice, Source Event Feed advanced from sequence `0` to `2`. Connector cursor advanced to `2`. Pipeline PostgreSQL contained one `behavior.page_viewed` and one `promotion.banner_impression` canonical event. The browser session was closed.
7. Storefront hostname migration check: `shop.entidi.io.vn` and `store.entidi.io.vn` both returned HTTP 200. The rebuilt Medusa storefront emitted canonical links with the `shop` hostname. Medusa Store API and Source Ingress CORS preflights returned HTTP 204 for both origins. A fresh Edge session on `shop` accepted tracking; the HTTPS Feed reached sequence `11`, the connector cursor reached `11`, and canonical counts included three `behavior.page_viewed`, five `behavior.scroll_depth_reached`, and three `promotion.banner_impression` events. These counts include prior checks on both hostnames; they are not a single-session event inventory.

## Storefront hostname transition

- `shop.entidi.io.vn` is the intended public storefront hostname. The old `store.entidi.io.vn` route remains active during transition; no Cloudflare redirect or DNS removal has been applied.
- The Medusa runtime builds and runs the storefront with `NEXT_PUBLIC_BASE_URL=https://shop.entidi.io.vn`. This setting was added to the versioned Compose/Dockerfile configuration in Medusa Reference; the VPS value is in ignored `runtime/.env.local`.
- The VPS Medusa runtime override allows both storefront origins in `STORE_CORS` and `AUTH_CORS`. The Source Ingress browser-key allowlist also permits both origins. The latter is stored in ignored `apps/edge-relay/deploy/source-ingress.server.env`; neither credential nor browser key is in this document.
- Existing carts, login cookies, and tracking consent are scoped to the old hostname/browser origin. A visitor moving to `shop` starts a separate browser state. Keep the old route available while active sessions finish; plan any redirect as a separate cutover.

## Limits and follow-up

- This test proves a small Browser SDK → Source Ingress → HTTPS Feed → Source Connector → Kafka → canonical ledger path. It does not prove checkout, `order.placed`, high-load behavior, replay, or multi-node operation.
- Qwen provider configuration and key authentication were verified, but no end-to-end model answer was checked here. Monitoring and optional Qdrant knowledge remain disabled in this stack.
- Generated Swarm DB/admin/JWT credentials are stored under ignored `runtime/credentials/` on the VPS. An approved off-host backup/rotation procedure is still required before treating this deployment as restorable.
