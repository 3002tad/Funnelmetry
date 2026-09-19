# @funnelmetry/canonical-ledger-writer

Persistence boundary cho `CanonicalEvent v1`:

```text
canonical Kafka topic
  → validate contract + Kafka key
  → PostgreSQL transaction
  → commit database
  → Kafka transaction: canonical-persisted handoff + canonical offset
```

`canonical_event_id` là primary key. Redelivery/re-normalization có nội dung giống nhau,
ngoại trừ `ingested_at`/`normalized_at` do xử lý lại, là no-op. Bản ghi đầu tiên và các
mốc thời gian gốc được giữ nguyên; persisted handoff luôn dùng document đã lưu, không
dùng document của lần retry. Những field khác (kể cả event-time, raw hash/reference,
identity, quality và dữ liệu nghiệp vụ) vẫn phải trùng khớp.
Cùng ID nhưng nội dung khác gây conflict/rollback và không commit Kafka offset. Vì vậy crash
sau database commit nhưng trước offset commit không tạo row thứ hai khi message được đọc lại.

Nếu Kafka transaction lỗi sau database commit, canonical offset chưa commit; lần retry xem
row là duplicate rồi phát lại persisted handoff an toàn. Consumer mới đọc topic từ đầu để
có thể rebuild ledger; consumer group ổn định tiếp tục từ
offset đã commit. PostgreSQL là structured source of truth, còn canonical Kafka topic là
stream/rebuild input trong retention đã công bố.

## Khởi tạo schema

Áp dụng [`../../infra/postgres/v2/001_canonical_ledger.sql`](../../infra/postgres/v2/001_canonical_ledger.sql)
vào database V2 trước khi chạy worker.

```powershell
cd workers/canonical-ledger-writer
npm install
npm start
```
