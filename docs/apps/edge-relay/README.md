# @funnelmetry/source-ingress

Thư mục này giữ source code migration của Edge Relay cũ, nhưng runtime hiện là
**Source Ingress + Durable Event Log + Authenticated Event Feed API**. Nó không
canonicalize event, không biết Pipeline host và tuyệt đối không push/retry POST
sang Pipeline. Browser SDK và Medusa Backend Adapter chỉ nhận `accepted` sau
khi event đã được durable-persist cùng Source-owned `event_feed_id` và
`ingress_seq`.

Xem [hướng dẫn triển khai trên Source host](#source-ingress-deployment) ở cuối tài liệu.

## Runtime tối thiểu

Source Ingress yêu cầu Node 22+ vì dùng `node:sqlite`. Chạy local với biến môi
trường trong `runtime/v2-dev.env`:

```powershell
cd apps/edge-relay
npm install
npm start
```

Ví dụ cấu hình development không chứa secret thật:

```env
SOURCE_INGRESS_BROWSER_KEYS_JSON={"medusa-reference-source":{"source_id":"medusa-reference","secret":"change-me","allowed_origins":["http://localhost:8000"]}}
SOURCE_INGRESS_BACKEND_KEYS_JSON={"medusa-reference-source":{"source_id":"medusa-reference","secret":"change-me-backend"}}
SOURCE_INGRESS_EVENT_FEED_TOKENS_JSON={"local-connector":"change-me-read-token"}
SOURCE_INGRESS_DATABASE_PATH=./data/funnelmetry-source-event-log.sqlite
```

Producer endpoint giữ tương thích trong giai đoạn migration:

```text
POST /v1/ingress/events
```

Pipeline pull endpoint:

```text
GET /v1/events?after_seq=<N>&limit=<BATCH>&wait=<SECONDS>
Authorization: Bearer <SOURCE_EVENT_FEED_TOKEN>
```

`after_seq` chỉ thuộc `event_feed_id` được trả trong response. Event Feed trả
record theo `ingress_seq` tăng dần, có thể có integer gap; `next_after_seq` là
sequence của record cuối response, không phải `after_seq + count`.

`/healthz` và `/readyz` có thể public qua health check. `/status` và
`/metrics` chỉ bật khi `SOURCE_INGRESS_ADMIN_TOKEN` được cấu hình, với header
`x-funnelmetry-admin-token`. Event Feed không được public anonymously.

---

<a id="source-ingress-deployment"></a>

## Source Ingress deployment

> Nguồn gốc trước khi gộp: `docs/apps/edge-relay/deploy/README.md`. Đường dẫn code/lệnh trong nội dung gốc tính từ root `Streaming_Pipeline` trừ khi ghi khác.

# Source Ingress deployment on the Medusa host

This service is the Source-side boundary for Funnelmetry. It replaces the old
Edge Relay store-and-forward worker: it **never calls a Pipeline URL** and has
no upstream delivery configuration. Browser SDK and Medusa Backend Adapter
POST to `/v1/ingress/events`; the Pipeline Source Connector pulls durable
records from `/v1/events` using an authenticated cursor.

The physical source directory remains `apps/edge-relay` during migration, but
the deployed service and data volume are named `source-ingress` and
`source-event-log`. Do not run the old Relay and this service on port 32000 at
the same time.

## Cutover from the legacy Relay

The legacy SQLite spool cannot be reinterpreted as a Source Event Log because
it lacks Source-owned `event_feed_id` and `ingress_seq`. Before cutover, use
the legacy protected `/status` endpoint to confirm that `QUEUED` and
`FORWARDING` are both zero, then preserve a backup of its Docker volume. The
new Source Event Log starts a new feed lineage; historical reporting across
the boundary must use the old Pipeline state/reconciliation, not synthetic
events.

On the Source host:

```bash
cd ~/FunnelmetryPipeline/apps/edge-relay/deploy
cp source-ingress.server.env.example source-ingress.server.env
chmod 600 source-ingress.server.env
docker compose -f docker-compose.server.yml config --quiet
docker compose -f docker-compose.server.yml up -d --build
docker compose -f docker-compose.server.yml ps
curl -fsS http://127.0.0.1:32000/readyz
```

The deployment must be coordinated with the old Compose project: stop and
remove only the legacy Relay container after its drained-volume backup has
been verified, then start this new Compose project. Cloudflare can keep the
same public origin `ingest-test.entidi.io.vn -> 127.0.0.1:32000`; it exposes
only producer ingress, never the Event Feed read credential.

## Event Feed smoke check

Run this only from the Pipeline host or another trusted operator location.
Never put the token in shell history for shared hosts; the example reads it
from a protected local environment variable.

```bash
curl --fail-with-body \
  -H "Authorization: Bearer $SOURCE_EVENT_FEED_TOKEN" \
  "https://ingest-test.entidi.io.vn/v1/events?after_seq=0&limit=10&wait=0"
```

The response carries `event_feed_id`, ordered `events`, `next_after_seq`, and
`retention_floor_seq`. A Pipeline Source Connector must persist its cursor
only after durable Kafka handoff; this Source service intentionally has no
consumer ACK or Pipeline destination state.
