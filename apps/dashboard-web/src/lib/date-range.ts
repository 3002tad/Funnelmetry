/** UI ranges are explicit inclusive UTC dates; HTTP windows are [from, to). */
export function defaultDateRange(now = new Date()) {
  return `${new Date(now.getTime() - 29 * 86400000).toISOString().slice(0, 10)}/${now.toISOString().slice(0, 10)}`
}
export function dateWindow(range: string) {
  if (/^\d{4}-\d{2}-\d{2}\/\d{4}-\d{2}-\d{2}$/.test(range)) {
    const [a, b] = range.split('/')
    const from = new Date(`${a}T00:00:00Z`), last = new Date(`${b}T00:00:00Z`)
    if (!Number.isFinite(+from) || !Number.isFinite(+last) || from.toISOString().slice(0,10)!==a || last.toISOString().slice(0,10)!==b || from > last) throw Error('Khoảng ngày không hợp lệ')
    return { from: from.toISOString(), to: new Date(+last + 86400000).toISOString() }
  }
  const to = new Date(), days = range === 'Last 7 days' ? 7 : range === 'Last 90 days' ? 90 : 30
  return { from: new Date(+to - days * 86400000).toISOString(), to: to.toISOString() }
}
