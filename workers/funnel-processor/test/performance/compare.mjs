// Frozen pre-optimization evaluator is retained only as a differential oracle.
import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { writeFile } from 'node:fs/promises'
import { evaluateFunnelWindow as before } from './evaluator-before.js'
import { evaluateFunnelWindow as after } from '../../src/evaluator.js'
import { commerceProfile } from '../fixtures.js'

let seed = 417
function random() { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32 }
function events(count) {
  const kinds = [...commerceProfile.ordered_steps, { event_type: 'order.cancelled', event_class: 'BUSINESS_FACT' }, { event_type: 'unrelated', event_class: 'CLIENT_OBSERVATION' }]
  return Array.from({ length: count }, (_, i) => {
    const kind = kinds[Math.floor(random() * kinds.length)]
    return { ...kind, canonical_event_id: `event-${i}`, occurred_at: new Date(Date.UTC(2026, 10, 1) + Math.floor(random() * 10000) * 1000).toISOString() }
  })
}
let equivalenceCases = 0
for (let i = 0; i < 200; i++) {
  const data = events(i * 5)
  // Wrong authority, equal timestamps, empty input and repeated profile pairs.
  if (i % 3 === 0) data.forEach(e => { e.occurred_at = '2026-11-01T00:00:00.000Z' })
  if (i % 5 === 0) data.forEach(e => { e.event_class = 'CLIENT_OBSERVATION' })
  const profile = i % 7 === 0 ? { ...commerceProfile, ordered_steps: [...commerceProfile.ordered_steps, { ...commerceProfile.ordered_steps[0], step_id: 'repeat-view' }] } : commerceProfile
  const inputBefore = JSON.stringify(data)
  assert.deepEqual(after(profile, data), before(profile, data))
  assert.equal(JSON.stringify(data), inputBefore)
  equivalenceCases++
}
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]
const measurements = []
for (const count of [10, 1000, 10000, 50000]) {
  const data = events(count)
  assert.deepEqual(after(commerceProfile, data), before(commerceProfile, data))
  const iterations = count === 10 ? 1000 : count === 1000 ? 20 : 1
  const sample = fn => { const start = performance.now(); for (let i = 0; i < iterations; i++) fn(commerceProfile, data); return (performance.now() - start) / iterations }
  for (let i = 0; i < 3; i++) { sample(before); sample(after) }
  const oldTimes = [], newTimes = []
  for (let i = 0; i < 9; i++) {
    if (i % 2) { newTimes.push(sample(after)); oldTimes.push(sample(before)) }
    else { oldTimes.push(sample(before)); newTimes.push(sample(after)) }
  }
  const oldMs = median(oldTimes), newMs = median(newTimes)
  measurements.push({ events: count, beforeMedianMs: oldMs, afterMedianMs: newMs, speedup: oldMs / newMs, beforeSamplesMs: oldTimes, afterSamplesMs: newTimes })
}
const result = { capturedAt: new Date().toISOString(), node: process.version, environment: 'local synthetic evaluator-only benchmark; excludes DB, Kafka and network', equivalenceCases, measurements }
await writeFile(new URL('./results.json', import.meta.url), JSON.stringify(result, null, 2))
console.log(JSON.stringify(result, null, 2))
