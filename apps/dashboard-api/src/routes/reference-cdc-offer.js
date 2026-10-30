import { Router } from 'express';
import { repeatableReadOnlyTransaction } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { requireLiveSession } from '../middleware/live-session.js';
import { requireLivePermission } from '../middleware/live-permission.js';
import { resolveReferenceOffer, STAGE2_TABLES } from '../lib/reference-cdc-offer.js';

const id = value => typeof value === 'string' && /^[A-Za-z0-9_-]{3,128}$/.test(value);

export function createReferenceCdcOfferRouter({ readOnly = repeatableReadOnlyTransaction } = {}) {
  const router = Router();
  router.get('/api/v2/reference-cdc/current-offer', requireAuth, requireLiveSession(),
    requireLivePermission('analytics.read'), async (req, res) => {
      res.set('Cache-Control', 'no-store');
      const q = req.query;
      if (Object.keys(q).sort().join(',') !==
          'currency_code,product_id,region_id,sales_channel_id,source_id,variant_id' ||
          !['source_id', 'product_id', 'variant_id', 'sales_channel_id', 'region_id', 'currency_code']
            .every(key => id(q[key])) || q.source_id !== 'medusa-reference') {
        return res.status(400).json({ error: 'invalid_reference_offer_query' });
      }
      try {
        const data = await readOnly(async tx => {
          const [catalog] = await tx(`SELECT b.coverage_epoch_id, q.verified_at,
            b.state='ACTIVE' AND q.status='PASS' AND q.snapshot_complete
            AND q.valid_until>clock_timestamp() AND q.source_digest IS NOT NULL
            AND q.source_digest=q.projection_digest
            AND q.source_row_counts=q.projection_row_counts
            AND q.topic_end_offsets=q.applied_offsets
            AND q.slot_status IN ('reserved','extended') AND q.connector_running AS ready
            FROM catalog_cdc_binding b JOIN catalog_cdc_quality_lease q
              ON q.source_id=b.source_id AND q.coverage_epoch_id=b.coverage_epoch_id
            WHERE b.source_id=$1`, [q.source_id]);
          const [stage] = await tx(`SELECT coverage_epoch_id, verified_at,
            status='PASS' AND snapshot_complete AND valid_until>clock_timestamp()
            AND source_digest IS NOT NULL AND source_digest=projection_digest
            AND source_row_counts=projection_row_counts
            AND topic_end_offsets=applied_offsets
            AND slot_status IN ('reserved','extended') AND connector_running AS ready,
            source_row_counts FROM inventory_price_cdc_quality_lease WHERE source_id=$1`, [q.source_id]);
          if (!catalog?.ready || !stage?.ready ||
              STAGE2_TABLES.some(table => !Object.hasOwn(stage.source_row_counts, table))) {
            return { status: 'BLOCKED_BY_QUALITY', reason: 'cdc_lease_or_coverage_unavailable' };
          }
          const [product] = await tx(`SELECT product_id,status,soft_deleted FROM catalog_cdc_products_current
            WHERE source_id=$1 AND coverage_epoch_id=$2 AND product_id=$3`,
          [q.source_id, catalog.coverage_epoch_id, q.product_id]);
          const [variant] = await tx(`SELECT variant_id,product_id,manage_inventory,allow_backorder,soft_deleted
            FROM catalog_cdc_variants_current WHERE source_id=$1 AND coverage_epoch_id=$2 AND variant_id=$3`,
          [q.source_id, catalog.coverage_epoch_id, q.variant_id]);
          const raw = await tx(`SELECT table_name,payload,soft_deleted FROM inventory_price_cdc_context_current
            WHERE source_id=$1 AND coverage_epoch_id=$2`, [q.source_id, stage.coverage_epoch_id]);
          const rows = Object.fromEntries(STAGE2_TABLES.map(table => [table, []]));
          for (const row of raw) {
            if (!Object.hasOwn(rows, row.table_name)) {
              return { status: 'BLOCKED_BY_QUALITY', reason: 'unapproved_cdc_table' };
            }
            rows[row.table_name].push(row);
          }
          const offer = resolveReferenceOffer({ rows, product, variant,
            salesChannelId: q.sales_channel_id, regionId: q.region_id, currencyCode: q.currency_code });
          return { status: 'REFERENCE_CURRENT_ONLY', contract: 'reference.medusa.current_offer.v1',
            grain: 'source_id × variant_id × sales_channel_id × region_id × currency_code',
            source_id: q.source_id, product_id: q.product_id, variant_id: q.variant_id,
            sales_channel_id: q.sales_channel_id, region_id: q.region_id,
            catalog_epoch_id: catalog.coverage_epoch_id, stage2_epoch_id: stage.coverage_epoch_id,
            catalog_verified_at: catalog.verified_at, stage2_verified_at: stage.verified_at,
            price: offer.price, inventory: offer.inventory,
            limitations: ['Current reference only; never a historical order amount.',
              'Unsupported price, stock, reservation or location shape returns UNVERIFIED.'] };
        });
        return res.status(data.status === 'BLOCKED_BY_QUALITY' ? 503 : 200).json(data);
      } catch (error) {
        console.error('GET CDC current offer', error.message);
        return res.status(503).json({ status: 'BLOCKED_BY_QUALITY', reason: 'cdc_offer_unavailable' });
      }
    });
  return router;
}
