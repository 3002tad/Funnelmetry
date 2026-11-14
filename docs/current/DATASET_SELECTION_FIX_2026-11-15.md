# Giữ lựa chọn bộ dữ liệu khi chuyển trang

## Nguyên nhân

Overview, Products và Data Health đều có `useState('observed')` riêng. Chuyển route
làm trang mới được tạo lại và chọn Medusa mặc định; shell trước đây chỉ lưu nhãn,
không lưu dataset ID thực sự dùng trong truy vấn.

## Bản sửa local

- Đưa dataset ID và setter lên AppShell để các trang dùng chung.
- Lưu lựa chọn vào localStorage theo tài khoản và nguồn dữ liệu, khôi phục sau F5.
  Đây là tùy chọn trên trình duyệt hiện tại, không đồng bộ giữa thiết bị.
- Data Health mở tab minh họa khi dataset đang chọn là synthetic. Chọn dữ liệu
  thực tế sẽ chủ động đổi lựa chọn chung về observed.
- Phễu và các màn chưa hỗ trợ dataset demo vẫn đọc dữ liệu quan sát, có thông báo
  phạm vi rõ ràng; không ghi đè lựa chọn đã lưu.
- Dataset đã lưu nhưng không còn trong danh sách được hiển thị “Chưa khả dụng”,
  không âm thầm đổi sang observed. Backend vẫn là nơi kiểm tra dataset được phép.
- Đổi dataset xóa bộ lọc ngày hoạt động/sản phẩm phụ thuộc dataset cũ.
- Nhãn dataset synthetic được ghi rõ “Demo · lịch sử” hoặc “Demo · bổ sung”.

## Kiểm thử

Playwright chạy Chromium với API fixture trên React thật. Bộ kiểm thử gồm 24 ca,
trong đó bổ sung: chuyển Overview → Products → Quality → Overview giữ lựa chọn và
query dataset; F5 không gửi query observed; đi qua Funnel giữ lựa chọn khi quay lại;
dataset đã xóa không bị thay thế âm thầm. Unit tests frontend, TypeScript và build
đã chạy đạt. Không dùng credential hoặc thay đổi dữ liệu VPS trong lượt này.

- [Kết quả Playwright](../../apps/dashboard-web/test/artifacts/dataset-persistence/results.json).
- [Mã kiểm thử](../../apps/dashboard-web/test/funnel-browser.mjs).

Chưa commit/push hoặc deploy bản sửa lựa chọn dataset này. Website VPS chưa nhận
thay đổi này. Log/ảnh vẫn giữ local theo quy ước của dự án.
