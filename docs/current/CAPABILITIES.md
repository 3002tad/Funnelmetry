# Năng lực và giới hạn hiện hành

| Mảng | Có trong phiên bản hiện hành | Giới hạn cần giữ khi diễn giải |
| --- | --- | --- |
| Thu thập behavioral | Browser SDK/storefront hooks → Source Ingress/Event Feed → Source Connector → Kafka. | Gateway HTTP phía Pipeline chưa cutover; event được nhận chưa đồng nghĩa đã vào analytical projection. |
| Medusa commerce data | CDC order current-state v2, catalog và inventory/price projection; installer CDC là đường tích hợp chính. | Không còn backend adapter `order.placed` live hay Admin API `catalog-sync`; CDC ON/OFF không phải conversion/revenue. |
| Xử lý phân tích | Canonical normalizer, ledger, journey, funnel, KPI và quality/reconciliation components có code/manifest. | Coverage và độ tươi phải kiểm chứng theo nguồn/epoch; không suy toàn bộ metric đã có dữ liệu hoặc được nghiệm thu production. |
| Dashboard/API | Overview, funnel, traffic input, catalog/reference offer, Admin quan sát và semantic metadata có các read path. | Một số màn chỉ read-only/placeholder; current-offer ngoài shape/quality đã kiểm chứng có thể `UNVERIFIED`/`BLOCKED_BY_QUALITY`. |
| AI | Chat/tooling hiện có trong code; metadata current-offer đã publish. | Định hướng DB-GPT/embedded Agent là giai đoạn sau; không tính đó là runtime hiện hành hay phát triển tool mới từ CDC-12. |
| Hạ tầng | Swarm main + CDC stack, optional monitoring, Cloudflare Tunnel origin cho analyst. | Single-node không phải HA; autoscale/recovery phải kiểm chứng theo policy và workload, không suy từ manifest. |

Phân biệt **có code**, **đã bật**, **đã kiểm chứng** và **được chấp thuận làm contract**. Giá trị/flag của deployment cụ thể phải kiểm tra ở env/manifest/runtime của deployment đó, không suy từ template hoặc hồ sơ archive. Quyết định chi tiết thuộc [Backbone](https://github.com/3002tad/System_Backbone/blob/main/docs/governance/DINH_HUONG_DE_TAI.md).
