# PostgreSQL schema (source)

| File | Nội dung |
|------|----------|
| `init.sql` | Extension bootstrap |
| `001_tracking_schema.sql` | Events clean + KPI tables |
| `002_products_catalog.sql` | Catalog demo |
| `003_dashboard_users.sql` | Dashboard auth users |
| `004_tracking_kpi_revenue.sql` | Revenue KPI |

**Runtime:** SQL được mount qua ConfigMap `postgres-init-sql` trong [`../k8s/data/postgres/`](../k8s/data/postgres/configmap-init-sql.yaml).

Khi sửa schema ở đây, đồng bộ sang configmap (hoặc tạo migration riêng) rồi recreate PVC nếu cần DB sạch.
