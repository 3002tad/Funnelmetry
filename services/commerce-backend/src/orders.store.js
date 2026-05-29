/**
 * In-memory orders until web-shop backend (MongoDB) owns this layer.
 */

const orders = new Map();

export function createOrder(record) {
  orders.set(record.orderCode, record);
  return record;
}

export function getOrder(orderCode) {
  return orders.get(orderCode) || null;
}

export function updateOrderStatus(orderCode, status) {
  const order = orders.get(orderCode);
  if (!order) return null;
  order.status = status;
  order.updatedAt = new Date().toISOString();
  return order;
}
