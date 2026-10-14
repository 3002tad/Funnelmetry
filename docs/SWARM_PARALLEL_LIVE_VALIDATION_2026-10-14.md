# Swarm PARALLEL_LIVE validation — 2026-10-14

Scope: isolated, non-authoritative single-node stack `funnelmetry-live-20261014` on the local Docker Desktop manager. The stopped `funnelmetry-swarm-candidate` stack and its state were not changed or deleted. This is not a cutover or production/HA acceptance.

## Release and deployment

- Feed read-only preflight returned the configured `event_feed_id=5143bee7-b883-453f-a045-e696621dbd1d`, `retention_floor_seq=0`, `latest_available_seq=450`; the approved initial cursor was `0`.
- The first data deploy was stopped by intentional image/version guards: the old API image's schema digest differed from local source, and the old Worker image did not support `PARALLEL_LIVE`. No guard was bypassed and no state was reset.
- API, Web and Workers were rebuilt from Pipeline commit `a5319a87f405f6a7a11859b1982acd45b61a695e`, pushed to GHCR and pinned in ignored `runtime/deploy.env` by digest: API `sha256:864b9d4ff3b175bbcf76145910b460795ac5bfa68fbdfa847380288ba89bb684`, Web `sha256:1aa3c9b7718e1069ad03dc509f455b7587475fb36cf92fd8a0f6c60208477185`, Workers `sha256:a23a7597192c16367ac0627390acbc6a18a210bca0ef9ddad3556fd1cfaec93a`. The API image schema digest matched the local manifest; the Worker image accepted Raw partition count 2 and its container-identity configuration tests passed.
- PostgreSQL bootstrap/release marker exists (1 row). Nine Kafka topics exist; Raw has two partitions, replication factor 1. One-shot bootstrap/topic/publisher tasks correctly show `0/1` after `Complete`.

## End-to-end observations

- Source Connector `/readyz` returned HTTP 200 `READY`, no error, matching Feed ID and cursor `450`. The latest observation reported retention floor `0` and latest sequence `450`.
- Fresh PostgreSQL state held 450 accepted ingress receipts and 450 canonicalization outcomes: 435 `normalized`, 4 `quarantined`, 11 `unsupported`. There were 435 canonical events and no duplicate `(source_id, source_event_id, mapping_version)` keys. The 15 non-normalized records need the existing legacy-contract review; cursor progress does not imply all events normalized.
- Catalog Sync stored one snapshot with 104 product names. Admin login and `/api/auth/me` returned HTTP 200 with `super_admin` role; no credentials or JWT were printed.
- All 15 continuously running containers were present; the healthchecked Connector, Normalizer, API, Web, PostgreSQL and Kafka tasks reported `healthy`. HTTPS with `funnelmetry.local` SNI, local certificate CA and explicit loopback resolution returned `/healthz` 200, `/login` 200 and unauthenticated `/api/auth/me` 401, with TLS authorization true. Windows resolved `funnelmetry.local` to `127.0.0.1` through its hosts entry, but an ordinary Windows `Invoke-WebRequest` HTTPS probe failed locally; ordinary browser TLS and access from another machine remain unverified.
- The Swarm Normalizer uses `CANONICAL_NORMALIZER_INSTANCE_ID_MODE=container`; the read-only controller probe observed one ready replica, a stable one-member group, two Raw partitions, unique identity and sufficient single-node reservation capacity. It reported offset lag `2` even though the 450 outcomes were persisted; the source uses transactional Kafka writes, so control-marker offset effects must be distinguished from executable record backlog before automated scale-down. This interpretation remains unverified. Release-specific replay/drain evidence for the **new** Worker digest is absent, so `replayVerified=false`. No controller `--apply` or background runner was enabled.

## Remaining gates

This deployment demonstrates live Feed → Kafka → canonical/PostgreSQL, local HTTPS, admin login and Catalog snapshot. It does **not** prove complete UI/API functionality, a paid Qwen model response, monitoring, live 1→2→1 autoscale/recovery, restore/cutover, multi-node placement or production readiness. Legacy schema 1.0 outcomes remain non-normalized. The generated DB credential is stored only in ignored local runtime storage and needs approved backup before this stack can be considered restorable. Keep the old stack/state until a separate cleanup decision.
