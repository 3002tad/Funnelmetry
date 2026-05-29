import { Router } from "express";
import { fetchBannersForPeriod } from "../lib/banners-query.js";

export const bannersRouter = Router();

bannersRouter.get("/api/banners", async (req, res) => {
  const minutes = Math.min(parseInt(req.query.minutes) || 60, 1440);
  try {
    const { banners, source, diagnostics } = await fetchBannersForPeriod(minutes);
    res.json({ period_minutes: minutes, banners, source, diagnostics });
  } catch (err) {
    console.error("GET /api/banners", err.message);
    res.status(500).json({ error: "query_failed" });
  }
});
