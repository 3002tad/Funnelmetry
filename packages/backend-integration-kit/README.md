# @funnelmetry/backend-integration-kit

Forwarder Node.js dùng chung. Host binding cung cấp event đã map; kit tạo
`IngressEvent`, ký HMAC, retry có giới hạn và trả receipt/failure result mà không
ném lỗi vào lifecycle business của host.

Package không import Medusa, không đọc database/queue nội bộ và không quyết định
ý nghĩa `order`, `payment` hay `refund`.
