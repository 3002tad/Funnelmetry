# Tài liệu hệ thống Pipeline hiện hành

Đây là điểm đọc cho **trạng thái code và luồng triển khai hiện tại**. Kiến trúc và quyết định có thẩm quyền nằm ở [System Backbone](https://github.com/3002tad/System_Backbone/blob/main/MASTER_SPECIFICATION.md) và [Decision Record](https://github.com/3002tad/System_Backbone/blob/main/docs/governance/DINH_HUONG_DE_TAI.md). Một chức năng có code hoặc có trong manifest chưa tự chứng minh đã bật trên mọi môi trường.

| Cần hiểu | Tài liệu |
| --- | --- |
| Thành phần, ranh giới và luồng dữ liệu | [Kiến trúc hiện hành](SYSTEM.md) |
| CDC Medusa, behavioral feed và semantic data | [Dữ liệu và contract](DATA.md) |
| Cấu hình và triển khai Swarm | [Triển khai](DEPLOYMENT.md) |
| Theo dõi, kiểm chứng và phục hồi | [Vận hành](OPERATIONS.md) |
| Năng lực phân tích, giao diện và giới hạn | [Năng lực hiện hành](CAPABILITIES.md) |
| Contract thời gian | [Time semantics v1](../TIME_SEMANTICS_CONTRACT_V1.md) |

Các README theo module trong [`docs/apps`](../apps/), [`docs/workers`](../workers/), [`docs/analytics`](../analytics/) và thư mục code giải thích chi tiết triển khai. [Archive](../archive/README.md) lưu hồ sơ kiểm thử/cutover theo phiên bản; không dùng làm runbook hiện tại. Tên vật lý có chữ `shadow` trong CDC là tương thích state/offset, không cho biết luồng phân tích đang ở shadow.
