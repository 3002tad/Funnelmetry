// Operator-side, read-only probe for the versioned CDC order/journey candidate.
// It never activates a Funnel Profile or writes an analytical binding.
import pg from 'pg'
import { postgresConfig } from '../../shared/postgres-config.mjs'
import { createShadowOrderJourneyReadPath } from './shadow-read-path.js'

const args = process.argv.slice(2)
if (args.length !== 2 || args[0] !== '--order-id' ||
    !/^order_[A-Z0-9]{26}$/.test(args[1])) {
  throw Error('usage: node src/read-shadow-order.mjs --order-id order_<ULID>')
}
if (process.env.REFERENCE_CDC_MODE !== 'SHADOW_ONLY') {
  throw Error('shadow_order_read_requires_shadow_mode')
}
const sourceInstanceId = process.env.SOURCE_INSTANCE_ID
const coverageEpochId = process.env.COVERAGE_EPOCH_ID
if (!sourceInstanceId || !coverageEpochId) {
  throw Error('shadow_order_read_source_epoch_required')
}

// The target topology stores journey and order candidates in one PostgreSQL DB.
// The reader still takes independent pools so it rechecks the lease/revision
// after the cross-store read exactly as it would in a split topology.
const pool = new pg.Pool({ ...postgresConfig(), max: 3, connectionTimeoutMillis: 10000 })
try {
  const reader = createShadowOrderJourneyReadPath({orderPool:pool, journeyPool:pool})
  const result = await reader.read({sourceInstanceId, sourceId:sourceInstanceId,
    coverageEpochId, orderId:args[1]})
  process.stdout.write(JSON.stringify(result) + '\n')
  if (result.status !== 'BOUND_SHADOW') process.exitCode = 2
} finally {
  await pool.end()
}
