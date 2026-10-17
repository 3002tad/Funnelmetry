// Isolated UI acceptance: synthetic API responses, no database or model calls.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from 'tailwindcss'
import autoprefixer from 'autoprefixer'
import tailwindConfig from '../tailwind.config.js'

export async function runChatBrowser(integration = null) {
if (integration) assert.match(integration.apiOrigin, /^http:\/\/127\.0\.0\.1:\d+$/)
const profile = await mkdtemp(join(tmpdir(), 'funnelmetry-ui-test-'))
let chrome, server, socket
const pending = new Map()
const errors = []
let sequence = 0
function command(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++sequence
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`Timeout: ${method}`)) }, 15000)
    pending.set(id, message => { clearTimeout(timeout); message.error ? reject(new Error(JSON.stringify(message.error))) : resolve(message.result) })
    socket.send(JSON.stringify({ id, method, params }))
  })
}
async function evaluate(expression) {
  const result = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails))
  return result.result.value
}
async function waitFor(expression) {
  const until = Date.now() + 20000
  while (Date.now() < until) {
    if (await evaluate(expression)) return
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error(`UI condition failed: ${expression}`)
}
try {
  server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), configFile: false,
    css: { postcss: { plugins: [tailwindcss({ ...tailwindConfig,
      content: ['../index.html', '../src/**/*.{ts,tsx}'].map(path => fileURLToPath(new URL(path, import.meta.url)).replaceAll('\\', '/')),
    }), autoprefixer()] } },
    envDir: false, plugins: [react()], server: { host: '127.0.0.1', port: 0,
      ...(integration ? { proxy: { '/fixture-api': { target: integration.apiOrigin, rewrite: path => path.replace(/^\/fixture-api/, '') } } } : {}) },
    define: { 'import.meta.env.VITE_DASHBOARD_API_URL': JSON.stringify('/fixture-api'),
      'import.meta.env.VITE_ANALYTICS_SOURCE_ID': JSON.stringify('medusa-reference') },
  })
  await server.listen()
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`
  chrome = spawn(process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run',
    '--disable-background-networking', '--disable-sync', 'about:blank',
  ], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] })
  const endpoint = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Chrome startup timeout')), 20000)
    chrome.once('error', error => { clearTimeout(timeout); reject(error) })
    chrome.stderr.on('data', chunk => {
      const match = chunk.toString().match(/DevTools listening on (ws:\/\/[^\s]+)/)
      if (match) { clearTimeout(timeout); resolve(match[1]) }
    })
  })
  const targets = await (await fetch(`http://${new URL(endpoint).host}/json/list`)).json()
  socket = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject })
  socket.onmessage = event => {
    const message = JSON.parse(event.data)
    if (message.id) { pending.get(message.id)?.(message); pending.delete(message.id) }
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text)
  }
  await command('Runtime.enable')
  await command('Page.enable')
  if (integration) {
    await command('Page.addScriptToEvaluateOnNewDocument', { source: `
      localStorage.setItem('dashboard_token', ${JSON.stringify(integration.token)});
      const user = ${JSON.stringify(integration.user)};
      localStorage.setItem('dashboard_user', JSON.stringify(user));
      window.testDocument = crypto.randomUUID(); window.testCalls = 0;
      const NativeDate = Date;
      window.Date = class extends NativeDate { constructor(...args) { super(...(args.length ? args : ['2026-09-23T00:00:00.000Z'])); } static now() { return new NativeDate('2026-09-23T00:00:00.000Z').getTime(); } };
      const originalFetch = window.fetch.bind(window);
      window.fetch = async (input, init) => {
        const url = new URL(String(input), location.href);
        if (url.origin !== location.origin) throw new Error('External fetch blocked');
        // Session bootstrap only; chat JWT/live-account checks use the actual API.
        if (url.pathname.endsWith('/api/auth/me')) return Response.json({user});
        const response = await originalFetch(input, init);
        if (url.pathname.endsWith('/api/v2/chat') || url.pathname.endsWith('/api/v2/chat/order-summary')) {
          window.testCalls++;
          window.testResponse = await response.clone().json();
        }
        return response;
      };` })
  } else {
  await command('Page.addScriptToEvaluateOnNewDocument', { source: `
    localStorage.setItem('dashboard_token', 'synthetic-ui-token');
    const user = { id:'ui-test', email:'test@example.invalid', display_name:'UI test', role:'analyst', permissions:['analytics.read','chat.use','pipeline.monitor'] };
    localStorage.setItem('dashboard_user', JSON.stringify(user));
    window.testDocument = crypto.randomUUID(); window.testCalls = 0; window.testMode = 'PROVISIONAL';
    window.testPreferences = {theme:'system',language:'vi',timezone:'Asia/Ho_Chi_Minh',
      date_format:'locale',number_format:'locale',notifications_enabled:true,analytics_default_days:30};
    window.testPrefsPatches = 0;
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = new URL(String(input), location.href);
      if (!url.pathname.startsWith('/fixture-api')) {
        if (url.origin !== location.origin) throw new Error('External fetch blocked in UI test');
        return originalFetch(input, init);
      }
      if (url.pathname.endsWith('/api/auth/me')) return Response.json({user});
      if (url.pathname.endsWith('/api/account/preferences')) {
        if (init?.method === 'PATCH') {
          Object.assign(window.testPreferences, JSON.parse(init.body)); window.testPrefsPatches++;
        }
        return Response.json({preferences:window.testPreferences,updated_at:null});
      }
      if (url.pathname.endsWith('/api/account/activity')) return Response.json({items:[],next_cursor:null});
      if (url.pathname.endsWith('/api/v2/analytics/overview')) return Response.json({source_id:'medusa-reference',metric_state:'OBSERVED',profiles:[{funnel_profile_id:'test-funnel',profile_version:'1',display_name:'Test funnel',entrants:10,observed_converted:2,pending:3,provisional:1,degraded:0,reconciled:0,observed_end_to_end_rate:.2}]});
      if (url.pathname.includes('/api/v2/analytics/funnels/')) return Response.json({profile:{display_name:'Test funnel'},totals:{entrants:10,observed_converted:2,observed_end_to_end_rate:.2,degraded:0,provisional:1},steps:[{step_id:'view',event_type:'behavior.page_viewed',reached:10,observed_reach_rate:1},{step_id:'order',event_type:'order.placed',reached:2,observed_reach_rate:.2}]});
      if (url.pathname.endsWith('/api/v2/analytics/events')) return Response.json({events:[{canonical_event_id:'ev-ui-test',event_type:'order.placed',event_class:'BUSINESS_FACT',occurred_at:'2026-09-23T00:00:00.000Z',produced_at:null,ingested_at:'2026-09-23T00:00:01.000Z',normalized_at:'2026-09-23T00:00:02.000Z',persisted_at:'2026-09-23T00:00:03.000Z',time_basis:'source_occurred',authoritative_event_time:true,mapping_version:'v1',journey_id:null,business_details:null}]});
      if (url.pathname.endsWith('/api/v2/analytics/data-health')) return Response.json({canonicalization:{accepted_events:10,normalized:9,quarantined:0,unsupported:0},projection_quality:{degraded:0},reconciliation:{quality_gate:{state:'PROVISIONAL'}}});
      if (url.pathname.endsWith('/api/v2/products')) return Response.json({items:[{product_id:'prod-ui-test',views:'8',adds:'2',reference:{title:'Áo mẫu'}}]});
      if (url.pathname.endsWith('/api/v2/admin/pipeline')) return Response.json({checked_at:'2026-09-23T00:00:00.000Z',metrics:{accepted:10,canonical:9,pending_claims:0}});
      if (url.pathname.endsWith('/api/v2/admin/processing')) return Response.json({checked_at:'2026-09-23T00:00:00.000Z',stages:[{stage:'canonical',retained_count:'9'}]});
      if (url.pathname.endsWith('/api/v2/admin/worker-readiness')) return Response.json({workers:[{worker:'canonical-normalizer',ready:true}]});
      if (!url.pathname.endsWith('/api/v2/chat')) throw new Error('Unexpected fixture route');
      window.testCalls++;
      const status = window.testMode;
      if (status === 'PENDING') return new Promise((resolve, reject) => {
        window.releasePending = () => resolve(Response.json({status:'generated',answer:'STALE_RESULT',evidence:[]}));
        init.signal?.addEventListener('abort', () => { window.testAborted = true; reject(new DOMException('Aborted','AbortError')); }, {once:true});
      });
      if (status === '401' || status === '403') return Response.json({error:'denied'}, {status:Number(status)});
      return Response.json({status: status === 'PROVISIONAL' ? 'generated' : status, answer: status === 'PROVISIONAL' ? 'Giá trị đơn hàng đã đặt: 20.10 EUR' : null,
        answer_verification:'DETERMINISTIC_TEMPLATE',
        ...(status === 'PROVISIONAL' ? {chart:{schema_version:'evidence-bars-v1',kind:'horizontal_bar',evidence_id:'ev-browser',title:'Đơn hàng đã đặt',meaning:'Không phải thanh toán.',truncated:false,panels:[{label:'EUR',unit:'EUR',items:[{label:'order_test',value:'20.10'}]}]}} : {}),
        evidence:[{
          evidence_id:'ev-browser', status, quality_state:'PROVISIONAL',
          result:{groups:[{currency_code:'EUR',values:{'measure.gross_order_value@1.0.0':'20.10'}}]},
          provenance:{parameters:{source_id:'medusa-reference',from:'2026-09-01',to:'2026-09-02'},warnings:['Synthetic warning']},
          semantic_context:{tool_id:'tool.metric_summary',catalog_release:'staging-test'}
        }]});
    };` })
  }
  if (!integration) {
    await command('Page.navigate', { url: `${origin}/overview` })
    await waitFor("document.body.innerText.includes('Có bao nhiêu lượt đi tới bước cuối?') && document.body.innerText.includes('20.0%')")
    assert.ok(!await evaluate("!!document.querySelector('table')"), 'technical overview is hidden by default')
    assert.ok(!await evaluate("!!document.querySelector('a[href=\"/analysis-runs\"]')"), 'advanced navigation starts collapsed')
    await evaluate("[...document.querySelectorAll('nav button')].find(button => button.textContent.includes('Xem tất cả chức năng')).click()")
    await waitFor("!!document.querySelector('a[href=\"/analysis-runs\"]')")
    await evaluate("[...document.querySelectorAll('nav button')].find(button => button.textContent.includes('Thu gọn menu')).click()")
    await waitFor("!document.querySelector('a[href=\"/analysis-runs\"]')")
    await command('Page.navigate', { url: `${origin}/funnels` })
    await waitFor("document.body.innerText.includes('Các bước trong hành trình') && document.body.innerText.includes('20.0% đi tới bước cuối')")
    await command('Page.navigate', { url: `${origin}/products` })
    await waitFor("document.body.innerText.includes('Áo mẫu') && document.body.innerText.includes('8 lượt xem')")
    await command('Page.navigate', { url: `${origin}/events` })
    await waitFor("document.body.innerText.includes('Đặt đơn hàng')")
    assert.ok(!await evaluate("!!document.querySelector('table')"), 'technical event table is hidden by default')
    await evaluate("[...document.querySelectorAll('button')].find(button => button.textContent.includes('Đặt đơn hàng')).click()")
    await waitFor("!!document.querySelector('[role=dialog]')")
    await command('Page.navigate', { url: `${origin}/data-health` })
    await waitFor("document.body.innerText.includes('Chưa đủ bằng chứng để kết luận')")
    assert.ok(!await evaluate("!!document.querySelector('svg[aria-label=\"Canonical persistence by hour\"]')"), 'technical charts are hidden by default')
    await command('Page.navigate', { url: `${origin}/admin/pipeline` })
    await waitFor("document.body.innerText.includes('Dữ liệu lưu trữ không xác nhận worker đang chạy')")
    await command('Page.navigate', { url: `${origin}/admin/processing` })
    await waitFor("document.body.innerText.includes('Worker tự báo sẵn sàng') && document.body.innerText.includes('1/1')")
  }
  await command('Page.navigate', { url: `${origin}/chat` })
  await waitFor("!!document.querySelector('textarea')")
  if (!integration) {
    await waitFor("!!document.querySelector('#theme-preference')")
    await evaluate(`{ const select=document.querySelector('#theme-preference'); select.value='dark';
      select.dispatchEvent(new Event('change',{bubbles:true})); }`)
    await waitFor("window.testPreferences.theme==='dark' && document.documentElement.classList.contains('dark')")
    await evaluate("document.querySelector('a[href=\"/settings\"]').click()")
    await waitFor("location.pathname==='/settings' && !!document.querySelector('form select')")
    assert.equal(await evaluate("document.querySelector('#theme-preference').value"), 'dark')
    await evaluate("document.querySelector('a[href=\"/chat\"]').click()")
    await waitFor("location.pathname==='/chat' && !!document.querySelector('textarea')")
    await command('Emulation.setDeviceMetricsOverride', {width:390,height:844,deviceScaleFactor:1,mobile:true})
    await evaluate("document.querySelector('[aria-label=\"Mở menu\"]').click()")
    await waitFor("document.querySelector('#app-navigation').getAttribute('role')==='dialog' && document.querySelector('.app-content').inert")
    await evaluate("document.querySelector('.app-overlay').click()")
    await waitFor("!document.querySelector('.app-content').inert && document.activeElement?.getAttribute('aria-label')==='Mở menu'")
    await command('Emulation.clearDeviceMetricsOverride')
  }
  async function reload() {
    const previous = await evaluate('window.testDocument')
    await command('Page.reload')
    await waitFor(`!!window.testDocument && window.testDocument !== ${JSON.stringify(previous)} && !!document.querySelector('textarea')`)
  }
  async function submit(mode) {
    await evaluate(`{ window.testMode = ${JSON.stringify(mode)};
      const input = document.querySelector('textarea');
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, 'Phân tích giá trị đơn hàng');
      input.dispatchEvent(new Event('input', {bubbles:true})); }`)
    await waitFor("!!document.querySelector('button[type=submit]:not(:disabled)')")
    await evaluate("document.querySelector('button[type=submit]').click()")
  }
  if (integration) {
    await submit('PROVISIONAL')
    await waitFor("!!window.testResponse && document.body.innerText.includes('giá trị đơn hàng đã đặt 20 EUR')")
    const response = await evaluate('window.testResponse')
    assert.equal(response.status, 'generated')
    assert.equal(response.answer_verification, 'DETERMINISTIC_TEMPLATE')
    const evidence = response.evidence[0]
    await evaluate(`[...document.querySelectorAll('summary')].find(x=>x.textContent.includes(${JSON.stringify(evidence.evidence_id)})).click()`)
    await waitFor("document.body.innerText.includes('order-analytics-staging-1.0.0')")
    assert.ok(await evaluate("document.body.innerText.includes('PLACED_ORDER_VALUE_NOT_PAID_REVENUE')"))
    assert.ok(await evaluate("document.querySelector('table').innerText.includes('20')"))
    await integration.verifyEvidence(evidence)
    await reload()
    await waitFor("document.body.innerText.includes('Bản khôi phục trong tab')")
    assert.equal(await evaluate('window.testCalls'), 0)
    await command('Page.navigate', { url: `${origin}/metrics` })
    await waitFor("document.body.innerText.includes('Tổng giá trị đơn hàng đã đặt') && document.body.innerText.includes('Công thức / quy tắc tổng hợp')")
    assert.ok(await evaluate("document.body.innerText.includes('DRAFT')"))
    await command('Page.navigate', { url: `${origin}/assets` })
    await waitFor("document.body.innerText.includes('analytical_fact_order_v1') && document.body.innerText.includes('order_placed_at')")
    assert.ok(await evaluate("document.body.innerText.includes('Chưa đăng ký quan hệ')"))
    await command('Page.navigate', { url: `${origin}/analysis-runs` })
    await waitFor(`document.body.innerText.includes(${JSON.stringify(evidence.analysis_run_id)})`)
    await command('Page.navigate', { url: `${origin}/evidence?id=${evidence.evidence_id}` })
    await waitFor("document.body.innerText.includes('Toàn bộ provenance và kết quả gốc')")
    await command('Page.navigate', { url: `${origin}/workspace` })
    await waitFor("!!document.querySelector('input[type=date]')")
    await evaluate("document.querySelector('button[type=submit]').click()")
    await waitFor("!!window.testResponse && !!document.querySelector('a[href^=\"/evidence?id=\"]')")
    const workspaceResult = await evaluate('window.testResponse')
    assert.equal(workspaceResult.status, 'PROVISIONAL')
    await integration.verifyEvidence(workspaceResult.evidence[0])
    const previousDocument = await evaluate('window.testDocument')
    await command('Page.reload')
    await waitFor(`!!window.testDocument && window.testDocument !== ${JSON.stringify(previousDocument)} && !!document.querySelector('input[type=date]')`)
    assert.equal(await evaluate('window.testCalls'), 0, 'workspace reload must not run analysis')
    await command('Page.navigate', {url:`${origin}/products`})
    await waitFor("document.body.innerText.includes('prod_test') && !!document.querySelector('tbody')")
    assert.ok(await evaluate("document.body.innerText.includes('không phải số khách')"))
    await command('Page.navigate', {url:`${origin}/reports?id=${evidence.evidence_id}`})
    await waitFor("document.body.innerText.includes('Báo cáo quan sát · Bản nháp')")
    await evaluate(`const input=document.querySelector('[aria-label="Lọc nguồn bằng chứng"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'missing-source');input.dispatchEvent(new Event('input',{bubbles:true}));`)
    await waitFor("document.querySelector('[aria-label=\"Lọc nguồn bằng chứng\"]').value==='missing-source'")
    await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent==='Áp dụng bộ lọc').click()")
    await waitFor("document.body.innerText.includes('Chưa có bản ghi phù hợp')")
    assert.ok(await evaluate("document.body.innerText.includes('Báo cáo quan sát · Bản nháp')"),'selected detail is independent of list filters')
    await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent==='Xóa bộ lọc').click()")
    await waitFor("!!document.querySelector('tbody a')")
    await evaluate(`URL.createObjectURL = blob => {window.reportBlob=blob;return 'blob:test-report'};
      URL.revokeObjectURL = () => {}; HTMLAnchorElement.prototype.click = function() {};
      [...document.querySelectorAll('button')].find(button=>button.textContent==='Tải bản JSON').click();`)
    const report = JSON.parse(await evaluate('window.reportBlob.text()'))
    assert.equal(report.official,false)
    assert.equal(report.persisted_report,false)
    assert.equal(report.evidence_id,evidence.evidence_id)
    assert.deepEqual(report.evidence,evidence)
    assert.ok(report.limitations.includes('PLACED_ORDER_VALUE_NOT_PAID_REVENUE'))
    await evaluate("[...document.querySelectorAll('button')].find(button=>button.textContent==='Tải báo cáo Markdown').click()")
    const markdown = await evaluate('window.reportBlob.text()')
    assert.ok(markdown.startsWith('# Báo cáo quan sát'))
    assert.ok(markdown.includes('## 4. Giới hạn'))
    assert.ok(markdown.includes('không phải doanh thu đã thanh toán'))
    assert.ok(markdown.includes(evidence.evidence_id.replaceAll('-', '\\-')))
    await waitFor("!!document.querySelector('#evidence-note')")
    await evaluate(`Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(document.querySelector('#evidence-note'),'Browser human note <script>not executable</script>');
      document.querySelector('#evidence-note').dispatchEvent(new Event('input',{bubbles:true}));`)
    await waitFor("[...document.querySelectorAll('button')].some(b=>b.textContent==='Lưu ghi chú'&&!b.disabled)")
    await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent==='Lưu ghi chú').click()")
    await waitFor("document.body.innerText.includes('Đã lưu ghi chú trên máy chủ.')")
    await reload()
    await waitFor("document.body.innerText.includes('Browser human note <script>not executable</script>')")
    assert.ok(await evaluate("document.body.innerText.includes('HUMAN_NOTE')"))
    await evaluate(`URL.createObjectURL=blob=>{window.reportBlob=blob;return 'blob:note-export'};URL.revokeObjectURL=()=>{};HTMLAnchorElement.prototype.click=function(){};
      [...document.querySelectorAll('label')].find(x=>x.textContent.includes('Kèm 25 ghi chú')).querySelector('input').click();`)
    await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent==='Tải bản JSON').click()")
    await waitFor('!!window.reportBlob')
    const withNotes=JSON.parse(await evaluate('window.reportBlob.text()'))
    assert.equal(withNotes.human_notes.items.length,1)
    assert.equal(withNotes.human_notes.items[0].content,'Browser human note <script>not executable</script>')
    assert.equal(withNotes.human_notes.items[0].origin,'HUMAN_NOTE')
    assert.equal(withNotes.human_notes.items[0].evidence_id,evidence.evidence_id)
    assert.equal(withNotes.human_notes.official,false)
    assert.deepEqual(withNotes.evidence,evidence)
    await evaluate(`window.reportBlob=null;const realFetch=window.fetch;window.fetch=(url,...args)=>String(url).endsWith('/notes')?Promise.resolve(new Response('{}',{status:503})):realFetch(url,...args);
      [...document.querySelectorAll('button')].find(b=>b.textContent==='Tải bản JSON').click();`)
    await waitFor("document.body.innerText.includes('Không xuất được báo cáo')")
    assert.equal(await evaluate('window.reportBlob'),null,'failed notes fetch must not export partial report')
    await command('Page.navigate',{url:`${origin}/findings`})
    await waitFor("document.body.innerText.includes('Findings · Đánh giá của DA') && document.body.innerText.includes('Browser human note')")
    await evaluate("const select=[...document.querySelectorAll('select')].find(s=>[...s.options].some(o=>o.value==='NEEDS_REVIEW'));select.value='NEEDS_REVIEW';select.dispatchEvent(new Event('change',{bubbles:true}))")
    await waitFor("document.body.innerText.includes('Human hypothesis') && !document.body.innerText.includes('Browser human note')")
    assert.deepEqual(errors, [])
    console.log('PASS: Chrome -> real HTTP/JWT -> PostgreSQL: chat/evidence, F5, Metrics and Assets. Planner/session bootstrap are fixtures.')
    return
  }
  await submit('PROVISIONAL')
  await waitFor("document.body.innerText.includes('20.10 EUR')")
  assert.ok(await evaluate("!!document.querySelector('figure[aria-label=\"Đơn hàng đã đặt\"]')"))
  await evaluate("[...document.querySelectorAll('summary')].find(x=>x.textContent.includes('ev-browser')).click()")
  await waitFor("document.body.innerText.includes('Synthetic warning')")
  assert.ok(await evaluate("document.body.innerText.includes('staging-test')"))
  await reload()
  await waitFor("document.body.innerText.includes('Bản khôi phục trong tab')")
  assert.ok(!await evaluate("!!document.querySelector('figure[aria-label=\"Đơn hàng đã đặt\"]')"), 'chart evidence is not persisted in tab history')
  assert.equal(await evaluate('window.testCalls'), 0, 'reload must not resend chat')
  assert.ok(await evaluate("document.body.innerText.includes('20.10 EUR')"))
  await evaluate("document.querySelector('[aria-label=\"Cuộc trò chuyện mới\"]').click()")
  await waitFor("!document.body.innerText.includes('20.10 EUR')")
  await submit('BLOCKED_BY_QUALITY')
  await waitFor("document.body.innerText.includes('Kết quả bị chặn')")
  assert.ok(!await evaluate("!!document.querySelector('figure[aria-label=\"Đơn hàng đã đặt\"]')"))
  assert.ok(!await evaluate("document.body.textContent.includes('20.10')"))
  await reload()
  await waitFor("document.body.innerText.includes('Kết quả bị chặn')")
  assert.equal(await evaluate('window.testCalls'), 0)
  await evaluate("document.querySelector('[aria-label=\"Cuộc trò chuyện mới\"]').click()")
  await submit('INSUFFICIENT_DATA')
  await waitFor("document.body.innerText.includes('không đồng nghĩa giá trị bằng 0')")
  async function reset() {
    await evaluate("document.querySelector('[aria-label=\"Cuộc trò chuyện mới\"]').click()")
    await waitFor("!document.querySelector('article')")
  }
  await reset()
  await submit('PENDING')
  await waitFor("!!document.querySelector('[aria-label=\"Dừng chờ\"]')")
  await reload()
  await waitFor("document.body.innerText.includes('Yêu cầu bị gián đoạn khi rời trang')")
  assert.equal(await evaluate('window.testCalls'), 0, 'interrupted request must not resume on reload')
  await reset()
  await submit('PENDING')
  await waitFor("!!document.querySelector('[aria-label=\"Dừng chờ\"]')")
  await evaluate("document.querySelector('[aria-label=\"Dừng chờ\"]').click()")
  await waitFor("window.testAborted === true && document.body.innerText.includes('Đã dừng chờ phản hồi')")
  await evaluate('window.releasePending()')
  assert.ok(!await evaluate("document.body.innerText.includes('STALE_RESULT')"))
  await reset()
  await submit('403')
  await waitFor("document.body.innerText.includes('Tài khoản không có quyền')")
  assert.equal(await evaluate('location.pathname'), '/chat')
  await reset()
  await submit('401')
  await waitFor("location.pathname === '/login' && !!document.querySelector('input[type=password]')")
  assert.equal(await evaluate("localStorage.getItem('dashboard_token')"), null)
  assert.equal(await evaluate("sessionStorage.getItem('funnelmetry:chat:ui-test')"), null)
  assert.deepEqual(errors, [])
  console.log('PASS: SaaS overview/funnel/products/events/quality/admin quick views, progressive details, theme/account preference, mobile navigation focus, chat/evidence, reload/reset and auth/error states; no browser exceptions. Synthetic API only.')
} finally {
  socket?.close()
  if (chrome && chrome.exitCode === null) {
    chrome.kill()
    await new Promise(resolve => { chrome.once('exit', resolve); setTimeout(resolve, 3000) })
  }
  await server?.close()
  // Only the unique disposable profile created by this process is removed.
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }).catch(() => console.warn('Temporary Chrome profile could not be removed:', profile))
}
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await runChatBrowser()
