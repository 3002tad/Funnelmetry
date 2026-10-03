# Cross-component tests

Nơi đặt fixture và test dùng qua nhiều app/worker: contract, integration, E2E và
fault injection. Unit test vẫn nằm cạnh package hoặc component sở hữu code.

## Tìm đúng bài test

- [V2 E2E](../tools/v2-e2e/README.md): đọc prerequisites và phạm vi fixture trước khi chạy.
- [Analytics](../analytics/README.md): tool/metadata và bằng chứng theo từng giai đoạn.
- [Dashboard API](../apps/dashboard-api/README.md): test route và phân quyền.
- [Dashboard Web](../apps/dashboard-web/README.md): build/test giao diện.
- Quay lại [mục lục](../docs/README.md).

Không suy ra live acceptance từ unit test/build. Test tạo database/container riêng
không cho phép xóa/reset dữ liệu demo. Không dùng key live hoặc gửi business event
thật khi bài test không yêu cầu và chưa được cấp phạm vi đó.
