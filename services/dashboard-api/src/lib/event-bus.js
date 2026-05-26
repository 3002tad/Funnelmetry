/**
 * In-process pub/sub for streaming new events to SSE clients.
 * The poller emits; SSE route handlers subscribe.
 */
import { EventEmitter } from "events";

export const eventBus = new EventEmitter();
// Avoid Node warning when many SSE clients connect simultaneously.
eventBus.setMaxListeners(200);
