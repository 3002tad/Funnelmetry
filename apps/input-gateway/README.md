# @funnelmetry/input-gateway

HTTP/security boundary cho `IngressEvent v1`.

Phần hiện có:

- xác thực Browser SDK bằng source key ID + write key;
- xác thực source bridge bằng HMAC SHA-256 trên raw request body;
- kiểm tra clock skew, source ownership và contract trước durable handoff;
- ghi raw record và durable receipt trong cùng Kafka transaction;
- khóa đồng thời theo `(source_id,event_id)` và chỉ cập nhật receipt index sau commit;
- replay compacted receipt topic trước khi ready và hạ readiness khi consumer crash;
- cung cấp `GET /health` và `POST /v1/ingress/events`;
- trả `retryable_failure`, không trả `accepted`, khi durable handoff lỗi.

## Chạy local

Tạo `infra/.env` từ `infra/.env.example`, khởi tạo hai topic Kafka rồi chạy:

```powershell
cd apps/input-gateway
npm install
npm start
```

- raw topic (`KAFKA_TOPIC_RAW`) dùng delete retention phục vụ audit/reprocess;
- receipt topic (`KAFKA_TOPIC_INGRESS_RECEIPTS`) phải dùng compaction;
- `INPUT_GATEWAY_INSTANCE_ID` phải ổn định và duy nhất cho producer transactional ID;
- memory receipt index chỉ là cache được hydrate từ Kafka, không phải durable boundary.

`INPUT_GATEWAY_COORDINATION_MODE=postgres` bật coordination ledger dùng chung giữa nhiều Gateway.
Mỗi replica cần một `INPUT_GATEWAY_INSTANCE_ID` riêng, cùng `INPUT_GATEWAY_DATABASE_URL` và cùng
`INPUT_GATEWAY_CLAIM_LEASE_MS`. Ledger giữ stable `ingestion_id` cùng semantic event fingerprint:

- replica đầu tiên claim event rồi mới mở Kafka transaction;
- replica khác thấy claim còn hạn sẽ trả retryable failure để source retry;
- lease hết hạn chỉ cho phép takeover khi guard chứng minh owner hiện tại chưa được cấp quyền gửi;
- claim đã được cấp quyền gửi không takeover theo lease; phải có explicit release sau lỗi/abort an toàn
  hoặc receipt Kafka đã commit;
- cùng `(source_id,event_id)` nhưng nội dung semantic khác bị từ chối với
  `event_identity_conflict`;
- chỉ sau Kafka commit thành công claim mới chuyển thành `ACCEPTED`.

Migration `013_ingress_coordination.sql` backfill receipt cũ từ telemetry ledger. Receipt cũ thiếu
fingerprint trả retryable failure; cần khôi phục fingerprint từ raw evidence gốc, không dùng payload
retry làm bằng chứng cho nội dung lịch sử.

Sau Kafka commit, cache giữ receipt ngay cả khi cập nhật PostgreSQL thất bại. Retry với receipt đã
replay và fingerprint khớp sẽ hoàn tất claim mà không gửi Kafka lần nữa. Nếu commit có kết quả không
xác định, Gateway hạ readiness; restart để replay receipt. Claim chưa có receipt vẫn bị giữ lại để
tránh append trùng. Với claim đã được cấp quyền gửi, phục hồi tự động khi thiếu receipt cần broker
fencing và xác minh kết quả transaction; hiện chưa triển khai. Không xóa/release claim thủ công chỉ vì
lease đã hết hạn. Claim chưa được cấp quyền gửi có recovery giới hạn mô tả bên dưới.

Một producer xử lý tuần tự các transaction, kể cả event khác key. Đây là giới hạn throughput hiện tại.
Chế độ `single_replica` chỉ giữ để tương thích, không được scale ngang.

## Transactional producer initialization và fencing

Gateway mở rồi abort một transaction **rỗng** ngay sau producer connect, trước receipt replay và
trước khi nhận traffic. KafkaJS chỉ khởi tạo transactional producer ID khi gọi `transaction()`,
không phải khi `connect()`. Bước này không ghi raw/receipt và buộc producer transactional được
khởi tạo trước khi bất kỳ claim nào được cấp quyền gửi.

Khi khởi động tiến trình thay thế cùng `clientId` + `INPUT_GATEWAY_INSTANCE_ID`, Kafka cấp epoch mới
và chặn producer cũ đã khởi tạo với cùng transactional ID. Hai replica hoạt động song song vẫn phải
có instance ID khác nhau; dùng cùng ID chỉ cho replacement. Khi gặp lỗi producer fenced/epoch cũ,
Gateway hạ readiness ngay cả khi abort transaction rỗng thành công; không tiếp tục nhận event mới.
Tham khảo [KafkaJS transactional ID và fencing](https://github.com/tulios/kafkajs/blob/master/docs/Transactions.md#choosing-a-transactionalid).

Đây là fencing **producer**, chưa phải recovery đầy đủ của claim đã được cấp quyền gửi. Migration 015
lưu liên kết attempt tới transactional ID/boot generation; migration 016 bổ sung registry thu hồi quyền
cấp phép gửi của generation cũ. Vẫn chưa có bằng chứng transaction outcome để tự release.
Restart cùng ID không có nghĩa mọi claim pending đã an toàn.
Không chạy trộn bản Gateway cũ chưa có startup initialization với bản này.

Startup đăng ký generation mới ở `INITIALIZING` **trước** Kafka initialization. Sau initialization và
receipt replay, chỉ generation vẫn là current mới được chuyển sang `READY`. AuthorizeSend khóa SHARE
row registry tới hết SQL statement; thay generation cần khóa UPDATE, nên việc thu hồi và cấp quyền
được tuần tự hóa. Thế hệ cũ bị từ chối khi xin quyền gửi và hạ readiness, không mở Kafka transaction.
Readiness không có background watcher; việc phát hiện generation bị thay thế xảy ra khi xin quyền gửi.

Nếu startup mới thất bại, slot có thể giữ `INITIALIZING` và ngừng cấp quyền gửi cho tới lần startup
mới thành công. Không tự hồi sinh generation cũ. Tạo runtime/coordinator mới khi restart; không tái sử
dụng object đã stop hoặc startup lỗi vì KafkaJS giữ producer epoch trong object đó.

Hai startup chồng nhau có thể khiến một producer bị fence sau khi vừa khởi tạo; CAS registry ngăn
generation bị thay thế tự báo ready, nhưng chưa bảo đảm availability dưới mọi startup race/network
partition. Registry không chứng minh transaction đã commit/abort và không release claim đã cấp quyền.

## Recovery từ Kafka receipt và kiểm thử hai tiến trình

Receipt consumer chạy `read_committed` tự hoàn tất claim PostgreSQL khi toàn bộ receipt document và
ingestion ID khớp. Replica sống có thể phục hồi claim của replica chết sau Kafka commit mà không cần
HTTP retry. Completion từ producer và consumer là idempotent; receipt mâu thuẫn làm consumer báo lỗi.
Recovery receipt không suy diễn fingerprint của receipt lịch sử và không giải phóng claim thiếu receipt.

Readiness chờ vị trí batch đã xử lý đạt mốc offset chụp lúc startup trên **tất cả partition**,
không dùng `highWatermark` của broker làm bằng chứng consumer đã đọc xong. KafkaJS
`END_BATCH_PROCESS` bổ sung tiến độ cho batch chỉ có control/aborted records đã bị lọc khỏi
`eachBatch`. Lỗi consumer trong lúc replay không được ghi đè thành ready sau đó.
Đây chỉ là startup replay barrier, chưa phải bằng chứng để release claim thiếu receipt:
vẫn cần fencing và xác minh transaction. Nếu không quan sát đủ tiến độ, startup timeout và
giữ unready thay vì suy đoán replay đã hoàn tất.

`test/replica-fault.integration.test.js` tạo các tiến trình HTTP Gateway độc lập, Kafka topics và
PostgreSQL schema riêng. Nó gửi đồng thời cùng event, kiểm tra payload conflict, dùng SIGKILL ngay sau
Kafka commit, chờ replica sống hoàn tất claim, restart và đếm raw record. Test còn SIGKILL trước commit:
claim vẫn pending dù lease hết hạn, và consumer `read_committed` không nhận raw chưa commit.
Một TCP proxy riêng từ chối kết nối PostgreSQL mới để kiểm tra Gateway trả retryable failure,
không tạo claim; khi mở lại kết nối, retry được accepted. Đây chỉ là lỗi kết nối trước claim,
không đại diện cho mọi network partition hoặc lỗi database giữa transaction.
Các tài nguyên test được dọn
sau mỗi lần chạy; không xóa topic/schema runtime. Cần Node chạy trên Linux để thực hiện SIGKILL:

```sh
TEST_DATABASE_URL=postgresql://... TEST_KAFKA_BROKERS=kafka:9092 npm test
```

Thiếu một trong hai biến trên thì test Kafka thật được skip. Kill hook chỉ nằm trong fixture test.
Network partition và sự cố trước khi có receipt vẫn chưa có cơ chế tự phục hồi đầy đủ.

## Phục hồi claim trước khi cấp quyền gửi

Migration `014_ingress_send_guard.sql` thêm `send_authorized` và guard gắn với owner token.
Gateway mới tạo claim với quyền gửi chưa cấp. Trước khi mở Kafka transaction, `authorizeSend`
phải đổi trạng thái này atomically, đúng owner và đúng guard, duy nhất một lần.

Nếu Gateway chết **trước authorizeSend**, sau lease expiry một HTTP retry cùng identity/payload
sẽ tự takeover claim và giữ nguyên `ingestion_id`. UPDATE takeover và authorizeSend serialize trên
cùng row: nếu takeover thắng, owner cũ bị từ chối; nếu authorizeSend thắng, takeover bị chặn.
Không cần thao tác SQL thủ công hoặc worker quét; phải có source retry để kích hoạt recovery.

Nếu Gateway chết sau khi đã được cấp quyền (kể cả trước lệnh Kafka đầu tiên), hoặc mất phản hồi
database khi cấp quyền, vẫn giữ pending khi chưa có receipt. Đây không phải broker fencing và
không đóng toàn bộ cửa sổ lỗi trước commit. Claim lịch sử mặc định `send_authorized=TRUE`, guard
không xác định; tuyệt đối không tự gán chúng thành chưa gửi.

Triển khai: dừng Gateway cũ, chạy migration 014–017 sau 013 rồi khởi động bản mới. Compose migration
service đọc các file SQL theo thứ tự và hỗ trợ database đã có dữ liệu. Không chạy bản mới trước
migration; không hỗ trợ rolling upgrade trộn phiên bản. Kiểm thử chỉ áp dụng migration trong schema
test riêng, chưa nâng cấp database runtime của người dùng.

## Kiểm tra claim đang chờ (chỉ đọc)

Trong `apps/input-gateway`, với `INPUT_GATEWAY_DATABASE_URL` hoặc `DATABASE_URL` đã có trong
environment, chạy:

```sh
npm run claims:inspect -- medusa-reference
npm run claims:inspect -- medusa-reference event-id-can-kiem-tra
```

CLI không tự nạp `.env`. Nếu dùng cấu hình local sẵn có, có thể nạp tường minh:

```sh
node --env-file=../../infra/.env src/claim-inspector-cli.js medusa-reference
```

Kết quả JSON giới hạn 50 claim của source, cũ nhất theo `updated_at` trước; nếu `truncated=true`,
hãy tra chính xác `event_id`. Danh sách rỗng chỉ có nghĩa không tìm thấy claim trong ledger,
không chứng minh event chưa từng được ghi Kafka. Dữ liệu chỉ phản ánh thời điểm SELECT.

| Disposition | Ý nghĩa và cách xử lý |
|---|---|
| `PENDING_TRANSACTION_EVIDENCE` | Chưa đủ evidence về transaction; không xóa/release chỉ vì lease hết hạn |
| `RETRY_ELIGIBLE` | Explicit release hoặc guard chưa cấp quyền gửi và lease hết hạn; source có thể retry cùng identity/payload qua HTTP, không phải bảo đảm request sẽ thành công |
| `PRE_SEND_LEASE_ACTIVE` | Guard chưa cấp quyền gửi nhưng lease còn hạn; chờ source retry sau |
| `ACCEPTED_IN_LEDGER` | Ledger ghi nhận accepted; CLI không kiểm chứng Kafka độc lập |
| `MISSING_FINGERPRINT_EVIDENCE` | Thiếu fingerprint lịch sử; cần raw evidence gốc, không lấy payload retry để lấp vào |

Query chạy trong transaction `READ ONLY`, timeout 5 giây, không trả payload/receipt document,
fingerprint hay owner token. Không có lệnh release/delete/replay tự động và không cần kết nối Medusa.

Migration 015 lưu `ingress_send_attempts`: mỗi lần authorize gắn với transactional ID và runtime boot
generation, atomically với quyền gửi. Lịch sử attempt không bị ghi đè khi retry đổi owner.
`producer_attempt` trong báo cáo chỉ thuộc owner hiện tại, null nếu không có evidence cho owner đó;
generation không phải Kafka numeric epoch. Không backfill claim lịch sử từ runtime đang chạy.

Registry 016 chỉ thu hồi quyền cấp phép gửi mới; không suy ra transaction outcome từ boot ID,
owner token hoặc lease. Chế độ recovery tùy chọn bên dưới bổ sung điều kiện sau fencing.

## Recovery sau fencing (tùy chọn, mặc định tắt)

`INPUT_GATEWAY_RECOVER_FENCED_CLAIMS=true` yêu cầu PostgreSQL coordination và migration 017.
Compose hiện đặt rõ `false`; chưa bật hoặc áp dụng migration vào database runtime.

Khi bật, startup kiểm tra Kafka cluster ID và receipt topic có `cleanup.policy=compact` (không
chấp nhận `delete` hoặc `compact,delete`). Mỗi send attempt mới ghi cluster/raw-topic/receipt-topic
đã kiểm tra. Replacement phải dùng cùng client/instance ID để giữ nguyên transactional ID.
Sau thu hồi quyền generation cũ, khởi tạo Kafka epoch để fence producer cũ và replay toàn bộ
receipt `read_committed` tới mốc offset chụp sau fencing, startup mới xét recovery:

- Receipt đã commit và khớp được hoàn tất vào ledger trước khi xét release.
- Chỉ release claim còn pending, guard đúng owner, có fingerprint, attempt thuộc generation cũ
  của cùng transactional ID và đúng Kafka scope. Attempt lịch sử thiếu scope không được backfill.
- Release và audit `ingress_claim_recoveries` nằm trong cùng PostgreSQL transaction, khóa current
  generation ở phase INITIALIZING; startup bị thay thế hoặc lỗi ghi audit không được release.
- Source phải retry cùng identity/payload qua HTTP; Gateway giữ ingestion ID cũ, không tự gửi lại.

Điều kiện vận hành bắt buộc: lịch sử receipt phải còn nguyên từ lúc attempt được cấp quyền.
Không bật nếu từng xóa/tạo lại topic, delete-records, gửi tombstone, dùng delete retention hoặc
restore Kafka/PostgreSQL không đồng bộ. Kiểm tra cấu hình compact hiện tại **không chứng minh**
lịch sử còn nguyên; cluster ID và tên topic cũng không phát hiện topic bị tạo lại cùng tên.
Nếu không xác nhận được điều kiện này, giữ chế độ tắt. Đây không phải recovery mọi network partition
hay bảo đảm HA tổng quát; không takeover claim của transactional ID khác.
