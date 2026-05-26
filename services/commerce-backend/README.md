# commerce-backend (legacy)

**Không deploy** trong runtime k3s hiện tại.

Commerce events (`checkout_start`, `purchase_succeeded`, …) gửi qua **browser SDK** → `tracking-api`.

Manifest cũ: `infra/k8s/apps/commerce-backend/` · Xem [`docs/RUNTIME.md`](../../docs/RUNTIME.md).
