# @3002tad/funnelmetry-browser-sdk

Browser runtime dùng chung cho các host binding JavaScript/TypeScript.

Host chỉ gọi `track(sourceEventType, sourcePayload)` tại semantic hook đã xác
định. SDK xử lý consent, event ID ổn định, local queue, retry, receipt và
pagehide flush; SDK không tự đọc DOM, form value, URL query/fragment hoặc IP.

`accepted`/`duplicate` mới loại event khỏi queue. `retryable_failure` giữ event
cho lần flush sau; queue overflow phải được quan sát qua `onDrop`.
