# @3002tad/funnelmetry-browser-sdk

Browser runtime dùng chung cho các host binding JavaScript/TypeScript.

`track(sourceEventType, sourcePayload)` và alias có chủ đích `trackBehavior` đều validate
payload theo Behavior Event Catalog v2 trước khi enqueue; không có public path bỏ qua privacy rule.
SDK cũng cung cấp `createPageContext`/`trackPageView`, `attachScrollDepthObserver` và
`attachBannerImpressionObserver`; caller vẫn phải cấp route template, page instance và stable
banner/placement ID. SDK không tự đọc form value, URL query/fragment, DOM text hoặc IP.

Scroll chỉ phát milestone `25/50/75/100` một lần theo `page_instance_id`. Banner impression
chỉ phát sau khi phần tử hiển thị tối thiểu 50% liên tục trong 1 giây. Search là server-only
semantic hook theo DEC-115 và Browser SDK sẽ từ chối đưa `behavior.search_submitted` vào queue;
filter và banner click vẫn là semantic hook explicit của host.

`trackPageView` deduplicate theo `page_instance_id`. Host phải tạo một page context cho mỗi page
load/route transition và giữ lại context đó qua các lần component render; SDK không deduplicate
theo URL vì hai lần truy cập cùng route là hai page instance khác nhau.

`accepted`/`duplicate` mới loại event khỏi queue. `retryable_failure` giữ event
cho lần flush sau; queue overflow phải được quan sát qua `onDrop`.
