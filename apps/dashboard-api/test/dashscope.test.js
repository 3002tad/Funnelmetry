import test from 'node:test'
import assert from 'node:assert/strict'
import { createDashScopeClient, loadDashScopeConfig } from '../src/lib/ai/dashscope.js'

const env = { DASHBOARD_ENABLE_QWEN: 'true', DASHSCOPE_API_KEY: 'test-not-real',
  DASHSCOPE_BASE_URL: 'https://test-workspace.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1', DASHSCOPE_TIMEOUT_MS: '100' }
const messages = [{ role: 'user', content: 'Giải thích dữ liệu' }]
const success = () => Response.json({ choices: [{ finish_reason: 'stop', message: { content: 'Test answer' } }] })

test('Qwen stays disabled by default and accepts Singapore HTTPS endpoints only', async () => {
  assert.equal(loadDashScopeConfig({}), null)
  await assert.rejects(createDashScopeClient({}, () => assert.fail('outbound')).complete(messages), /qwen_disabled/)
  assert.equal(loadDashScopeConfig({ ...env, DASHSCOPE_BASE_URL: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/' }).model, 'qwen-flash')
  for (const url of ['http://dashscope-intl.aliyuncs.com/compatible-mode/v1', 'https://evil.test/compatible-mode/v1',
    'https://dashscope.aliyuncs.com/compatible-mode/v1', 'https://dashscope-intl.aliyuncs.com.evil.test/compatible-mode/v1',
    'https://secret@dashscope-intl.aliyuncs.com/compatible-mode/v1', `${env.DASHSCOPE_BASE_URL}?key=secret`]) {
    assert.throws(() => loadDashScopeConfig({ ...env, DASHSCOPE_BASE_URL: url }), /invalid_dashscope_endpoint/)
  }
  assert.throws(() => loadDashScopeConfig({ ...env, DASHSCOPE_API_KEY: '' }), /dashscope_key/)
  assert.throws(() => loadDashScopeConfig({ ...env, DASHSCOPE_TIMEOUT_MS: '0' }), /timeout/)
})

test('Qwen request uses fixed model, bounded output, no tools, and disallows redirects', async () => {
  let calls = 0
  const client = createDashScopeClient(env, async (url, options) => {
    calls++
    assert.equal(url, `${env.DASHSCOPE_BASE_URL}/chat/completions`)
    assert.equal(options.redirect, 'error')
    assert.equal(options.headers.Authorization, 'Bearer test-not-real')
    const body = JSON.parse(options.body)
    assert.equal(body.model, 'qwen-flash')
    assert.equal(body.stream, false)
    assert.equal(body.enable_thinking, false)
    assert.equal(body.max_tokens, 1024)
    assert.equal(body.tools, undefined)
    return success()
  })
  assert.equal((await client.complete(messages)).text, 'Test answer')
  assert.equal(calls, 1)
  assert.equal(JSON.stringify(client).includes('test-not-real'), false)
  await assert.rejects(client.complete([{ role: 'tool', content: 'SQL' }]), /invalid_ai_messages/)
  await assert.rejects(client.complete([{ role: 'user', content: 'x'.repeat(65536) }]), /ai_request_too_large/)
  assert.equal(calls, 1)
})

test('upstream errors are redacted and never retried', async () => {
  for (const [status, code] of [[401,'ai_auth_failed'],[403,'ai_auth_failed'],[429,'ai_rate_limited'],[500,'ai_upstream_failed']]) {
    let calls = 0
    const client = createDashScopeClient(env, async () => { calls++; return new Response('secret upstream body', { status }) })
    await assert.rejects(client.complete(messages), error => error.code === code && !error.message.includes('secret'))
    assert.equal(calls, 1)
  }
  await assert.rejects(createDashScopeClient(env, async () => { throw Error('private URL and API key') }).complete(messages), /ai_unavailable/)
})

test('invalid, truncated, tool-call and oversized responses fail closed', async () => {
  for (const response of [new Response('html'), new Response('{bad', { headers: { 'content-type': 'application/json' } }),
    Response.json({ choices: [{ finish_reason: 'length', message: { content: 'truncated' } }] }),
    Response.json({ choices: [{ finish_reason: 'stop', message: { content: 'x', tool_calls: [] } }] }),
    new Response('x'.repeat(262145), { headers: { 'content-type': 'application/json' } })]) {
    await assert.rejects(createDashScopeClient(env, async () => response).complete(messages), /ai_(invalid|incomplete|response_too_large)/)
  }
})

test('timeout covers response body, concurrency is bounded and cancellation releases slots', async () => {
  const signals = []
  const client = createDashScopeClient(env, async (_url, options) => {
    signals.push(options.signal)
    return new Response(new ReadableStream({ start() {} }), { headers: { 'content-type': 'application/json' } })
  })
  const one = assert.rejects(client.complete(messages), /ai_timeout/)
  const two = assert.rejects(client.complete(messages), /ai_timeout/)
  await assert.rejects(client.complete(messages), /ai_busy/)
  await Promise.all([one,two])
  assert.equal(signals.every(signal => signal.aborted), true)
  const abort = new AbortController()
  const pending = assert.rejects(client.complete(messages, { signal: abort.signal }), /ai_cancelled/)
  abort.abort()
  await pending
  await assert.rejects(client.complete(messages, { signal: abort.signal }), /ai_cancelled/)
})
