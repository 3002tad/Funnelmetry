# 📚 API Reference

Complete documentation of all REST API endpoints in the system.

---

## Generator API (port 7070)

### Event Generation

#### `GET /gen/event`
Returns a single random event from the fallback queue (legacy endpoint).

**Response:**
```json
{
  "id": "uuid-string",
  "eventTime": "2026-03-22T10:30:45.123456Z",
  "eventType": "payment_success",
  "orderId": "ORD-timestamp-random",
  "userId": "USR12345",
  "amount": 1500000,
  "currency": "VND",
  "status": "success",
  "metadata": {
    "device": "mobile",
    "ip": "192.168.1.100",
    "sessionId": "sess_xxx"
  }
}
```

#### `GET /gen/drain?limit=50`
Drain up to N events from the fallback queue (used by producer-poller).

**Query Parameters:**
- `limit` (int): Max events to return, 1-500

**Response:**
```json
{
  "count": 50,
  "queueSize": 0,
  "events": [...]
}
```

#### `GET /gen/events?count=10`
Generate and return N random events (preview, doesn't affect pipeline).

**Query Parameters:**
- `count` (int): Number of events to generate, 1-500 (default: 10)

**Response:**
```json
{
  "count": 10,
  "events": [...]
}
```

#### `POST /gen/emit`
Generate a single custom event and publish to Kafka (or fallback queue).

**Request Body:**
```json
{
  "eventType": "payment_success",
  "status": "success",
  "amount": 2000000,
  "orderId": "ORD-custom-123",
  "userId": "USR999",
  "lateMinutes": 0
}
```

All fields optional; unspecified fields are generated randomly.

**Response:**
```json
{
  "id": "uuid",
  "eventTime": "...",
  "eventType": "payment_success",
  "orderId": "ORD-custom-123",
  "userId": "USR999",
  "amount": 2000000,
  "currency": "VND",
  "status": "success",
  "_path": "kafka",
  "fallbackEnabled": false,
  "queueSize": 0
}
```

#### `POST /gen/emit-batch`
Generate N events and publish to Kafka.

**Request Body:**
```json
{
  "count": 100
}
```

**Response:**
```json
{
  "count": 100,
  "path": "kafka",
  "fallbackEnabled": false,
  "queueSize": 0,
  "events": [...]
}
```

### Configuration

#### `GET /gen/config`
Get current event distribution and configuration.

**Response:**
```json
{
  "distribution": {
    "order_created": 30,
    "payment_initiated": 25,
    "payment_success": 35,
    "payment_failed": 8,
    "order_cancelled": 2
  },
  "defaultCount": 10,
  "ratePerSec": 1,
  "amountRules": {
    "payment_success": "50,000 - 5,000,000 VND",
    "payment_initiated": "50,000 - 3,000,000 VND",
    "order_created": "50,000 - 3,000,000 VND",
    "payment_failed": "0 VND",
    "order_cancelled": "0 VND"
  }
}
```

#### `POST /gen/config`
Update event distribution and batch configuration.

**Request Body:**
```json
{
  "distribution": {
    "order_created": 30,
    "payment_initiated": 25,
    "payment_success": 35,
    "payment_failed": 8,
    "order_cancelled": 2
  },
  "defaultCount": 10,
  "ratePerSec": 1
}
```

### Monitoring

#### `GET /health`
Health check endpoint.

**Response:**
```json
{
  "ok": true,
  "time": "2026-03-22T10:30:45.123Z",
  "service": "event-generator-api",
  "port": 7070,
  "kafka": {
    "connected": true,
    "topic": "events_raw"
  },
  "queue": {
    "enabled": false,
    "size": 0,
    "maxSize": 10000
  }
}
```

#### `GET /metrics`
Prometheus-format metrics.

**Response:**
```
# HELP api_generator_http_requests_total Total HTTP requests
# TYPE api_generator_http_requests_total counter
api_generator_http_requests_total 1234
...
```

#### `GET /gen/queue`
Show current fallback queue status.

**Response:**
```json
{
  "enabled": false,
  "queueSize": 0,
  "maxSize": 10000
}
```

---

## Dashboard API (port 8080)

### KPI & Metrics

#### `GET /api/kpi?timeRange=1h`
Aggregate KPI data for time period.

**Query Parameters:**
- `timeRange`: `15m`, `1h`, `24h` (default: `1h`)

**Response:**
```json
{
  "revenue": 45678900.50,
  "totalEvents": 3209,
  "paymentSuccess": 1123,
  "pending": 1817,
  "totalFailed": 269,
  "successRate": 80.65
}
```

#### `GET /api/timeseries?timeRange=1h`
Time series data for charting.

**Query Parameters:**
- `timeRange`: `15m`, `1h`, `24h` (default: `1h`)

**Response:**
```json
[
  {
    "timestamp": "2026-03-22T10:00:00Z",
    "revenue": 1234567.89,
    "ordersCreated": 150,
    "paymentSuccess": 120,
    "paymentFailed": 30
  },
  ...
]
```

#### `GET /api/events?page=1&pageSize=20&eventType=payment_success&status=success`
Paginated event list from `events_clean`.

**Query Parameters:**
- `page` (int): Page number (1-indexed, default: 1)
- `pageSize` (int): Events per page (max 100, default: 20)
- `eventType` (string): Filter by event type
- `status` (string): Filter by status

**Response:**
```json
{
  "events": [
    {
      "id": "uuid",
      "eventTime": "2026-03-22T10:30:45Z",
      "eventType": "payment_success",
      "orderId": "ORD-xxx",
      "userId": "USR123",
      "amount": 1500000.00,
      "currency": "VND",
      "status": "success"
    },
    ...
  ],
  "total": 3209,
  "page": 1,
  "pageSize": 20,
  "statusCounts": {
    "success": 1123,
    "pending": 1817,
    "failed": 269
  }
}
```

#### `GET /api/metrics`
Current processing rate and pipeline metrics.

**Response:**
```json
{
  "kafkaLag": 45,
  "processedEventsPerSec": 8.5,
  "pipelineDelaySec": 5.3,
  "timestamp": "2026-03-22T10:30:45Z"
}
```

### System Health

#### `GET /api/health`
System health status (Kafka, Spark, PostgreSQL).

**Response:**
```json
{
  "kafka": {
    "status": "healthy",
    "message": "All brokers operational"
  },
  "spark": {
    "status": "healthy",
    "message": "Streaming jobs running"
  },
  "postgres": {
    "status": "healthy",
    "message": "Database responsive"
  }
}
```

Possible statuses: `healthy`, `degraded`, `down`

### Alerts & Simulation

#### `GET /api/alerts`
Get current system alerts.

**Response:**
```json
[
  {
    "id": "alert_1234567890_abc123",
    "severity": "critical",
    "title": "Kafka Cluster Down",
    "message": "Unable to connect to Kafka brokers",
    "timestamp": "2026-03-22T10:30:45Z",
    "service": "kafka"
  },
  ...
]
```

#### `POST /api/simulate`
Inject simulated faults for testing (development only).

**Request Body:**
```json
{
  "type": "kafka_down"
}
```

**Simulation types:**
- `reset` - Restore all systems to healthy state
- `kafka_down` - Simulate Kafka broker failure
- `spark_crash` - Simulate Spark job crash

### Monitoring

#### `GET /metrics`
Prometheus-format metrics.

**Response:**
```
# HELP dashboard_api_http_requests_total Total HTTP requests
# TYPE dashboard_api_http_requests_total counter
dashboard_api_http_requests_total 5678
...
```

#### `GET /health`
API health check.

**Response:**
```json
{
  "status": "ok",
  "uptime": 3600.5
}
```

---

## Event Schema

### Event Types

| Type | Status | Amount | Meaning |
|------|--------|--------|---------|
| `order_created` | `pending` | 50k-3M | New order placed |
| `payment_initiated` | `pending` | 50k-3M | Payment started |
| `payment_success` | `success` | 50k-5M | Payment confirmed |
| `payment_failed` | `failed` | 0 | Payment declined |
| `order_cancelled` | `failed` | 0 | Order cancelled |

### Full Event Structure

```json
{
  "id": "uuid-v4",
  "eventTime": "2026-03-22T10:30:45.123456Z",
  "eventType": "payment_success",
  "orderId": "ORD-1679558445000-ABC123",
  "userId": "USR12345",
  "amount": 1500000,
  "currency": "VND",
  "status": "success",
  "metadata": {
    "device": "mobile|desktop|tablet",
    "ip": "192.168.1.100",
    "sessionId": "sess_timestamp_random"
  }
}
```

---

## Error Responses

All endpoints return error responses in this format:

```json
{
  "error": "Error message",
  "message": "Additional details (if applicable)"
}
```

### Common Status Codes

| Code | Meaning |
|------|---------|
| 200 | Success |
| 204 | No Content (queue empty) |
| 400 | Bad Request (invalid parameters) |
| 429 | Too Many Requests (fallback queue full) |
| 500 | Internal Server Error |
| 503 | Service Unavailable (Kafka down, fallback disabled) |

---

## Rate Limiting

Currently no explicit rate limiting. Recommendations:

- Generator API: Implement if using direct Kafka path at scale
- Dashboard API: Cache TTL handles most spike mitigation
- Producer-poller: Built-in poll interval provides natural backpressure

---

## Backward Compatibility

- Direct Kafka path (generator-api → Kafka) is **primary**
- Fallback queue path (generator-api → queue → producer-poller → Kafka) remains for resilience
- Legacy `/gen/event` and `/gen/drain` endpoints preserved for fallback producer

Removing fallback path is safe after confirming direct Kafka stability.

---

**Last updated:** 2026-03-22
