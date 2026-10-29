// Exact Medusa 2.19 stage-2 v2 CDC scope. This is source context, not a
// sellable-stock or storefront-price calculation.
export const fieldsByTable = Object.freeze({
  product_sales_channel: ['id', 'product_id', 'sales_channel_id', 'deleted_at'],
  sales_channel: ['id', 'name', 'is_disabled', 'deleted_at'],
  sales_channel_stock_location: ['id', 'sales_channel_id', 'stock_location_id', 'deleted_at'],
  stock_location: ['id', 'name', 'deleted_at'],
  product_variant_inventory_item: ['id', 'variant_id', 'inventory_item_id', 'required_quantity', 'deleted_at'],
  inventory_item: ['id', 'sku', 'requires_shipping', 'deleted_at'],
  inventory_level: ['id', 'inventory_item_id', 'location_id', 'stocked_quantity', 'reserved_quantity', 'incoming_quantity', 'deleted_at'],
  reservation_item: ['id', 'inventory_item_id', 'location_id', 'quantity', 'allow_backorder', 'deleted_at'],
  product_variant_price_set: ['id', 'variant_id', 'price_set_id', 'deleted_at'],
  price_set: ['id', 'deleted_at'],
  price: ['id', 'price_set_id', 'currency_code', 'amount', 'price_list_id', 'min_quantity', 'max_quantity', 'rules_count', 'deleted_at'],
  price_list: ['id', 'status', 'starts_at', 'ends_at', 'type', 'rules_count', 'deleted_at'],
  price_rule: ['id', 'price_id', 'attribute', 'operator', 'value', 'priority', 'deleted_at'],
  price_list_rule: ['id', 'price_list_id', 'attribute', 'value', 'deleted_at'],
  region: ['id', 'currency_code', 'deleted_at'],
  currency: ['code', 'decimal_digits', 'deleted_at'],
})

const keyFieldsByTable = Object.freeze({
  product_sales_channel: ['product_id', 'sales_channel_id'],
  sales_channel_stock_location: ['sales_channel_id', 'stock_location_id'],
  product_variant_inventory_item: ['variant_id', 'inventory_item_id'],
  product_variant_price_set: ['variant_id', 'price_set_id'],
  currency: ['code'],
})
const snapshotMarkers = new Set([true, 'true', 'first', 'first_in_data_collection',
  'last_in_data_collection', 'last'])

export function decodeContextChange({topic, partition, key, value}, prefix) {
  if (partition !== 0 || !topic.startsWith(`${prefix}.public.`)) {
    throw Error('inventory_price_cdc_topic_invalid')
  }
  const table = topic.slice(`${prefix}.public.`.length)
  const fields = fieldsByTable[table]
  if (!fields) throw Error('inventory_price_cdc_table_out_of_scope')
  const keyFields = keyFieldsByTable[table] ?? ['id']
  if (!key || typeof key !== 'object' || Array.isArray(key) ||
      Object.keys(key).length !== keyFields.length ||
      keyFields.some(field => typeof key[field] !== 'string' || !key[field])) {
    throw Error('inventory_price_cdc_key_invalid')
  }
  if (value === null) return null // Debezium tombstone follows the delete.
  if (!value || !['r', 'c', 'u', 'd'].includes(value.op)) {
    throw Error('inventory_price_cdc_op_invalid')
  }
  const source = value.source ?? {}
  if (source.name !== prefix || source.db !== 'medusa' || source.schema !== 'public' ||
      source.table !== table || (source.lsn != null && !Number.isSafeInteger(source.lsn)) ||
      (value.op !== 'r' && source.lsn == null)) {
    throw Error('inventory_price_cdc_source_invalid')
  }
  const marker = source.snapshot
  if (value.op === 'r' ? !snapshotMarkers.has(marker)
    : ![false, 'false', null, undefined].includes(marker)) {
    throw Error('inventory_price_cdc_snapshot_marker_invalid')
  }
  const data = value.op === 'd' ? value.before : value.after
  if (value.op !== 'd' && (!data || typeof data !== 'object' || Array.isArray(data) ||
      Object.keys(data).length !== fields.length || fields.some(field => !(field in data)) ||
      keyFields.some(field => data[field] !== key[field]))) {
    throw Error('inventory_price_cdc_row_scope_invalid')
  }
  if (value.op === 'd' && data && Object.keys(data).some(field => !fields.includes(field))) {
    throw Error('inventory_price_cdc_delete_scope_invalid')
  }
  return {table, op: value.op, rowKey: keyFields.map(field => key[field]),
    data: value.op === 'd' ? null : data,
    sourceLsn: source.lsn == null ? null : String(source.lsn),
    snapshotMarker: value.op === 'r' ? String(marker) : null,
    snapshotLast: marker === 'last'}
}

export async function persistContextChange(client, input) {
  const {sourceId, epochId, prefix, topic, partition, offset, key, value} = input
  const change = decodeContextChange({topic, partition, key, value}, prefix)
  const n = BigInt(offset)
  await client.query('BEGIN')
  try {
    const {rows} = await client.query(`SELECT next_offset FROM inventory_price_cdc_input_offsets
      WHERE source_id=$1 AND coverage_epoch_id=$2 AND topic=$3 AND partition=$4 FOR UPDATE`,
    [sourceId, epochId, topic, partition])
    const expected = BigInt(rows[0]?.next_offset ?? 0)
    if (n > expected) throw Error('inventory_price_cdc_offset_gap')
    if (n === expected) {
      if (change) {
        const rowKey = JSON.stringify(change.rowKey)
        const payload = change.data === null ? null : JSON.stringify(change.data)
        await client.query(`INSERT INTO inventory_price_cdc_ingest_audit
          (source_id,coverage_epoch_id,topic,partition,kafka_offset,table_name,
           row_key,op,source_lsn,snapshot_marker,projected_payload)
          VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11::jsonb)`,
        [sourceId, epochId, topic, partition, offset, change.table, rowKey,
          change.op, change.sourceLsn, change.snapshotMarker, payload])
        if (change.op === 'd') {
          await client.query(`DELETE FROM inventory_price_cdc_context_current WHERE
            source_id=$1 AND coverage_epoch_id=$2 AND table_name=$3 AND row_key=$4::jsonb`,
          [sourceId, epochId, change.table, rowKey])
        } else {
          await client.query(`INSERT INTO inventory_price_cdc_context_current
            (source_id,coverage_epoch_id,table_name,row_key,payload,soft_deleted,
             source_lsn,topic,last_topic_offset)
            VALUES($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7,$8,$9)
            ON CONFLICT(source_id,coverage_epoch_id,table_name,row_key) DO UPDATE SET
              payload=EXCLUDED.payload,soft_deleted=EXCLUDED.soft_deleted,
              source_lsn=EXCLUDED.source_lsn,topic=EXCLUDED.topic,
              last_topic_offset=EXCLUDED.last_topic_offset,observed_at=now()`,
          [sourceId, epochId, change.table, rowKey, payload,
            change.data.deleted_at !== null, change.sourceLsn, topic, offset])
        }
        await client.query(`INSERT INTO inventory_price_cdc_capture_status
          (source_id,coverage_epoch_id,snapshot_last_seen,last_input_at)
          VALUES($1,$2,$3,clock_timestamp())
          ON CONFLICT(source_id,coverage_epoch_id) DO UPDATE SET
            snapshot_last_seen=inventory_price_cdc_capture_status.snapshot_last_seen OR
              EXCLUDED.snapshot_last_seen,last_input_at=EXCLUDED.last_input_at`,
        [sourceId, epochId, change.snapshotLast])
      }
      await client.query(`INSERT INTO inventory_price_cdc_input_offsets
        (source_id,coverage_epoch_id,topic,partition,next_offset)
        VALUES($1,$2,$3,$4,$5)
        ON CONFLICT(source_id,coverage_epoch_id,topic,partition) DO UPDATE
        SET next_offset=EXCLUDED.next_offset`,
      [sourceId, epochId, topic, partition, (n + 1n).toString()])
      await client.query(`UPDATE inventory_price_cdc_quality_lease
        SET status='BLOCKED_BY_QUALITY' WHERE source_id=$1 AND coverage_epoch_id=$2
          AND status='PASS'`, [sourceId, epochId])
    }
    await client.query('COMMIT')
    return {applied: n === expected, change: change?.op ?? 'tombstone'}
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  }
}
