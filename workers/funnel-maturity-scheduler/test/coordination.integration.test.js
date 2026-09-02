import test from "node:test"
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import pg from "pg"
import { createMaturitySchedulerRuntime } from "../src/runtime.js"

const databaseUrl = process.env.TEST_DATABASE_URL

test("only one scheduler becomes leader for a PostgreSQL cluster", { skip: !databaseUrl }, async () => {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 4 })
  let polls = 0
  const repository = {
    async listDueCandidates() { polls += 1; return [] },
    async recordEvaluation() { throw new Error("no candidates expected") },
  }
  const lockName = `funnelmetry.maturity.test.${randomUUID()}`
  const first = createMaturitySchedulerRuntime({ pool, repository, instanceId: "first", lockName })
  const second = createMaturitySchedulerRuntime({ pool, repository, instanceId: "second", lockName })
  try {
    const results = await Promise.all([first.runOnce(), second.runOnce()])
    assert.deepEqual(results.map((result) => result.role).sort(), ["leader", "standby"])
    assert.equal(polls, 1)
    const leader = results[0].role === "leader" ? first : second
    const standby = leader === first ? second : first
    assert.equal((await leader.runOnce()).role, "leader")
    await leader.stop()
    assert.equal((await standby.runOnce()).role, "leader")
  } finally {
    await first.stop()
    await second.stop()
    await pool.end()
  }
})
