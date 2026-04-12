import type { Event, Config, EmitRequest } from "../types";

const API_BASE_URL = "/api-generator";
const DASHBOARD_API_URL = "/dashboard-api";

export const generatorApi = {
  // Health check
  async health(): Promise<{ ok: boolean; time: string }> {
    const res = await fetch(`${API_BASE_URL}/health`);
    if (!res.ok) throw new Error("API health check failed");
    return res.json();
  },

  // Get single event
  async getEvent(): Promise<Event> {
    const res = await fetch(`${API_BASE_URL}/gen/event`);
    if (!res.ok) throw new Error("Failed to get event");
    return res.json();
  },

  // Get multiple events
  async getEvents(count: number): Promise<{ total: number; events: Event[] }> {
    const res = await fetch(`${API_BASE_URL}/gen/events?count=${count}`);
    if (!res.ok) throw new Error("Failed to get events");
    return res.json();
  },

  // Get config
  async getConfig(): Promise<Config> {
    const res = await fetch(`${API_BASE_URL}/gen/config`);
    if (!res.ok) throw new Error("Failed to get config");
    return res.json();
  },

  // Update config
  async updateConfig(
    config: Partial<Config>,
  ): Promise<{ message: string; config: Config }> {
    const res = await fetch(`${API_BASE_URL}/gen/config`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config),
    });
    if (!res.ok) throw new Error("Failed to update config");
    return res.json();
  },

  // Emit custom event (publishes to Kafka)
  async emitEvent(request: EmitRequest): Promise<Event> {
    const res = await fetch(`${API_BASE_URL}/gen/emit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
    if (!res.ok) throw new Error("Failed to emit event");
    return res.json();
  },

  // Emit a batch of random events (publishes all to Kafka)
  async emitBatch(
    count: number,
  ): Promise<{ count: number; published: boolean; events: Event[] }> {
    const res = await fetch(`${API_BASE_URL}/gen/emit-batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ count }),
    });
    if (!res.ok) throw new Error("Failed to emit batch");
    return res.json();
  },

  // Fetch recent live events from dashboard-api (PostgreSQL)
  async getLiveEvents(pageSize = 50): Promise<{
    events: Event[];
    total: number;
    statusCounts: { success: number; pending: number; failed: number };
  }> {
    const res = await fetch(
      `${DASHBOARD_API_URL}/api/events?page=1&pageSize=${pageSize}`,
    );
    if (!res.ok) throw new Error("Failed to fetch live events");
    const data = await res.json();
    // Normalise: dashboard-api returns eventTime as ISO string,
    // metadata may be absent — fill in a default so EventLogTable renders correctly
    const events = (data.events as any[]).map((e) => ({
      id: e.id,
      eventTime: e.eventTime,
      eventType: e.eventType,
      orderId: e.orderId,
      userId: e.userId,
      amount: e.amount,
      currency: e.currency,
      status: e.status,
      metadata: e.metadata ?? { device: "desktop" },
    }));
    const statusCounts = data.statusCounts ?? {
      success: 0,
      pending: 0,
      failed: 0,
    };
    return { events, total: data.total ?? events.length, statusCounts };
  },
};
