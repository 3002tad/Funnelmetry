# @3002tad/funnelmetry-browser-sdk

Browser runtime dùng chung cho các host binding JavaScript/TypeScript.

Sau consent, SDK tự tạo `anonymous_id` bền trong local storage và `session_id` bền trong
session storage. Mọi browser event tự mang hai identity này; `correlation_id` mặc định là
`session_id`. Host có thể truyền correlation cụ thể hơn, ví dụ `cart:<cart_id>`, và có thể
dùng `getIdentity()` để chuyển hai opaque ID qua một same-site server boundary. SDK không tạo
hoặc persist identity trước consent.

SDK đọc duy nhất tham số `utm_source` từ landing URL, sau URL decoding chuẩn của browser
nhưng không trim, lowercase, normalize, mapping hay suy diễn business semantics. First value
được giữ first-touch trong session storage sau consent và tự đính kèm vào
`source_metadata.utm_source` của các browser behavior event tiếp theo. URL ở route/load sau
không ghi đè attribution đã có trong cùng session. `utm_medium`, `utm_campaign`, `utm_content`,
`utm_term`, referrer fallback và redirect/link tracking chưa được hỗ trợ. Nếu đọc URL, storage
hoặc việc thêm metadata thất bại, SDK bỏ qua attribution theo fail-open và vẫn giữ delivery event.

`track(sourceEventType, sourcePayload)` và alias có chủ đích `trackBehavior` đều validate
payload theo Behavior Event Catalog v2 trước khi enqueue; không có public path bỏ qua privacy rule.
SDK cũng cung cấp `createPageContext`/`trackPageView`, `attachScrollDepthObserver` và
`attachBannerImpressionObserver`; caller vẫn phải cấp route template, page instance và stable
banner/placement ID. SDK không tự đọc form value, URL query/fragment khác ngoài `utm_source`,
DOM text hoặc IP.

Scroll chỉ phát milestone `25/50/75/100` một lần theo `page_instance_id`. Banner impression
chỉ phát sau khi phần tử hiển thị tối thiểu 50% liên tục trong 1 giây. Search là server-only
semantic hook theo DEC-115 và Browser SDK sẽ từ chối đưa `behavior.search_submitted` vào queue;
filter và banner click vẫn là semantic hook explicit của host.

`trackPageView` deduplicate theo `page_instance_id`. Host phải tạo một page context cho mỗi page
load/route transition và giữ lại context đó qua các lần component render; SDK không deduplicate
theo URL vì hai lần truy cập cùng route là hai page instance khác nhau.

`trackBehaviorOnce(onceKey, sourceEventType, sourcePayload)` is available for a
host action that has one semantic occurrence in a browser session, such as the
start of a checkout for a cart. The caller supplies a non-sensitive stable key;
the SDK keeps only that key in session storage and suppresses later calls with
the same key. A key is persisted only after the event has entered the delivery
path (accepted, duplicate, relay-queued, or retryable queued). Consent denial
and a full queue do not consume the key, so a later explicit call may retry.
The method never reads form values, URL query/fragment other than the SDK-owned
landing `utm_source`, or DOM text.

`accepted`/`duplicate` mới loại event khỏi queue. `retryable_failure` giữ event
cho lần flush sau; queue overflow phải được quan sát qua `onDrop`.
