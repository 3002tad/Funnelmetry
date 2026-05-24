import cors from "cors";
import express from "express";
import { config } from "./config.js";
import { healthRouter } from "./routes/health.js";
import { trackRouter } from "./routes/track.js";

export function createApp() {
  const app = express();
  app.use(
    cors({
      origin: config.corsOrigins,
      methods: ["GET", "POST", "OPTIONS"],
    })
  );
  app.use(express.json({ limit: "512kb" }));
  app.use(healthRouter);
  app.use(trackRouter);
  return app;
}
