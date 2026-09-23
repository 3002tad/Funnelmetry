# @3002tad/funnelmetry-backend-integration-kit

Forwarder Node.js dùng chung. Host binding cung cấp event đã map; kit tạo
`IngressEvent`, ký HMAC, retry có giới hạn và trả receipt/failure result mà không
ném lỗi vào lifecycle business của host.

Mapped source events có thể mang `anonymousId`, `sessionId` và `correlationId`; forwarder
giữ nguyên chúng thành `anonymous_id`, `session_id` và `correlation_id` trong `IngressEvent`.

`createManagedDeliveryDispatcher` bổ sung bounded in-process queue, async drain và circuit
breaker. Server hook chỉ enqueue sau outcome business đã được xác định; delivery failure, queue
full hoặc circuit-open phải drop/degrade mà không đổi response/status/retry của host.

Package không import Medusa, không đọc database/queue nội bộ và không quyết định
ý nghĩa `order`, `payment` hay `refund`.

`normalizeMajorAmount` và `normalizeCurrencyCode` hỗ trợ source binding kiểm tra money
boundary. Amount được giữ dạng decimal string theo major currency units; helper không
chuyển sang minor units hoặc làm tròn bằng phép toán JavaScript.
