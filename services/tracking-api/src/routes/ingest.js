import { Router } from "express";
import { markSeen } from "../lib/business-event.dedup.js";
import { businessEventToTracking } from "../lib/business-event.mapper.js";
import { validateBusinessBatch } from "../lib/business-event.validator.js";
import { requireIngestAuth } from "../middleware/ingest-auth.js";
import { ingestOne } from "../tracking.service.js";

export const ingestRouter = Router();

async function handleBusinessBatch(req, res) {
    const validated = validateBusinessBatch(req.body);
    if (!validated.ok) {
      return res.status(400).json({
        success: false,
        error: "validation_failed",
        details: validated.errors,
      });
    }

    let accepted_count = 0;
    let duplicate_count = 0;
    let rejected_count = validated.rejected?.length || 0;
    const ingest_errors = [];

    for (const canonical of validated.events) {
      if (markSeen(canonical.event_id)) {
        duplicate_count += 1;
        continue;
      }

      const tracking = businessEventToTracking(canonical);
      if (!tracking) {
        accepted_count += 1;
        continue;
      }

      try {
        await ingestOne(tracking);
        accepted_count += 1;
      } catch (err) {
        console.error("business ingest kafka failed", canonical.event_id, err.message);
        ingest_errors.push({ event_id: canonical.event_id, error: "kafka_unavailable" });
        rejected_count += 1;
      }
    }

    const batch_id = `batch_${Date.now()}`;
    const status = ingest_errors.length ? 207 : 202;

    return res.status(status).json({
      success: ingest_errors.length === 0,
      accepted_count,
      duplicate_count,
      rejected_count,
      accepted: accepted_count,
      duplicates: duplicate_count,
      batch_id,
      errors: ingest_errors.length ? ingest_errors : undefined,
    });
}

// Web-shop tracking-adapter uses /business-events (Adapter Standard §7).
ingestRouter.post("/api/ingest/business-events", requireIngestAuth, handleBusinessBatch);
ingestRouter.post("/api/ingest/business-events/batch", requireIngestAuth, handleBusinessBatch);
