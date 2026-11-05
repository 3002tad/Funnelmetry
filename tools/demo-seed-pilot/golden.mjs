// Expected values are calculated from the independent logical fixture, not SQL output.
const countBy = (items, key) => Object.fromEntries(Object.entries(items.reduce((out, item) => { const k = key(item); out[k] = (out[k] ?? 0) + 1; return out }, {})).sort(([a], [b]) => a.localeCompare(b)))
export function goldenQuestions(fixture) {
  const browser = fixture.events.filter(e => !e.cdc)
  const search = browser.filter(e => e.event_type === 'behavior.search_query_submitted')
  const views = browser.filter(e => e.event_type === 'behavior.product_viewed')
  const eventsByMonth = countBy(views, e => e.occurred_at.slice(0, 7))
  const words = countBy(search, e => e.data.query_normalized)
  const traffic = countBy(browser, e => e.utm_source ?? 'ABSENT')
  const categoryCounts = countBy(fixture.products.filter(p => p.category_id), p => fixture.categories.find(c => c.category_id === p.category_id).name)
  const make = (id, question, grain, time, sql, expected, limitation) => ({ id, question, grain, time, sql, expected, limitation, quality: 'SYNTHETIC_FIXTURE_RECONCILED; source quality UNVERIFIED' })
  return [
    make('G01', 'Có bao nhiêu lượt xem sản phẩm?', 'behavior event', 'occurred_at UTC', "SELECT count(*)::int FROM funnelmetry_explore.behavior_events WHERE event_type='behavior.product_viewed'", views.length, 'Không phải số session.'),
    make('G02', 'Lượt xem sản phẩm theo tháng?', 'behavior event × tháng UTC', 'occurred_at UTC', "SELECT coalesce(json_object_agg(m,n ORDER BY m),'{}'::json) FROM (SELECT to_char(occurred_at AT TIME ZONE 'UTC','YYYY-MM') m,count(*)::int n FROM funnelmetry_explore.behavior_events WHERE event_type='behavior.product_viewed' GROUP BY 1) q", eventsByMonth, 'Khoảng pilot; không suy ra seasonality thực tế.'),
    make('G03', 'Có bao nhiêu lượt gửi tìm kiếm?', 'search event', 'occurred_at UTC', "SELECT count(*)::int FROM funnelmetry_explore.behavior_events WHERE event_type='behavior.search_query_submitted'", search.length, 'Search demand độc lập.'),
    make('G04', 'Từ khóa tìm kiếm nào được gửi bao nhiêu lần?', 'normalized query × event', 'occurred_at UTC', "SELECT coalesce(json_object_agg(k,n ORDER BY k),'{}'::json) FROM (SELECT query_normalized k,count(*)::int n FROM funnelmetry_explore.behavior_events WHERE event_type='behavior.search_query_submitted' GROUP BY 1) q", words, 'Không có kết quả hay conversion của search.'),
    make('G05', 'Có bao nhiêu sản phẩm hiện tại?', 'source × epoch × product', 'snapshot fixture', 'SELECT count(*)::int FROM funnelmetry_explore.catalog_products WHERE NOT soft_deleted', fixture.products.length, 'Current state; không phải lịch sử catalog.'),
    make('G06', 'Sản phẩm hiện tại theo danh mục?', 'source × epoch × product-category', 'snapshot fixture', "SELECT coalesce(json_object_agg(name,n ORDER BY name),'{}'::json) FROM (SELECT c.name,count(DISTINCT p.product_id)::int n FROM funnelmetry_explore.catalog_products p JOIN funnelmetry_explore.catalog_product_categories pc USING(source_id,coverage_epoch_id,product_id) JOIN funnelmetry_explore.catalog_categories c USING(source_id,coverage_epoch_id,category_id) WHERE NOT p.soft_deleted AND NOT c.soft_deleted GROUP BY c.name) q", categoryCounts, 'Có sản phẩm không gán category; một product có thể thuộc nhiều category.'),
    make('G07', 'Có bao nhiêu dòng giỏ hàng hiện tại?', 'source × epoch × line', 'snapshot fixture', 'SELECT count(*)::int FROM funnelmetry_explore.cart_lines WHERE NOT deleted', fixture.carts.length, 'Không suy số lần thêm từ snapshot.'),
    make('G08', 'Có bao nhiêu event CDC cart item added?', 'CDC event', 'source_produced UTC', "SELECT count(*)::int FROM funnelmetry_explore.behavior_events WHERE event_type='cart.item_added'", fixture.carts.length, 'Source-produced không phải thời điểm thao tác authoritative.'),
    { ...make('G09', 'Có bao nhiêu order reference đang ON?', 'source × epoch × order', 'snapshot fixture', 'SELECT count(*)::int FROM funnelmetry_explore.order_recorded_state WHERE active', fixture.orders.filter(x => x.active).length, 'Không phải conversion, completed, paid hoặc revenue.'), quality: 'SYNTHETIC_FIXTURE_RECONCILED; source quality BLOCKED_BY_QUALITY, historical gap INCOMPLETE' },
    make('G10', 'Số browser event theo nguồn UTM demo?', 'browser event × label/absence', 'event occurred_at UTC; raw received_at khi nạp', "SELECT coalesce(json_object_agg(label,n ORDER BY label),'{}'::json) FROM (SELECT coalesce(utm_label,'ABSENT') label,count(*)::int n FROM funnelmetry_demo.traffic_observations GROUP BY 1) q", traffic, 'Mapping label chỉ dành cho fixture; không suy attribution hay session.'),
    make('G11', 'Có bao nhiêu browser session xuất hiện trong fixture?', 'distinct synthetic session', 'event occurred_at UTC', 'SELECT count(DISTINCT session_id)::int FROM funnelmetry_demo.browser_sessions', new Set(browser.map(e => e.session_id)).size, 'Demo view riêng; không tự suy journey.'),
    make('G12', 'Có bao nhiêu context link được ghi nhận?', 'browser context event', 'occurred_at UTC', "SELECT count(*)::int FROM funnelmetry_explore.behavior_events WHERE event_type='context.cart_linked'", fixture.carts.length, 'Không đếm thành thêm giỏ lần hai.'),
    { id: 'G13', question: 'Doanh thu đã thu là bao nhiêu?', expected: 'INSUFFICIENT_DATA', limitation: 'Không có contract paid revenue trong fixture.' },
    { id: 'G14', question: 'Tỷ lệ search dẫn đến thêm giỏ là bao nhiêu?', expected: 'INSUFFICIENT_DATA', limitation: 'Search→cart chưa có contract attribution.' },
  ]
}
