# @3002tad/funnelmetry-browser-sdk

Browser runtime dùng chung cho các host binding JavaScript/TypeScript.

Host giữ `track(sourceEventType, sourcePayload)` làm primitive tương thích. Với event
thuộc Browser behavior catalog v1, dùng `trackBehavior` để validate payload trước khi enqueue.
SDK cũng cung cấp `createPageContext`/`trackPageView`, `attachScrollDepthObserver` và
`attachBannerImpressionObserver`; caller vẫn phải cấp route template, page instance và stable
banner/placement ID. SDK không tự đọc form value, URL query/fragment, DOM text hoặc IP.

Scroll chỉ phát milestone `25/50/75/100` một lần theo `page_instance_id`. Banner impression
chỉ phát sau khi phần tử hiển thị tối thiểu 50% liên tục trong 1 giây. Search/filter và banner
click vẫn là semantic hook explicit của host qua `trackBehavior`/`trackBannerClick`.

`accepted`/`duplicate` mới loại event khỏi queue. `retryable_failure` giữ event
cho lần flush sau; queue overflow phải được quan sát qua `onDrop`.
