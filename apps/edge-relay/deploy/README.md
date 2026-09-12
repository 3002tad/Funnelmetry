# Ubuntu reference deployment

This Compose file runs only Edge Relay. It does not start Kafka, PostgreSQL or
the Funnelmetry Pipeline on the Medusa host.

```bash
cd ~/FunnelmetryPipeline/apps/edge-relay/deploy
cp edge-relay.server.env.example edge-relay.server.env
chmod 600 edge-relay.server.env
docker compose -f docker-compose.server.yml up -d --build
docker compose -f docker-compose.server.yml ps
curl -fsS http://127.0.0.1:32000/readyz
```

Set `RELAY_UPSTREAM_ENABLED=false` for the initial deployment. In that mode,
Relay is ready to receive and durable-queue Browser events but does not attempt
to connect to Pipeline. Do not enable upstream until the private Tailscale
Ingress URL and separate upstream browser credential are configured.

After local health passes, create a Cloudflare Tunnel published application:

```text
ingest-test.entidi.io.vn -> http://127.0.0.1:32000
```

Only expose the browser ingress route through that hostname. Keep `/status` and
`/metrics` private; they require `x-funnelmetry-admin-token` when enabled.
