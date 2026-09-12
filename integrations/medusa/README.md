# Medusa integration

Thư mục này dành cho tài liệu/binding đặc thù Medusa. Runtime dùng chung vẫn nằm ở
`packages/browser-sdk` và `packages/backend-integration-kit`; core pipeline không
được import Medusa hoặc đọc storage nội bộ của Medusa.

`canonical-mappings.v1.json` là artifact semantic versioned của integration. Runtime normalizer nạp
artifact qua generic config path; core không hard-code Medusa. Baseline hiện chỉ chốt
`medusa.order_placed → order.created` (`BUSINESS_FACT`). `cart.add_clicked` vẫn là browser intent;
không được đổi thành `cart.item_added`, và không tạo `order.accepted` khi source chưa có transition
authoritative tương ứng.

DEC-073 đã chốt Browser behavior catalog v1 gồm thêm page view, bounded scroll milestone,
banner impression/click và privacy-safe search/filter. Đây là target cross-repo chưa được
implementation hiện tại hỗ trợ đầy đủ. Không thêm các event này vào Medusa manifest trước khi
Browser SDK, installer, Normalizer mapping và analytics V2 đã được version/test đồng bộ; theo dõi
`System_Backbone/docs/implementation/BEHAVIOR_EVENT_CATALOG_V1_ROLLOUT.md`.
