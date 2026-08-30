# Local ports

| Thành phần | URL mặc định | Trạng thái |
| --- | --- | --- |
| Dashboard web | `http://localhost:5180` | UI V2 đang phát triển |
| Input Gateway | `http://localhost:31000` | HTTP ingress V2; cần Kafka |
| Dashboard API | `http://localhost:32000` | Backend hiện tại |
| Kafka | `localhost:9092` | Dependency của Input Gateway |
| PostgreSQL | `localhost:5432` | Phụ thuộc local khi chạy API |

Các cổng NodePort/k3s trong tài liệu V1 không còn thuộc runtime được hỗ trợ.
