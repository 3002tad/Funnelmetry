import type { CanonicalEventItem } from "./analytics-api"

const eventNames: Record<string, string> = {
  "behavior.page_viewed": "Xem trang",
  "behavior.product_viewed": "Xem sản phẩm",
  "behavior.search_performed": "Tìm kiếm",
  "cart.item_added": "Thêm vào giỏ hàng",
  "checkout.started": "Bắt đầu thanh toán",
  "order.placed": "Đặt đơn hàng",
}

export function eventName(value: string) {
  return eventNames[value] ?? value.replace(/_/g, " ").replace(".", " · ")
}

export function classLabel(value: CanonicalEventItem["event_class"]) {
  return value === "BUSINESS_FACT" ? "Nghiệp vụ" : value === "BEHAVIOR_INTENT" ? "Hành động" : "Quan sát"
}
