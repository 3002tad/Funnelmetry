# @funnelmetry/canonical-contract

Internal analytics contract sau raw durable ingress. Package này tách biệt với
`IngressEvent`: source không phải biết canonical naming, event class hoặc quality flags.

Contract gồm `CanonicalEvent v1` và terminal outcome
`normalized | unsupported | quarantined`. `occurred_at` luôn có giá trị, nhưng chỉ
`quality.time_basis=source_occurred` được xem là authoritative event time.
