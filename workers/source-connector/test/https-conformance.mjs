import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createServer } from 'node:https'
import { request as httpRequest } from 'node:http'
import { createFeedClient } from '../src/feed-client.js'
import { validateFeed } from '../src/connector.js'
import { SourceEventStore } from '../../../apps/edge-relay/src/relay-repository.js'
import { createSourceIngressHttpServer } from '../../../apps/edge-relay/src/http-server.js'
import { createSourceIngressHandler } from '../../../apps/edge-relay/src/relay-handler.js'

test('real Source Event Feed through local HTTPS reverse proxy', { timeout: 70000 }, async t => {
  const directory = process.env.TEST_TLS_DIRECTORY
  assert.ok(directory, 'run via npm run test:https')
  const repository = new SourceEventStore({ databasePath: join(directory, 'events.sqlite'),
    maxEventLogEvents: 10, maxEventLogBytes: 1048576, minFreeDiskBytes: 1, createFeedId: () => 'https-test-feed' })
  const browserKeys = { browser: { source_id: 'test-source', secret: 'test-write-key', allowed_origins: ['https://shop.example'] } }
  const metrics = { increment() {}, render() { return '' } }
  const source = createSourceIngressHttpServer({ repository, browserKeys, metrics, eventFeedTokens: { connector: 'test-read-token' },
    eventFeedMaxLimit: 100, eventFeedMaxWaitSeconds: 25, maxBodyBytes: 65536,
    handleSourceIngress: createSourceIngressHandler({ repository, browserKeys, backendKeys: {}, metrics,
      maxBodyBytes: 65536, maxPayloadBytes: 65536, maxClockSkewMs: 60000 }) })
  const servers = [source]
  const listen = server => new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  try {
    await listen(source)
    const tls = name => ({ key: readFileSync(join(directory, `${name}.key`)), cert: readFileSync(join(directory, `${name}.crt`)) })
    const proxy = createServer(tls('trusted'), (req, res) => {
      if (req.url.startsWith('/redirect')) { res.writeHead(302, { location: '/v1/events' }).end(); return }
      if (req.url.startsWith('/stall')) { res.writeHead(200).flushHeaders(); return }
      const upstream = httpRequest({ host: '127.0.0.1', port: source.address().port, path: req.url, method: req.method, headers: req.headers }, remote => {
        res.writeHead(remote.statusCode, remote.headers); remote.pipe(res)
      })
      upstream.setTimeout(35000, () => upstream.destroy())
      upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end() })
      res.on('close', () => upstream.destroy())
      req.pipe(upstream)
    })
    const untrusted = createServer(tls('untrusted'), (_req, res) => res.end('{}'))
    servers.push(proxy, untrusted)
    await listen(proxy); await listen(untrusted)
    const base = `https://127.0.0.1:${proxy.address().port}`
    const cursor = { event_feed_id: 'https-test-feed', after_seq: 0, limit: 10 }
    const client = options => createFeedClient({ url: `${base}/v1/events`, token: 'test-read-token', waitSeconds: 1, timeoutMs: 4000, ...options })

    await t.test('reject wrong Bearer token', async () => {
      await assert.rejects(client({ token: 'wrong' }).read(cursor), { code: 'FEED_HTTP_401' })
    })
    await t.test('reject untrusted certificate without disabling TLS verification', async () => {
      await assert.rejects(client({ url: `https://127.0.0.1:${untrusted.address().port}/v1/events` }).read(cursor), { code: 'FEED_UNAVAILABLE' })
    })
    await t.test('do not follow redirects with credentials', async () => {
      await assert.rejects(client({ url: `${base}/redirect` }).read(cursor), { code: 'FEED_UNAVAILABLE' })
    })
    await t.test('bound timeout while response body stalls', async () => {
      await assert.rejects(client({ url: `${base}/stall`, waitSeconds: 0, timeoutMs: 300 }).read(cursor), { code: 'INVALID_FEED_RESPONSE' })
    })
    await t.test('empty 25-second long poll survives proxy and preserves cursor', async () => {
      const started = Date.now()
      const feed = await client({ waitSeconds: 25, timeoutMs: 35000 }).read(cursor)
      assert.ok(Date.now() - started >= 24000)
      assert.deepEqual(validateFeed(feed, cursor, 10), [])
      assert.equal(feed.next_after_seq, 0)
    })
    await t.test('waiting poll wakes on durable browser event; duplicate retains sequence', async () => {
      const pending = client({ waitSeconds: 25, timeoutMs: 35000 }).read(cursor)
      await new Promise(resolve => setTimeout(resolve, 200))
      const event = { specversion: 'ingress-event.v1', source_id: 'test-source', event_id: 'tls:1', producer: 'browser_sdk',
        source_event_type: 'behavior.page_viewed', source_schema_version: '1.0', occurred_at: new Date().toISOString(),
        source_payload: { page_type: 'home', path_template: '/', page_instance_id: 'page-1' } }
      const send = () => fetch(`${base}/v1/ingress/events`, { method: 'POST', headers: { 'content-type': 'application/json',
        origin: 'https://shop.example', 'x-funnelmetry-source-key-id': 'browser', 'x-funnelmetry-write-key': 'test-write-key' }, body: JSON.stringify(event) })
      const accepted = await send(); assert.equal(accepted.status, 202)
      const receipt = await accepted.json()
      const feed = await pending
      assert.equal(validateFeed(feed, cursor, 10).length, 1)
      assert.equal(feed.events[0].event_id, event.event_id)
      const duplicate = await send(); assert.ok(duplicate.ok)
      assert.equal((await duplicate.json()).ingress_seq, receipt.ingress_seq)
    })
  } finally {
    for (const server of servers.reverse()) {
      server.closeAllConnections()
      await new Promise(resolve => server.close(resolve))
    }
    repository.close()
  }
})
