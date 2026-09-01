# @funnelmetry/ingress-telemetry-writer

Durable audit projection for evidence already present on Kafka:

```text
accepted receipt topic ─┐
                       ├─> PostgreSQL ingress/canonicalization telemetry
canonical outcome topic ┘
```

The writer persists one immutable accepted receipt per `(source_id,event_id)` and versioned terminal
canonicalization outcomes per `(source_id,source_event_id,mapping_version)`. PostgreSQL commit happens
before Kafka offset commit; redelivery is idempotent and conflicting immutable documents stop the
offset from advancing.

This worker does not infer duplicate attempts, rejected ingress, retryable failures, pre-SDK loss or
queue drops: the current durable topics do not contain those observations. Outcome history from a
running writer is retained by mapping version, while a rebuild from a compacted Kafka topic can only
recover the latest record still present for each key.

Apply `infra/postgres/v2/005_ingress_telemetry.sql`, provision the receipt/outcome topics, then run:

```powershell
cd workers/ingress-telemetry-writer
npm install
npm start
```
