// Real Chromium/React interactions with synthetic API responses; no production writes.
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright-core')
const output = fileURLToPath(new URL(process.env.AUDIT_OUTPUT || './artifacts/funnel/', import.meta.url))
await mkdir(output, { recursive: true })
const results = [], errors = [], unexpected = []
const user = { id: 'funnel-test', email: 'test@example.invalid', display_name: 'QA', role: 'analyst', permissions: ['analytics.read'] }
const totals = { entrants: 100, observed_converted: 10, pending: 80, dropped: 10, provisional: 90, degraded: 10, reconciled: 0, reconciling: 0, observed_end_to_end_rate: .1 }
const profiles = ['commerce', 'short'].map(id => ({ ...totals, funnel_profile_id: id, profile_version: 'test-v1', display_name: id }))
const fixture = id => ({ source_id: 'fixture', metric_state: 'OBSERVED', cohort: { basis: 'entry_at', from: '2026-11-01T00:00:00Z', to: '2026-11-15T00:00:00Z' }, profile: { ...profiles.find(p => p.funnel_profile_id === id), conversion_horizon_seconds: 86400, late_arrival_grace_seconds: 3600 }, totals, steps: [100, 50, 10].slice(0, id === 'short' ? 1 : 3).map((n, i) => ({ step_id: `step-${i}`, step_index: i, event_type: `fixture.step_${i}`, event_class: 'behavior', entrants: 100, reached: n, observed_reach_rate: n / 100 })) })
let mode = 'ready', browser, server, releaseSlow, slowStarted = false
async function check(name, fn) { try { await fn(); results.push({ name, status: 'PASS' }) } catch (e) { results.push({ name, status: 'FAIL', error: e.message }); } console.log(JSON.stringify(results.at(-1))) }
try {
  server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), configFile: false, envDir: false, plugins: [react()], server: { host: '127.0.0.1', port: 0 }, define: { 'import.meta.env.VITE_DASHBOARD_API_URL': JSON.stringify('/fixture-api'), 'import.meta.env.VITE_ANALYTICS_SOURCE_ID': JSON.stringify('fixture') } })
  await server.listen()
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  page.on('pageerror', e => errors.push(e.message))
  await page.addInitScript(user => { localStorage.setItem('dashboard_token', 'synthetic'); localStorage.setItem('dashboard_user', JSON.stringify(user)) }, user)
  await page.addInitScript(() => {
    window.abortedFunnelRequests = 0
    const original = window.fetch.bind(window)
    window.fetch = (input, init) => {
      if (String(input).includes('/analytics/funnels/')) init?.signal?.addEventListener('abort', () => window.abortedFunnelRequests++, { once: true })
      return original(input, init)
    }
  })
  await page.route('**/fixture-api/**', async route => {
    const path = new URL(route.request().url()).pathname
    let body, status = 200
    if (path.endsWith('/auth/me')) body = { user }
    else if (path.endsWith('/account/preferences')) body = { preferences: { theme: 'light', analytics_default_days: 30, language: 'vi' } }
    else if (path.endsWith('/analytics/overview')) { body = { profiles: mode === 'empty' ? [] : profiles }; if (mode === 'error') { status = 503; body = { error: 'fixture_unavailable' } } }
    else if (path.includes('/analytics/funnels/')) { body = fixture(path.split('/').at(-1)); if (mode === 'unconfigured') { body.profile.conversion_horizon_seconds = null; body.profile.late_arrival_grace_seconds = null } if (mode === 'zero') { body.steps.forEach(s => { s.reached = 0; s.observed_reach_rate = null }); body.totals = { ...totals, entrants: 0, observed_converted: 0, pending: 0, dropped: 0, provisional: 0, degraded: 0, observed_end_to_end_rate: null } } }
    else if (path.endsWith('/analytics/journeys')) body = { journeys: [] }
    else { unexpected.push(path); status = 404; body = { error: 'unexpected_fixture_request' } }
    if (path.includes('/analytics/funnels/')) {
      if (mode === 'historical') body.profile.disabled_at = '2026-10-30T16:24:13.000Z'
      if (mode === 'active') body.profile.disabled_at = null
      if (mode === 'projection-error') { status = 503; body = { error: 'fixture_projection_unavailable' } }
      if (mode === 'forbidden') { status = 403; body = { error: 'forbidden' } }
      if (mode === 'unauthorized') { status = 401; body = { error: 'unauthorized' } }
      if (mode === 'slow') { slowStarted = true; await new Promise(resolve => { releaseSlow = resolve }) }
    }
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
  })
  const url = `http://127.0.0.1:${server.httpServer.address().port}/funnels`
  const ready = () => page.locator('.tpl-funnel-chart-step').first().waitFor()
  await page.goto(url); await ready()
  await page.screenshot({ path: output + 'desktop.png', fullPage: true })
  await check('profile/version and observed state visible', async () => { assert.match(await page.locator('main').innerText(), /commerce@test-v1/); assert.match(await page.locator('main').innerText(), /OBSERVED/) })
  await check('reach bars encode 100%, 50%, 10% rather than step index', async () => { assert.deepEqual(await page.locator('[data-funnel-reach]').evaluateAll(es => es.map(e => e.style.width)), ['100%', '50%', '10%']); assert.ok(await page.locator('[data-funnel-reach]').first().evaluate(e => e.getBoundingClientRect().height > 0 && getComputedStyle(e).backgroundColor !== 'rgba(0, 0, 0, 0)')) })
  await check('configured horizon and grace displayed accurately', async () => { const text = await page.locator('main').innerText(); assert.match(text, /86400/); assert.match(text, /3600/); assert.doesNotMatch(text, /Horizon và grace chưa cấu hình/) })
  await check('select step then switch shorter profile resets selection', async () => { await page.locator('.tpl-funnel-chart-step').nth(2).click(); assert.match(await page.locator('.tpl-funnel-selected h2').innerText(), /step_2/); await page.getByLabel('Funnel profile').selectOption('short:test-v1'); await page.waitForFunction(() => document.querySelectorAll('.tpl-funnel-chart-step').length === 1); assert.equal(await page.locator('.tpl-funnel-chart-step').first().getAttribute('aria-pressed'), 'true') })
  await page.setViewportSize({ width: 390, height: 844 }); await page.screenshot({ path: output + 'mobile.png', fullPage: true })
  await check('mobile has no horizontal document overflow', async () => assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)))
  mode = 'empty'; await page.reload()
  await check('empty profiles show explicit empty state', async () => { await page.getByText('Chưa có Funnel Profile data', { exact: true }).waitFor() })
  mode = 'error'; await page.reload()
  await check('API failure shows error rather than zero counts', async () => { await page.getByText('Không tải được danh sách funnel', { exact: true }).waitFor(); assert.equal(await page.locator('.tpl-funnel-chart-step').count(), 0) })
  await check('retry recovers without reloading the page', async () => { mode = 'ready'; await page.getByRole('button', { name: 'Thử tải lại danh sách funnel' }).click({ timeout: 2000 }); await ready() })
  mode = 'unconfigured'; await page.reload(); await ready()
  await check('missing policy remains explicitly unconfigured', async () => assert.match(await page.locator('main').innerText(), /chưa cấu hình/))
  mode = 'zero'; await page.reload(); await ready()
  await check('zero cohort never displays NaN or Infinity', async () => assert.doesNotMatch(await page.locator('main').innerText(), /NaN|Infinity/))
  mode = 'projection-error'; await page.reload()
  await check('projection failure recovers through its retry button', async () => {
    await page.getByText('Không tải được funnel projection', { exact: true }).waitFor()
    mode = 'ready'; await page.getByRole('button', { name: 'Thử tải lại funnel projection' }).click(); await ready()
  })
  await check('date range sends inclusive end as exclusive UTC boundary', async () => {
    await page.getByLabel('Từ ngày UTC').fill('2026-11-01')
    await page.getByLabel('Đến hết ngày UTC').fill('2026-11-03')
    const request = page.waitForRequest(r => r.url().includes('/analytics/funnels/') && new URL(r.url()).searchParams.get('from') === '2026-11-01T00:00:00.000Z')
    await page.getByRole('button', { name: 'Áp dụng', exact: true }).click()
    assert.equal(new URL((await request).url()).searchParams.get('to'), '2026-11-04T00:00:00.000Z'); await ready()
  })
  mode = 'forbidden'; await page.reload()
  await check('403 does not show cached funnel numbers', async () => {
    await page.getByText('Không tải được funnel projection', { exact: true }).waitFor()
    assert.equal(await page.locator('.tpl-funnel-chart-step').count(), 0)
  })
  mode = 'slow'; await page.reload()
  await check('leaving funnel tab aborts pending fetch', async () => {
    const deadline = Date.now() + 10000
    while (!slowStarted && Date.now() < deadline) await new Promise(r => setTimeout(r, 50))
    assert.ok(slowStarted)
    await page.getByRole('button', { name: 'Timeline tham khảo', exact: true }).click()
    await page.waitForFunction(() => window.abortedFunnelRequests > 0, null, { timeout: 3000 })
  })
  releaseSlow?.(); mode = 'ready'
  await page.getByRole('button', { name: 'Biểu đồ phễu', exact: true }).click(); await ready()
  await check('returning to funnel after cancellation reloads data', async () => assert.equal(await page.locator('.tpl-funnel-chart-step').count(), 3))
  mode = 'historical'; await page.reload(); await ready()
  await check('disabled profile shows historical warning and retains counts', async () => {
    const text = await page.getByRole('region', { name: 'Trạng thái profile' }).innerText()
    assert.match(text, /Phễu lịch sử/); assert.match(text, /2026-10-30T16:24:13.000Z/)
    assert.match(text, /không dùng để suy ra chuyển đổi/)
    assert.equal(await page.locator('.tpl-funnel-chart-step').count(), 3)
    await page.screenshot({ path: output + 'historical-profile.png', fullPage: true })
  })
  mode = 'active'; await page.reload(); await ready()
  await check('enabled profile is not labeled historical or reconciled', async () => {
    const text = await page.getByRole('region', { name: 'Trạng thái profile' }).innerText()
    assert.match(text, /đang được kích hoạt/); assert.doesNotMatch(text, /Phễu lịch sử/)
    assert.match(text, /không xác nhận/)
  })
  mode = 'ready'; await page.reload(); await ready()
  await check('older API missing activation field shows unknown rather than enabled', async () => {
    assert.match(await page.getByRole('region', { name: 'Trạng thái profile' }).innerText(), /Chưa xác định/)
  })
  mode = 'unauthorized'; await page.reload()
  await check('401 redirects to login and removes stored credentials', async () => {
    await page.waitForURL('**/login')
    assert.equal(await page.evaluate(() => localStorage.getItem('dashboard_token')), null)
  })
  await check('no browser exceptions or unexpected API calls', async () => { assert.deepEqual(errors, []); assert.deepEqual(unexpected, []) })
} finally {
  await browser?.close(); await server?.close()
  await writeFile(output + 'results.json', JSON.stringify({ capturedAt: new Date().toISOString(), environment: 'local Chromium with synthetic API; not live pipeline acceptance', results, errors, unexpected }, null, 2))
}
if (results.some(r => r.status === 'FAIL')) process.exitCode = 1
