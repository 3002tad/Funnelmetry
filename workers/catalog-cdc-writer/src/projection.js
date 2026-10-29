export const fieldsByTable = Object.freeze({
  product: ['id', 'title', 'handle', 'status', 'collection_id', 'updated_at', 'deleted_at'],
  product_variant: ['id', 'product_id', 'title', 'sku', 'manage_inventory',
    'allow_backorder', 'updated_at', 'deleted_at'],
  product_category: ['id', 'name', 'parent_category_id', 'is_active', 'is_internal',
    'updated_at', 'deleted_at'],
  product_category_product: ['product_id', 'product_category_id'],
})

const relationKey = ['product_id', 'product_category_id']
const snapshotMarkers = new Set([true, 'true', 'first', 'first_in_data_collection',
  'last_in_data_collection', 'last'])

export function decodeCatalogChange({topic, partition, key, value}, prefix) {
  if (partition !== 0 || !topic.startsWith(`${prefix}.public.`)) {
    throw Error('catalog_cdc_topic_invalid')
  }
  const table = topic.slice(`${prefix}.public.`.length)
  const fields = fieldsByTable[table]
  if (!fields) throw Error('catalog_cdc_table_out_of_scope')
  if (!key || typeof key !== 'object' || Array.isArray(key)) throw Error('catalog_cdc_key_invalid')
  const keyFields = table === 'product_category_product' ? relationKey : ['id']
  if (Object.keys(key).length !== keyFields.length ||
      keyFields.some(field => typeof key[field] !== 'string' || !key[field])) {
    throw Error('catalog_cdc_key_invalid')
  }
  const rowKey = keyFields.map(field => key[field])
  if (value === null) return null // Debezium tombstone after the delete row.
  if (!value || !['r', 'c', 'u', 'd'].includes(value.op)) throw Error('catalog_cdc_op_invalid')
  const source = value.source ?? {}
  if (source.name !== prefix || source.db !== 'medusa' || source.schema !== 'public' ||
      source.table !== table || (source.lsn != null && !Number.isSafeInteger(source.lsn)) ||
      (value.op !== 'r' && source.lsn == null)) throw Error('catalog_cdc_source_invalid')
  const snapshotMarker = source.snapshot
  if (value.op === 'r' ? !snapshotMarkers.has(snapshotMarker)
    : ![false, 'false', null, undefined].includes(snapshotMarker)) {
    throw Error('catalog_cdc_snapshot_marker_invalid')
  }
  const row = value.op === 'd' ? value.before : value.after
  if (value.op !== 'd') {
    if (!row || Object.keys(row).length !== fields.length ||
        fields.some(field => !(field in row)) ||
        keyFields.some(field => row[field] !== key[field])) {
      throw Error('catalog_cdc_row_scope_invalid')
    }
  } else if (row && Object.keys(row).some(field => !fields.includes(field))) {
    throw Error('catalog_cdc_delete_scope_invalid')
  }
  return {table, op: value.op, rowKey: JSON.stringify(rowKey),
    data: value.op === 'd' ? null : row,
    sourceLsn: source.lsn == null ? null : String(source.lsn),
    snapshotMarker: value.op === 'r' ? String(snapshotMarker) : null,
    snapshotLast: snapshotMarker === 'last'}
}

export async function applyCatalogRow(tx, sourceId, epochId, change, offset) {
  const {table, op, data} = change
  const key = JSON.parse(change.rowKey)
  const lsn = change.sourceLsn
  if (table === 'product') {
    if (op === 'd') {
      await tx('DELETE FROM catalog_cdc_products_current WHERE source_id=$1 AND coverage_epoch_id=$2 AND product_id=$3',
        [sourceId, epochId, key[0]])
    } else {
      if (typeof data.title !== 'string' || !data.title.trim()) throw Error('catalog_cdc_product_title_invalid')
      await tx(`INSERT INTO catalog_cdc_products_current
        (source_id,coverage_epoch_id,product_id,title,handle,status,collection_id,
         source_updated_raw,soft_deleted,source_lsn,last_topic_offset)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        ON CONFLICT(source_id,coverage_epoch_id,product_id) DO UPDATE SET
          title=EXCLUDED.title,handle=EXCLUDED.handle,status=EXCLUDED.status,
          collection_id=EXCLUDED.collection_id,source_updated_raw=EXCLUDED.source_updated_raw,
          soft_deleted=EXCLUDED.soft_deleted,source_lsn=EXCLUDED.source_lsn,
          last_topic_offset=EXCLUDED.last_topic_offset`,
      [sourceId, epochId, data.id, data.title, data.handle, data.status,
        data.collection_id, data.updated_at ?? null, data.deleted_at !== null, lsn, offset])
    }
  } else if (table === 'product_variant') {
    if (op === 'd') {
      await tx('DELETE FROM catalog_cdc_variants_current WHERE source_id=$1 AND coverage_epoch_id=$2 AND variant_id=$3',
        [sourceId, epochId, key[0]])
    } else {
      if (typeof data.product_id !== 'string' || !data.product_id) throw Error('catalog_cdc_variant_relation_invalid')
      await tx(`INSERT INTO catalog_cdc_variants_current
        (source_id,coverage_epoch_id,variant_id,product_id,title,sku,manage_inventory,
         allow_backorder,source_updated_raw,soft_deleted,source_lsn,last_topic_offset)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
        ON CONFLICT(source_id,coverage_epoch_id,variant_id) DO UPDATE SET
          product_id=EXCLUDED.product_id,title=EXCLUDED.title,sku=EXCLUDED.sku,
          manage_inventory=EXCLUDED.manage_inventory,allow_backorder=EXCLUDED.allow_backorder,
          source_updated_raw=EXCLUDED.source_updated_raw,soft_deleted=EXCLUDED.soft_deleted,
          source_lsn=EXCLUDED.source_lsn,last_topic_offset=EXCLUDED.last_topic_offset`,
      [sourceId, epochId, data.id, data.product_id, data.title, data.sku,
        data.manage_inventory, data.allow_backorder, data.updated_at ?? null,
        data.deleted_at !== null, lsn, offset])
    }
  } else if (table === 'product_category') {
    if (op === 'd') {
      await tx('DELETE FROM catalog_cdc_categories_current WHERE source_id=$1 AND coverage_epoch_id=$2 AND category_id=$3',
        [sourceId, epochId, key[0]])
    } else {
      await tx(`INSERT INTO catalog_cdc_categories_current
        (source_id,coverage_epoch_id,category_id,name,parent_category_id,is_active,
         is_internal,source_updated_raw,soft_deleted,source_lsn,last_topic_offset)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        ON CONFLICT(source_id,coverage_epoch_id,category_id) DO UPDATE SET
          name=EXCLUDED.name,parent_category_id=EXCLUDED.parent_category_id,
          is_active=EXCLUDED.is_active,is_internal=EXCLUDED.is_internal,
          source_updated_raw=EXCLUDED.source_updated_raw,soft_deleted=EXCLUDED.soft_deleted,
          source_lsn=EXCLUDED.source_lsn,last_topic_offset=EXCLUDED.last_topic_offset`,
      [sourceId, epochId, data.id, data.name, data.parent_category_id,
        data.is_active, data.is_internal, data.updated_at ?? null,
        data.deleted_at !== null, lsn, offset])
    }
  } else {
    if (op === 'd') {
      await tx(`DELETE FROM catalog_cdc_product_categories_current WHERE
        source_id=$1 AND coverage_epoch_id=$2 AND product_id=$3 AND category_id=$4`,
      [sourceId, epochId, key[0], key[1]])
    } else {
      await tx(`INSERT INTO catalog_cdc_product_categories_current
        (source_id,coverage_epoch_id,product_id,category_id,source_lsn,last_topic_offset)
        VALUES($1,$2,$3,$4,$5,$6)
        ON CONFLICT(source_id,coverage_epoch_id,product_id,category_id) DO UPDATE SET
          source_lsn=EXCLUDED.source_lsn,last_topic_offset=EXCLUDED.last_topic_offset`,
      [sourceId, epochId, data.product_id, data.product_category_id, lsn, offset])
    }
  }
}

export async function persistCatalogChange(client, input) {
  const {sourceId, epochId, prefix, topic, partition, offset, key, value} = input
  const change = decodeCatalogChange({topic, partition, key, value}, prefix)
  const n = BigInt(offset)
  await client.query('BEGIN')
  try {
    const {rows} = await client.query(`SELECT next_offset FROM catalog_cdc_input_offsets
      WHERE source_id=$1 AND coverage_epoch_id=$2 AND topic=$3 AND partition=$4 FOR UPDATE`,
    [sourceId, epochId, topic, partition])
    const expected = BigInt(rows[0]?.next_offset ?? 0)
    if (n > expected) throw Error('catalog_cdc_offset_gap')
    if (n === expected) {
      if (change) {
        await client.query(`INSERT INTO catalog_cdc_ingest_audit
          (source_id,coverage_epoch_id,topic,partition,kafka_offset,table_name,
           row_key,op,source_lsn,snapshot_marker,projected_payload)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)`,
        [sourceId, epochId, topic, partition, offset, change.table, change.rowKey,
          change.op, change.sourceLsn, change.snapshotMarker,
          change.data === null ? null : JSON.stringify(change.data)])
        await applyCatalogRow(async (sql, params) => client.query(sql, params),
          sourceId, epochId, change, offset)
        await client.query(`INSERT INTO catalog_cdc_capture_status
          (source_id,coverage_epoch_id,snapshot_last_seen,last_input_at)
          VALUES($1,$2,$3,clock_timestamp())
          ON CONFLICT(source_id,coverage_epoch_id) DO UPDATE SET
            snapshot_last_seen=catalog_cdc_capture_status.snapshot_last_seen OR
              EXCLUDED.snapshot_last_seen,last_input_at=EXCLUDED.last_input_at`,
        [sourceId, epochId, change.snapshotLast])
      }
      await client.query(`INSERT INTO catalog_cdc_input_offsets
        (source_id,coverage_epoch_id,topic,partition,next_offset)
        VALUES($1,$2,$3,$4,$5)
        ON CONFLICT(source_id,coverage_epoch_id,topic,partition) DO UPDATE
        SET next_offset=EXCLUDED.next_offset`,
      [sourceId, epochId, topic, partition, (n + 1n).toString()])
      await client.query(`UPDATE catalog_cdc_quality_lease
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
