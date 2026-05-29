import { Router } from "express";
import { handleChatMessage } from "../lib/chat/chat.service.js";

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
  const session_id = (req.body?.session_id || req.headers["x-chat-session"] || "").trim() || undefined;

  try {
    const result = await handleChatMessage(message, { minutes, session_id });
    res.json(result);
  } catch (err) {
    console.error("POST /api/chat", err.message);
    res.status(500).json({ error: "chat_failed" });
  }
});
