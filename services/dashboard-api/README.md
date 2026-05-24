# dashboard-api

Analytics API + chatbot (Phase 6: PostgreSQL số liệu + Qdrant RAG).

## Endpoints

| Method | Path | Auth |
|--------|------|------|
| GET | `/health` | no |
| POST | `/api/auth/login` | no |
| GET | `/api/overview`, `/api/funnel`, `/api/products/*`, … | JWT |
| POST | `/api/chat` | JWT |
| GET | `/api/chat/insights` | JWT |

### POST /api/chat

```json
{ "message": "Sản phẩm nào nhiều view nhưng ít mua?", "minutes": 60 }
```

Response: `{ answer, intent, period_minutes, sources, rag_used, data_from: "postgresql" }`

Số liệu luôn query PostgreSQL; insight ngữ cảnh tìm trong Qdrant collection `pipeline_insights`.

## Chat modules (`src/lib/chat/`)

| File | Vai trò |
|------|---------|
| `intent.js` | Phân loại câu hỏi (VI/EN keywords) |
| `queries.js` | SQL theo intent |
| `respond.js` | Template câu trả lời (không hallucinate số) |
| `chat.service.js` | Orchestrate + RAG |
| `embed.js` | Vector 384-d (khớp streaming-processor) |

## Env

| Var | Default |
|-----|---------|
| `QDRANT_URL` | `http://qdrant:6333` |
| `QDRANT_COLLECTION` | `pipeline_insights` |
| `POSTGRES_*`, `JWT_*` | `infra/.env` |
