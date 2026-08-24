import { Router } from "express";
import {
  createChatSessionForUser,
  handleChatMessage,
  listUserChatSessions,
  loadUserChatMessages,
  removeUserChatSession,
} from "../lib/chat/chat.service.js";
import { resolveAnalyticsPeriod } from "../lib/period.js";

export const chatRouter = Router();

// POST /api/chat — natural language analytics (PostgreSQL + Qdrant RAG)
chatRouter.post("/api/chat", async (req, res) => {
  const message = (req.body?.message || "").trim();
  if (!message) {
    return res.status(400).json({ error: "message_required" });
  }
  const dateRaw = (req.body?.date || "").trim() || undefined;
  const hasBodyMinutes = req.body?.minutes != null && req.body?.minutes !== "";
  let minutes;
  let date;
  if (dateRaw) {
    const period = resolveAnalyticsPeriod({ date: dateRaw }, 60);
    date = period.type === "day" ? period.date : dateRaw;
  } else if (hasBodyMinutes) {
    const period = resolveAnalyticsPeriod({ minutes: req.body.minutes }, 60);
    minutes = period.type === "rolling" ? period.minutes : undefined;
  }

  const session_id = (req.body?.session_id || req.headers["x-chat-session"] || "").trim() || undefined;

  try {
    const result = await handleChatMessage(message, {
      minutes,
      date,
      session_id,
      user_id: req.user?.id,
    });
    res.json(result);
  } catch (err) {
    console.error("POST /api/chat", err.message);
    res.status(500).json({ error: "chat_failed" });
  }
});

// GET /api/chat/sessions — list saved conversations for current user
chatRouter.get("/api/chat/sessions", async (req, res) => {
  try {
    const sessions = await listUserChatSessions(req.user.id);
    res.json({ sessions });
  } catch (err) {
    console.error("GET /api/chat/sessions", err.message);
    res.status(500).json({ error: "chat_sessions_failed" });
  }
});

// POST /api/chat/sessions — start a new conversation
chatRouter.post("/api/chat/sessions", async (req, res) => {
  try {
    const row = await createChatSessionForUser(req.user.id);
    res.status(201).json(row);
  } catch (err) {
    console.error("POST /api/chat/sessions", err.message);
    res.status(500).json({ error: "chat_session_create_failed" });
  }
});

// GET /api/chat/sessions/:sessionId/messages
chatRouter.get("/api/chat/sessions/:sessionId/messages", async (req, res) => {
  try {
    const data = await loadUserChatMessages(req.params.sessionId, req.user.id);
    if (!data.found) return res.status(404).json({ error: "session_not_found" });
    res.json(data);
  } catch (err) {
    console.error("GET /api/chat/sessions/:id/messages", err.message);
    res.status(500).json({ error: "chat_messages_failed" });
  }
});

// DELETE /api/chat/sessions/:sessionId
chatRouter.delete("/api/chat/sessions/:sessionId", async (req, res) => {
  try {
    const result = await removeUserChatSession(req.params.sessionId, req.user.id);
    if (!result.deleted) return res.status(404).json({ error: "session_not_found" });
    res.json(result);
  } catch (err) {
    console.error("DELETE /api/chat/sessions/:id", err.message);
    res.status(500).json({ error: "chat_session_delete_failed" });
  }
});
