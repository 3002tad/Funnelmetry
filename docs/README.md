# Tài liệu Funnelmetry

## Hiện hành

- [`REPOSITORY_LAYOUT.md`](REPOSITORY_LAYOUT.md): cấu trúc repository V2 và trạng thái migration.
- [`TIME_SEMANTICS_CONTRACT_V1.md`](TIME_SEMANTICS_CONTRACT_V1.md): clock, horizon/grace,
  maturity và late-arrival boundary dùng chung; không chứa numeric default.
- [`../tools/api-docs/public/openapi-v2.yaml`](../tools/api-docs/public/openapi-v2.yaml): OpenAPI
  machine-readable cho Analytics API V2.
- Kiến trúc đích và decision record: repository `../../System_Backbone`.
- Quy tắc phát triển: repository `../../System_Cookbook`.

## Tài liệu V1 giữ để tham khảo

Các file dưới đây mô tả pipeline/k3s cũ đã ngừng duy trì ngày 2026-08-24. Chúng
không phải hướng dẫn chạy V2:

- [`BAO_CAO_DU_AN.md`](../legacy/docs-v1/BAO_CAO_DU_AN.md)
- [`PHU_LUC.md`](../legacy/docs-v1/PHU_LUC.md)
- [`RUNTIME.md`](../legacy/docs-v1/RUNTIME.md)
- [`TECH_STACK.md`](../legacy/docs-v1/TECH_STACK.md)
- [`SPEC.md`](../legacy/docs-v1/SPEC.md)
- [`REPO_MAP.md`](../legacy/docs-v1/REPO_MAP.md)
- [`API.md`](../legacy/docs-v1/API.md)

Code và tài liệu tương ứng được giữ trong `../legacy/` để đối chiếu migration.
