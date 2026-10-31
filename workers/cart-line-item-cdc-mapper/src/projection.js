import { createHash } from 'node:crypto'
import { CANONICAL_EVENT_SPEC_VERSION, validateCanonicalEvent } from '../../../packages/canonical-contract/src/index.js'

const columns = ['id', 'cart_id', 'product_id', 'variant_id', 'quantity', 'created_at', 'updated_at', 'deleted_at']
const snapshotMarkers = new Set([true, 'true', 'first', 'first_in_data_collection', 'last_in_data_collection', 'last'])
const hash = value => createHash('sha256').update(value).digest('hex')

export function decodeCartChange({ key, value, prefix, topic, partition }) {
  if (topic !== `${prefix}.public.cart_line_item` || partition !== 0) throw Error('cart_cdc_topic_invalid')
  if (!key || Object.keys(key).length !== 1 || typeof key.id !== 'string' || !key.id) {
    throw Error('cart_cdc_key_invalid')
  }
  if (value === null) return null
  if (!value || !['r', 'c', 'u', 'd'].includes(value.op)) throw Error('cart_cdc_op_invalid')
  const source = value.source ?? {}
  if (source.name !== prefix || source.db !== 'medusa' || source.schema !== 'public' ||
      source.table !== 'cart_line_item') throw Error('cart_cdc_source_invalid')
  const snapshot = value.op === 'r'
  if (snapshot ? !snapshotMarkers.has(source.snapshot)
    : ![false, 'false', null, undefined].includes(source.snapshot)) {
    throw Error('cart_cdc_snapshot_invalid')
  }
  const row = value.op === 'd' ? value.before : value.after
  if (!row || row.id !== key.id) throw Error('cart_cdc_row_key_invalid')
  if (value.op !== 'd' && (Object.keys(row).length !== columns.length ||
      columns.some(column => !Object.hasOwn(row, column)) ||
      typeof row.cart_id !== 'string' || !row.cart_id ||
      !Number.isSafeInteger(row.quantity) || row.quantity < 0)) {
    throw Error('cart_cdc_row_scope_invalid')
  }
  if (!snapshot && (!Number.isSafeInteger(source.lsn) || !Number.isSafeInteger(source.ts_ms))) {
    throw Error('cart_cdc_commit_position_missing')
  }
  return { op: value.op, row, snapshot, sourceTime: source.ts_ms, sourceLsn: source.lsn }
}

export function addedQuantity(previous, change) {
  if (!change || change.snapshot || change.op === 'd' || change.row.deleted_at !== null) return 0
  if (change.op === 'u' && !previous) throw Error('cart_cdc_update_without_baseline')
  if (previous && (previous.cart_id !== change.row.cart_id ||
      previous.variant_id !== change.row.variant_id)) throw Error('cart_cdc_line_identity_changed')
  if (!change.row.variant_id) return 0
  const old = previous && !previous.deleted ? previous.quantity : 0
  return Math.max(0, change.row.quantity - old)
}

export function canonicalCartAdded({ sourceId, epochId, topic, partition, offset, rawValue, change, quantity, now }) {
  const identity = JSON.stringify([sourceId, epochId, topic, partition, offset])
  const sourceEventId = `cdc:cart:${hash(identity)}`
  const raw = JSON.stringify(rawValue)
  const time = new Date(change.sourceTime).toISOString()
  return validateCanonicalEvent({
    canonical_event_id: `can_${hash(JSON.stringify([sourceId, sourceEventId, 'medusa-cart-line-item-cdc-v1']))}`,
    source_event_id: sourceEventId,
    source_id: sourceId,
    event_type: 'cart.item_added',
    event_class: 'BUSINESS_FACT',
    canonical_schema_version: CANONICAL_EVENT_SPEC_VERSION,
    mapping_version: 'medusa-cart-line-item-cdc-v1',
    occurred_at: time,
    produced_at: time,
    ingested_at: now,
    normalized_at: now,
    aggregate: { type: 'cart', id: change.row.cart_id },
    relations: { cart_id: change.row.cart_id, correlation_id: `cart:${change.row.cart_id}` },
    data: {
      cart_id: change.row.cart_id,
      line_item_id: change.row.id,
      variant_id: change.row.variant_id,
      ...(change.row.product_id ? { product_id: change.row.product_id } : {}),
      quantity,
      coverage_epoch_id: epochId,
    },
    quality: { time_basis: 'source_produced', authoritative_event_time: false,
      source_position: { topic, partition, offset, lsn: change.sourceLsn } },
    source_reference: { raw_record_id: `${topic}:${partition}:${offset}`,
      content_hash: hash(raw), byte_size: Buffer.byteLength(raw) },
  })
}

export async function persistCartChange(client, input) {
  const { sourceId, epochId, prefix, topic, partition, offset, key, value } = input
  const change = decodeCartChange({ key, value, prefix, topic, partition })
  const n = BigInt(offset)
  await client.query('BEGIN')
  try {
    const offsets = await client.query(`SELECT next_offset FROM cart_cdc_input_offsets
      WHERE source_id=$1 AND coverage_epoch_id=$2 AND topic=$3 AND partition=$4 FOR UPDATE`,
    [sourceId, epochId, topic, partition])
    const expected = BigInt(offsets.rows[0]?.next_offset ?? 0)
    if (n > expected) throw Error('cart_cdc_offset_gap')
    if (n === expected && change) {
      const state = await client.query(`SELECT cart_id,variant_id,quantity,deleted
        FROM cart_cdc_line_state WHERE source_id=$1 AND coverage_epoch_id=$2 AND line_item_id=$3 FOR UPDATE`,
      [sourceId, epochId, key.id])
      const previous = state.rows[0] ?? null
      const quantity = addedQuantity(previous, change)
      if (change.op === 'd') {
        await client.query(`DELETE FROM cart_cdc_line_state
          WHERE source_id=$1 AND coverage_epoch_id=$2 AND line_item_id=$3`, [sourceId, epochId, key.id])
      } else {
        await client.query(`INSERT INTO cart_cdc_line_state
          (source_id,coverage_epoch_id,line_item_id,cart_id,product_id,variant_id,quantity,deleted,source_updated_raw)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
          ON CONFLICT(source_id,coverage_epoch_id,line_item_id) DO UPDATE SET
          cart_id=EXCLUDED.cart_id,product_id=EXCLUDED.product_id,variant_id=EXCLUDED.variant_id,
          quantity=EXCLUDED.quantity,deleted=EXCLUDED.deleted,source_updated_raw=EXCLUDED.source_updated_raw`,
        [sourceId, epochId, key.id, change.row.cart_id, change.row.product_id,
          change.row.variant_id, change.row.quantity, change.row.deleted_at !== null,
          change.row.updated_at == null ? null : String(change.row.updated_at)])
      }
      if (quantity > 0) {
        const event = canonicalCartAdded({ sourceId, epochId, topic, partition, offset,
          rawValue: value, change, quantity, now: new Date().toISOString() })
        await client.query(`INSERT INTO cart_cdc_canonical_outbox
          (canonical_event_id,source_id,coverage_epoch_id,source_topic,source_partition,source_offset,canonical_event)
          VALUES($1,$2,$3,$4,$5,$6,$7::jsonb) ON CONFLICT DO NOTHING`,
        [event.canonical_event_id, sourceId, epochId, topic, partition, offset, JSON.stringify(event)])
      }
    }
    if (n === expected) {
      await client.query(`INSERT INTO cart_cdc_input_offsets
        (source_id,coverage_epoch_id,topic,partition,next_offset) VALUES($1,$2,$3,$4,$5)
        ON CONFLICT(source_id,coverage_epoch_id,topic,partition) DO UPDATE
        SET next_offset=EXCLUDED.next_offset`, [sourceId, epochId, topic, partition, (n + 1n).toString()])
    }
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  }
}
