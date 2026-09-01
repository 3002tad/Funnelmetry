import test from "node:test"
import assert from "node:assert/strict"
import express from "express"
import jwt from "jsonwebtoken"

Object.assign(process.env, {
  PORT: process.env.PORT || "32000",
  CORS_ORIGIN_DASHBOARD: process.env.CORS_ORIGIN_DASHBOARD || "http://localhost:5180",
  JWT_SECRET: process.env.JWT_SECRET || "v2-http-contract-test-secret",
  JWT_EXPIRES: process.env.JWT_EXPIRES || "1h",
  DASHBOARD_ADMIN_EMAIL: process.env.DASHBOARD_ADMIN_EMAIL || "admin@example.test",
  DASHBOARD_ADMIN_PASSWORD: process.env.DASHBOARD_ADMIN_PASSWORD || "test-password",
  PIPELINE_TRACKING_API_URL: process.env.PIPELINE_TRACKING_API_URL || "http://tracking.test",
  POSTGRES_HOST: process.env.POSTGRES_HOST || "127.0.0.1",
  POSTGRES_PORT: process.env.POSTGRES_PORT || "5432",
  POSTGRES_DB: process.env.POSTGRES_DB || "funnelmetry_test",
  POSTGRES_USER: process.env.POSTGRES_USER || "postgres",
  POSTGRES_PASSWORD: process.env.POSTGRES_PASSWORD || "postgres",
  QDRANT_URL: process.env.QDRANT_URL || "http://qdrant.test",
  QDRANT_COLLECTION: process.env.QDRANT_COLLECTION || "test",
  OLLAMA_URL: process.env.OLLAMA_URL || "http://ollama.test",
  OLLAMA_MODEL: process.env.OLLAMA_MODEL || "test",
  OLLAMA_TIMEOUT_MS: process.env.OLLAMA_TIMEOUT_MS || "1000",
})

const [{ createAnalyticsV2Router }, { requireAuth, requireShopRole }] = await Promise.all([
  import("../src/routes/analytics-v2.js"),
  import("../src/middleware/auth.js"),
])

function token(role) {
  return jwt.sign({ sub: `user-${role}`, email: `${role}@example.test`, role }, process.env.JWT_SECRET, { expiresIn: "1h" })
}

test("V2 analytics HTTP contract enforces auth, role, validation and status codes", async () => {
  const calls = []
  const repository = {
    async getOverview(scope) {
      calls.push(scope)
      return { source_id: scope.sourceId, cohort: { basis: "entry_at", from: scope.from, to: scope.to }, metric_state: "OBSERVED", profiles: [] }
    },
    async getFunnel() { return null },
    async listJourneys() { return [] },
    async getJourney() { return null },
    async listEvents() { return [] },
    async getDataHealth(scope) { return { source_id: scope.sourceId } },
  }
  const app = express()
  app.use(requireAuth, requireShopRole, createAnalyticsV2Router(repository))
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening))
  })
  const address = server.address()
  const baseUrl = `http://127.0.0.1:${address.port}`
  const request = (path, bearer) => fetch(`${baseUrl}${path}`, {
    headers: bearer ? { Authorization: `Bearer ${bearer}` } : {},
  })

  try {
    assert.equal((await request("/api/v2/analytics/overview?source_id=medusa-reference")).status, 401)
    assert.equal((await request("/api/v2/analytics/overview?source_id=medusa-reference", token("super_admin"))).status, 403)
    assert.equal((await request("/api/v2/analytics/overview", token("analyst"))).status, 400)

    const overview = await request("/api/v2/analytics/overview?source_id=medusa-reference&from=2026-08-01T00:00:00Z", token("analyst"))
    assert.equal(overview.status, 200)
    assert.equal((await overview.json()).metric_state, "OBSERVED")
    assert.equal(calls[0].sourceId, "medusa-reference")

    assert.equal((await request("/api/v2/analytics/events?source_id=medusa-reference&event_class=unknown", token("viewer"))).status, 400)
    assert.equal((await request("/api/v2/analytics/journeys/missing?source_id=medusa-reference", token("analyst"))).status, 404)
    assert.equal((await request("/api/v2/analytics/funnels/missing?source_id=medusa-reference", token("analyst"))).status, 404)
    assert.equal((await request("/api/v2/analytics/data-health?source_id=medusa-reference", token("viewer"))).status, 200)
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
})
