import test from 'node:test'
import assert from 'node:assert/strict'
import { reconciliationMessage } from '../src/lib/reconciliation-message.ts'
test('missing evidence explains scope without declaring a worker failure', () => {
  const text = reconciliationMessage(['NO_RECONCILIATION_EVIDENCE'])
  assert.match(text, /nguồn và khoảng thời gian/)
  assert.match(text, /không tự chứng minh/)
  assert.equal(reconciliationMessage([]), '')
  assert.equal(reconciliationMessage(['FUTURE_REASON']), '')
})
