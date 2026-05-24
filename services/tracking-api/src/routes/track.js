import { Router } from "express";
import { ingestBatch, ingestOne } from "../tracking.service.js";
import { validateBatch, validateTrackingEvent } from "../tracking.validator.js";

export const trackRouter = Router();

trackRouter.post("/track", async (req, res) => {
  const validated = validateTrackingEvent(req.body);
  if (!validated.ok) {
    return res.status(400).json({ error: "validation_failed", details: validated.errors });
  }
  try {
    const event = await ingestOne(validated.event);
    return res.status(202).json({ accepted: true, event_id: event.event_id });
  } catch (err) {
    console.error("ingest failed", err);
    return res.status(503).json({ error: "kafka_unavailable" });
  }
});

trackRouter.post("/track/batch", async (req, res) => {
  const validated = validateBatch(req.body);
  if (!validated.ok) {
    return res.status(400).json({ error: "validation_failed", details: validated.errors });
  }
  try {
    const events = await ingestBatch(validated.events);
    return res.status(202).json({
      accepted: true,
      count: events.length,
      event_ids: events.map((e) => e.event_id),
    });
  } catch (err) {
    console.error("batch ingest failed", err);
    return res.status(503).json({ error: "kafka_unavailable" });
  }
});
