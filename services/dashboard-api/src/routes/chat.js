import { Router } from "express";
import { handleChatMessage, listRecentInsights } from "../lib/chat/chat.service.js";

export const chatRouter = Router();

// POST /api/chat — natural language analytics (PostgreSQL + Qdrant RAG)
chatRouter.post("/api/chat", async (req, res) => {
  const message = (req.body?.message || "").trim();
  if (!message) {
    return res.status(400).json({ error: "message_required" });
  }
  const minutes = req.body?.minutes
    ? Math.min(parseInt(req.body.minutes, 10) || 60, 1440)
    : undefined;

  try {
    const result = await handleChatMessage(message, { minutes });
    res.json(result);
  } catch (err) {
    console.error("POST /api/chat", err.message);
    res.status(500).json({ error: "chat_failed" });
  }
});

// GET /api/chat/insights — recent Qdrant insights for AI panel
chatRouter.get("/api/chat/insights", async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 12, 30);
  try {
    const result = await listRecentInsights(limit);
    res.json(result);
  } catch (err) {
    console.error("GET /api/chat/insights", err.message);
    res.status(500).json({ error: "insights_failed" });
  }
});
