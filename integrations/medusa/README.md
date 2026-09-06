# Medusa integration

Thư mục này dành cho tài liệu/binding đặc thù Medusa. Runtime dùng chung vẫn nằm ở
`packages/browser-sdk` và `packages/backend-integration-kit`; core pipeline không
được import Medusa hoặc đọc storage nội bộ của Medusa.

`canonical-mappings.v1.json` là artifact semantic versioned của integration. Runtime normalizer nạp
artifact qua generic config path; core không hard-code Medusa. Baseline hiện chỉ chốt
`medusa.order_placed → order.created` (`BUSINESS_FACT`). `cart.add_clicked` vẫn là browser intent;
không được đổi thành `cart.item_added`, và không tạo `order.accepted` khi source chưa có transition
authoritative tương ứng.
