import test from 'node:test'
import assert from 'node:assert/strict'
import { sanitizeMembership, observeMembership } from '../src/lib/kafka-membership.js'
import { collectLag } from '../src/lib/kafka-lag.js'

const description = (state = 'Stable', members = [{}]) => ({ groupId: 'worker', errorCode: 0, state, members })
test('membership keeps only broker state and count, not identities or metadata', () => {
  const row = description('Stable', [{ clientHost: 'private-host', memberId: 'private-id', memberMetadata: Buffer.from('private') }])
  assert.deepEqual(sanitizeMembership(row, 'worker'), { status: 'OBSERVED', state: 'Stable', member_count: 1 })
  for (const state of ['Empty', 'Dead', 'PreparingRebalance', 'CompletingRebalance']) {
    assert.deepEqual(sanitizeMembership(description(state, []), 'worker'), { status: 'OBSERVED', state, member_count: 0 })
  }
})
test('unknown, malformed, denied and contradictory descriptions remain unknown, not zero', async () => {
  for (const row of [null, {}, description('FutureState'), description('Stable', []), description('Empty'),
    description('Dead'), description('Stable', [null]), description('Stable', Array(1001).fill({})),
    { ...description(), errorCode: 30 }, { ...description(), groupId: 'other' }]) {
    assert.deepEqual(sanitizeMembership(row, 'worker'), { status: 'UNVERIFIED', state: null, member_count: null })
  }
  for (const result of [{ groups: [] }, { groups: [description(), description()] }, { groups: [description('FutureState')] }]) {
    assert.equal((await observeMembership({ describeGroups: async () => result }, 'worker')).status, 'UNVERIFIED')
  }
  const failed = await observeMembership({ describeGroups: async () => { throw Error('private') } }, 'worker')
  assert.ok(!JSON.stringify(failed).includes('private'))
})
test('group description is deduplicated across topics and independent of lag failure', async () => {
  const calls = []
  const admin = { connect: async () => {}, describeGroups: async ids => {
    calls.push(ids); return { groups: [description()] }
  }, fetchOffsets: async ({ topics }) => {
    if (topics[0] === 'failed') throw Error('secret')
    return [{ topic: topics[0], partitions: [{ partition: 0, offset: '4' }] }]
  }, fetchTopicOffsets: async () => [{ partition: 0, low: '0', high: '4' }] }
  const rows = await collectLag(admin, [{ group_id:'worker',topic:'ok' },{ group_id:'worker',topic:'failed' }])
  assert.deepEqual(calls, [['worker']])
  assert.equal(rows[0].lag_offsets, '0')
  assert.equal(rows[1].lag_offsets, null)
  assert.deepEqual(rows[0].membership, rows[1].membership)
  assert.equal(rows[1].membership.member_count, 1)
  admin.describeGroups = async () => { throw Error('authorization failed') }
  const [row] = await collectLag(admin, [{ group_id:'worker',topic:'ok' }])
  assert.equal(row.lag_offsets, '0')
  assert.equal(row.membership.status, 'UNVERIFIED')
})
