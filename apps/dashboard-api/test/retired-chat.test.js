import test from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import { retiredChatRouter } from '../src/routes/retired-chat.js'

test('all retired chat endpoints return Gone; unrelated AI identity remains reachable', async () => {
  const app = express()
  app.use(retiredChatRouter)
  app.get('/api/auth/ai-identity', (_req, res) => res.json({ ok: true }))
  const server = app.listen(0, '127.0.0.1')
  await new Promise(resolve => server.once('listening', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  try {
    for (const path of ['/api/chat', '/api/chat/sessions', '/api/chat/insights', '/api/v2/chat', '/api/v2/chat/order-summary']) {
      for (const method of ['GET', 'POST']) {
        const response = await fetch(base + path, { method })
        assert.equal(response.status, 410)
        assert.deepEqual(await response.json(), { error: 'pipeline_chat_retired', replacement: '/ai' })
      }
    }
    assert.equal((await fetch(base + '/api/auth/ai-identity')).status, 200)
    assert.equal((await fetch(base + '/api/chat-unrelated')).status, 404)
  } finally { await new Promise(resolve => server.close(resolve)) }
})
