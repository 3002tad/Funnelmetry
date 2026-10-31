# Tài liệu Streaming Pipeline

**Bắt đầu ở [tài liệu hệ thống hiện hành](current/README.md).** Bộ này mô tả kiến trúc, dữ liệu, triển khai, vận hành và năng lực của phiên bản đang phát triển. Quyết định có thẩm quyền thuộc [System Backbone](https://github.com/3002tad/System_Backbone/blob/main/MASTER_SPECIFICATION.md) và [Decision Record](https://github.com/3002tad/System_Backbone/blob/main/docs/governance/DINH_HUONG_DE_TAI.md).

| Nhóm | Vị trí |
| --- | --- |
| Hiện hành | [Kiến trúc](current/SYSTEM.md), [dữ liệu](current/DATA.md), [triển khai](current/DEPLOYMENT.md), [vận hành](current/OPERATIONS.md), [năng lực](current/CAPABILITIES.md) |
| Contract | [Time semantics v1](TIME_SEMANTICS_CONTRACT_V1.md), [Medusa CDC hiện hành](MEDUSA_REFERENCE_CDC_CURRENT.md), [OpenAPI V2](../tools/api-docs/public/openapi-v2.yaml) |
| Chi tiết component | [Apps](apps/), [workers](workers/), [analytics](analytics/), [infra](infra/), [tools](tools/), [packages](packages/), [integrations](integrations/) |
| Lịch sử | [Archive/checkpoints](archive/README.md), [V1 legacy](legacy/README.md) |

Các trang gốc tên `CDC11_*`, `CDC12_*`, `CDC13_*`, `CDC14_*`, `SWARM_*`, `TESTING.md` và tương tự chỉ giữ liên kết tương thích. Bản đầy đủ của hồ sơ theo mốc nằm ở `archive/checkpoints/`. Không dùng chúng như lệnh triển khai hiện tại. File JSON inventory CDC-14 ở gốc được giữ nguyên để không làm mất đường dẫn bằng chứng từ Backbone; đó là dữ liệu checkpoint, không phải inventory runtime tự cập nhật.
