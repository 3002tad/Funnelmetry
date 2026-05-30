import { Router } from "express";
import { fetchBannersForPeriod } from "../lib/banners-query.js";
import { periodToJson, resolveAnalyticsPeriod } from "../lib/period.js";

export const bannersRouter = Router();

bannersRouter.get("/api/banners", async (req, res) => {
  const period = resolveAnalyticsPeriod(req.query, 60);
  try {
    const { banners, source, diagnostics } = await fetchBannersForPeriod(period);
    res.json({ ...periodToJson(period), banners, source, diagnostics });
  } catch (err) {
    console.error("GET /api/banners", err.message);
    res.status(500).json({ error: "query_failed" });
  }
});
