# `catalog-sync` đã nghỉ

Worker đồng bộ tên sản phẩm qua Medusa Admin API đã được gỡ khỏi đường phân tích hiện hành ở CDC-13. Medusa catalog/master data hiện lấy bằng CDC snapshot + stream, có projection và quality gate. Xem [Medusa CDC hiện hành](../../current/MEDUSA_REFERENCE_CDC_CURRENT.md) và [luồng dữ liệu](../../current/DATA.md).

[Tài liệu component cũ](../../archive/checkpoints/CATALOG_SYNC_RETIRED_COMPONENT.md) chỉ dùng để truy vết, không dùng để bật lại API pull.
