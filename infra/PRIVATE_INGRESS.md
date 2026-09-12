# Private ingress — implementation stage 1

Implements Master remote `6e444f9` §4.11.1.1. This is an opt-in Compose overlay,
not proof that Tailnet, Medusa binding or end-to-end delivery is working.
Requires Docker Linux containers, `/dev/net/tun`, Compose supporting `!reset`,
and permission to enroll a Tailscale node. No host-network or privileged container.

## Bootstrap

1. Enable MagicDNS and HTTPS certificates in your Tailnet. Set ACL/grants so only
   the intended Medusa host can access this node on TCP 443; remove broad allow-all
   grants that would defeat that restriction. This repository does not change ACLs.
2. Copy `runtime/private-ingress.env.example` to ignored `runtime/private-ingress.env`.
   Set TS_AUTHKEY locally, not in chat/Git. Keep the backend registry `{}`.
3. From the repository root, validate without printing credentials:

```powershell
docker compose -p funnelmetry-private -f infra/compose.v2.yml -f infra/compose.private-ingress.yml --profile private-ingress --env-file runtime/private-ingress.env config --quiet
```

After checking Docker/Tailnet prerequisites, bootstrap only the Gateway and dependencies:

```powershell
docker compose -p funnelmetry-private -f infra/compose.v2.yml -f infra/compose.private-ingress.yml --profile private-ingress --env-file runtime/private-ingress.env up -d --build input-gateway
```

The separate project name avoids reconfiguring an existing E2E/demo stack and uses
separate Kafka/Postgres/state volumes. Workers beyond Gateway dependencies are not
started by this bootstrap command. This still uses local single-node infrastructure,
not a hardened production deployment. Do not mix the base E2E runner or
compose.medusa.yml into these commands. Never use `down -v` to restart this stack.

Gateway shares the sidecar namespace and listens only on 127.0.0.1:31000.
Neither Gateway nor Postgres publishes host ports. Serve proxies Tailnet HTTPS;
Funnel is explicitly false. Tailscale state is persistent; do not delete it on restart.
Docker administrators can inspect environment secrets. Rotate bootstrap keys under
your Tailnet policy; TS_AUTH_ONCE avoids re-enrolling an already-authenticated state.

From the Ubuntu/Medusa host, verify the node's actual MagicDNS name:

```bash
curl --fail --max-time 15 https://funnelmetry-pipeline.YOUR-TAILNET.ts.net/health
```

Use the actual assigned DNS name (hostname collisions can change it). Also check that
the LAN host address on port 31000 is inaccessible and unauthorized Tailnet nodes cannot
reach 443. Never use `curl -k`, disable ACLs, or expose port 31000 to work around failure.
Health is not a signed event test or proof of downstream workers being ready.

## After private health passes

Coordinate one activation with the Medusa owner: install the matching source/key ID
and HMAC secret in PRIVATE_GATEWAY_BACKEND_KEYS_JSON and Medusa backend secret store,
update `ingest.backend_url` to the verified private HTTPS URL, regenerate binding and
rebuild backend. Do not print or commit the registry. Start the remaining V2 workers
with the same Compose project/files before the signed event end-to-end test.

Browser input remains disabled on this profile. The public Edge Relay branch still
needs review/merge and its own upstream authorization/connectivity acceptance; do not
send a browser directly to Tailnet ingress or assume Relay integration is completed.

## Evidence and limitations

### Bootstrap observation — 2026-09-12

The private project has now been started with a locally supplied key. Tailscale
reports Running/online; Gateway loopback `/health` returned 200 with status ready.
Gateway, Postgres and sidecar have no Docker host port bindings. The V2 migrations
completed in the separate private Postgres volume; downstream workers are not yet started.

First bootstrap exposed a readiness race: the Postgres initdb temporary server accepted
Unix socket checks before TCP was open. The private overlay now checks pg_isready over
127.0.0.1 TCP; configuration regression test covers this. Retry completed successfully
without deleting volumes.

HTTPS remains blocked: sidecar reports it cannot issue TLS certificates and
`tailscale serve status` shows no serve config. The Tailnet owner must enable HTTPS
certificates in the DNS console and verify MagicDNS/ACLs. No remote HTTPS health or
Medusa signed-event handoff has passed. Keep credential registries empty until then.

Configuration validation is possible without real keys or enrollment. Live Tailnet
tests require a locally supplied auth key, ACL setup and access to the Medusa host.
No real keys, network enrollment, runtime migration or event delivery were performed
in the initial configuration-only stage; the later bootstrap observations above supersede
that runtime status. The mutable stable image tag must be pinned after validation.

References: [Tailscale Docker parameters](https://tailscale.com/docs/features/containers/docker/docker-params),
[Serve sidecar configuration](https://tailscale.com/blog/docker-tailscale-guide).
