import test from 'node:test'
import assert from 'node:assert/strict'
import {dateWindow,defaultDateRange} from '../src/lib/date-range.ts'
test('inclusive UTC dates become exclusive HTTP end without timezone drift',()=>{
 assert.deepEqual(dateWindow('2026-10-31/2026-11-01'),{from:'2026-10-31T00:00:00.000Z',to:'2026-11-02T00:00:00.000Z'})
 assert.equal(defaultDateRange(new Date('2026-11-06T14:00:00Z')),'2026-10-08/2026-11-06')
})
test('invalid calendar dates and inverted windows fail closed',()=>{for(const r of ['2026-02-30/2026-03-01','2026-11-06/2026-11-05'])assert.throws(()=>dateWindow(r))})
