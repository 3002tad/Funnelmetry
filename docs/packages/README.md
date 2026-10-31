# Tài liệu packages

Các package README dưới đây là **ngoại lệ vị trí**: chúng nằm cạnh `package.json` để npm package có README khi đóng gói (bốn package còn khai báo `README.md` trong `files`). Không chuyển chúng khỏi package chỉ để đạt cấu trúc thư mục, vì như vậy artifact sẽ mất tài liệu. Các tài liệu khác của Pipeline nằm trong `docs/` hoặc `tests/`.

- [Input Contract](../../packages/input-contract/README.md)
- [Canonical Contract](../../packages/canonical-contract/README.md)
- [Behavior Event Catalog](../../packages/behavior-event-catalog/README.md)
- [Time Semantics Contract](../../packages/time-semantics-contract/README.md)
- [Browser SDK](../../packages/browser-sdk/README.md)
- [Reconciliation Contract](../../packages/reconciliation-contract/README.md)

Backend Integration Kit đã retired theo DEC-144. Artifact GitHub Packages cũ được giữ immutable
để tái lập lịch sử; không còn source package, release workflow, dependency hoặc tài liệu sử dụng active.
GitHub Packages không cung cấp REST endpoint cập nhật trạng thái deprecation và registry đã từ chối
`npm deprecate`, vì vậy retirement được enforcement bằng CI/source governance thay vì xóa artifact.

Quyết định và semantics chuẩn vẫn theo [Backbone Master](https://github.com/3002tad/System_Backbone/blob/main/MASTER_SPECIFICATION.md). Các README mô tả implementation của package tại version code hiện hành.
