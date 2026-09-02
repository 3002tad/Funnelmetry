import test from "node:test"
import assert from "node:assert/strict"
import { createMaturitySchedulerRuntime } from "../src/runtime.js"

function coordinationPool(acquired) {
  const queries = []
  const client = {
    async query(sql) {
      queries.push(sql)
      if (sql.includes("pg_try_advisory_lock")) return { rows: [{ acquired }] }
      return { rows: [{ pg_advisory_unlock: true }] }
    },
    release() {},
  }
  return { pool: { async connect() { return client } }, queries }
}

test("leader polls a bounded batch and records stable requests", async () => {
  const { pool, queries } = coordinationPool(true)
  const requests = []
  const repository = {
    async listDueCandidates(request) {
      assert.deepEqual(request, { observed_at: "2026-09-02T02:00:00.000Z", limit: 10 })
      return [{
        funnel_instance_id: "funnel-1", source_id: "source-one", target_state: "MATURED",
        next_step_id: "order", due_at: "2026-09-02T01:10:00.000Z",
      }]
    },
    async recordEvaluation(request) {
      requests.push(request)
      return { status: "recorded" }
    },
  }
  const runtime = createMaturitySchedulerRuntime({
    pool, repository, instanceId: "maturity-1", batchSize: 10,
    now: () => "2026-09-02T02:00:00Z",
  })
  const result = await runtime.runOnce()
  assert.deepEqual({ role: result.role, candidates: result.candidates, recorded: result.recorded }, {
    role: "leader", candidates: 1, recorded: 1,
  })
  assert.match(requests[0].evaluation_id, /^maturity-[a-f0-9]{64}$/)
  assert.equal(requests[0].evaluated_at, "2026-09-02T02:00:00.000Z")
  await runtime.stop()
  assert.equal(queries.filter((sql) => sql.includes("pg_advisory_unlock")).length, 1)
})

test("standby does not query or mutate maturity evidence", async () => {
  const { pool } = coordinationPool(false)
  let called = false
  const repository = {
    async listDueCandidates() { called = true; return [] },
    async recordEvaluation() { called = true },
  }
  const runtime = createMaturitySchedulerRuntime({ pool, repository, instanceId: "maturity-2" })
  assert.equal((await runtime.runOnce()).role, "standby")
  assert.equal(called, false)
  await runtime.stop()
})

test("one invalid candidate does not block the rest of the batch", async () => {
  const { pool } = coordinationPool(true)
  const errors = []
  const repository = {
    async listDueCandidates() {
      return ["bad", "good"].map((id) => ({
        funnel_instance_id: id, source_id: "source-one", target_state: "MATURED",
        next_step_id: null, due_at: "2026-09-02T01:10:00.000Z",
      }))
    },
    async recordEvaluation(request) {
      if (request.funnel_instance_id === "bad") throw new Error("invalid candidate")
      return { status: "recorded" }
    },
  }
  const runtime = createMaturitySchedulerRuntime({
    pool, repository, instanceId: "maturity-1", now: () => "2026-09-02T02:00:00Z",
    logger: { error(message) { errors.push(message) } },
  })
  const result = await runtime.runOnce()
  assert.deepEqual({ candidates: result.candidates, recorded: result.recorded, failed: result.failed }, {
    candidates: 2, recorded: 1, failed: 1,
  })
  assert.match(errors[0], /bad/)
  await runtime.stop()
})

test("enabled finalization drains matured evidence with a stable identity", async () => {
  const { pool } = coordinationPool(true)
  const finalizations = []
  const repository = {
    async listDueCandidates() { return [] },
    async recordEvaluation() { throw new Error("no evaluations expected") },
    async listPendingFinalizations(request) {
      assert.deepEqual(request, { limit: 100 })
      return [{
        evaluation_id: "evaluation-1", funnel_instance_id: "funnel-1",
        source_id: "source-one", evaluated_at: "2026-09-02T01:10:00.001Z",
      }]
    },
    async finalizeDropoff(request) {
      finalizations.push(request)
      return { status: "finalized" }
    },
  }
  const runtime = createMaturitySchedulerRuntime({
    pool, repository, instanceId: "maturity-1", finalizationEnabled: true,
    now: () => "2026-09-02T02:00:00Z",
  })
  const result = await runtime.runOnce()
  assert.equal(result.finalized, 1)
  assert.match(finalizations[0].finalization_id, /^finalization-[a-f0-9]{64}$/)
  assert.equal(finalizations[0].evaluation_id, "evaluation-1")
  assert.equal(finalizations[0].finalized_at, "2026-09-02T02:00:00.000Z")
  await runtime.stop()
})
