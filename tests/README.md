# Cross-component tests

Nơi đặt fixture và test dùng qua nhiều app/worker: contract, integration, E2E và
fault injection. Unit test vẫn nằm cạnh package hoặc component sở hữu code.

## Tìm đúng bài test

- [Tra cứu event chỉ đọc trên Compose hiện hành](../docs/TESTING.md#tra-cứu-event-trên-compose-hiện-hành-chỉ-đọc): đối chiếu receipt → canonical → journey và tham chiếu Source/Connector nếu có; không thay thế runner E2E có tạo fixture riêng.
- [V2 E2E](tools/v2-e2e/README.md): đọc prerequisites và phạm vi fixture trước khi chạy.
- [Polars smoke](tools/polars-smoke/README.md) và [Medusa reference simulator](tools/medusa-reference-simulator/RUN_FUNNELMETRY_API_BOT.md): hướng dẫn test theo công cụ.
- [Qwen eval](evidence/ANALYTICS_AI_EVIDENCE_2026-09-25.md#qwen-evaluation) và [staging readiness](evidence/ANALYTICS_AI_EVIDENCE_2026-09-25.md#staging-readiness): bằng chứng theo mốc, không phải trạng thái nghiệm thu hiện tại.
- [Analytics](../docs/analytics/README.md): tool/metadata và bằng chứng theo từng giai đoạn.
- [Dashboard API](../docs/apps/dashboard-api/README.md): test route và phân quyền.
- [Dashboard Web](../docs/apps/dashboard-web/README.md): build/test giao diện.
- Quay lại [mục lục](../docs/README.md).

Không suy ra live acceptance từ unit test/build. Test tạo database/container riêng
không cho phép xóa/reset dữ liệu demo. Không dùng key live hoặc gửi business event
thật khi bài test không yêu cầu và chưa được cấp phạm vi đó.
