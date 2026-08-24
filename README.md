# Funnelmetry

Repository chính cho backend analytics và giao diện Funnelmetry V2.

## Cấu trúc đang chuyển đổi

```text
apps/
  dashboard-web/       UI analytics mới, hiện dùng mock data
  dashboard-api/       API analytics hiện có, đang được chuyển dần sang V2
workers/                Các worker V2 sẽ được triển khai theo từng capability
packages/               Input contract, Browser SDK và Backend Integration Kit
integrations/medusa/    Ranh giới tích hợp Medusa; không chứa core pipeline
tools/                   Công cụ CI planner và API docs
infra/                   Schema/config hạ tầng không phụ thuộc runtime V1
tests/                   Contract, integration, E2E và fault fixtures dùng chung
```

Code V1 đã được gom vào `legacy/` để đối chiếu trong lúc phát triển. Nội dung
trong đó không quyết định kiến trúc V2 và không còn được build/deploy mặc định.

CI/CD và manifest k3s V1 đã được loại bỏ ngày 2026-08-24 vì không còn là runtime
được duy trì. Hạ tầng triển khai mới sẽ chỉ được thêm sau khi backend V2 có
vertical slice chạy được.

## Chạy UI mới

```powershell
cd apps/dashboard-web
npm install
npm run dev
```

Mở `http://localhost:5180`.

## Kiểm tra Dashboard API

```powershell
cd apps/dashboard-api
npm install
npm test
```

## Tài liệu

- Kiến trúc đích: repository `../System_Backbone`
- Quy tắc workspace: repository `../System_Cookbook`
- Layout và migration: [`docs/REPOSITORY_LAYOUT.md`](docs/REPOSITORY_LAYOUT.md)
- Tài liệu trong `docs/` mô tả runtime V1 phải được xem là tài liệu migration cho
  đến khi được viết lại theo V2.
