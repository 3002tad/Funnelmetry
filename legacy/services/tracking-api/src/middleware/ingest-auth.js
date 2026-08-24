import { config } from "../config.js";

export function requireIngestAuth(req, res, next) {
  if (!config.ingestApiKey) {
    return res.status(503).json({ error: "business_ingest_disabled" });
  }
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token || token !== config.ingestApiKey) {
    return res.status(401).json({ error: "unauthorized" });
  }
  return next();
}
