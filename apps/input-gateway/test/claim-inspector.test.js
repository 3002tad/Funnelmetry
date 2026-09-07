import test from "node:test"
import assert from "node:assert/strict"
import { inspectClaims } from "../src/claim-inspector.js"
import { runClaimInspector } from "../src/claim-inspector-cli.js"

function fakePool(rows = [], failure) {
  const calls = []
  return {
    calls,
    connect: async () => ({
      query: async (sql, parameters) => {
        calls.push({ sql, parameters })
        if (sql.startsWith("SELECT") && failure) throw failure
        return { rows }
      },
      release: () => calls.push({ sql: "release" }),
    }),
    end: async () => calls.push({ sql: "end" }),
  }
}

test("claim inspector does not infer release from lease expiration", async () => {
  const pool = fakePool([
    { claim_state: "CLAIMED", has_fingerprint: true, explicitly_released: false, lease_expired: true },
    { claim_state: "CLAIMED", has_fingerprint: true, explicitly_released: true },
    { claim_state: "ACCEPTED", has_fingerprint: true },
    { claim_state: "ACCEPTED", has_fingerprint: false },
    { claim_state: "CLAIMED", has_fingerprint: true, send_authorized: false, has_send_guard: true, lease_expired: true },
    { claim_state: "CLAIMED", has_fingerprint: true, send_authorized: false, has_send_guard: true, lease_expired: false },
    { claim_state: "CLAIMED", has_fingerprint: true, send_authorized: false, has_send_guard: false, lease_expired: true },
  ])
  const report = await inspectClaims({ pool, sourceId: "shop' OR true --" })
  assert.deepEqual(report.claims.map(row => row.disposition), [
    "PENDING_TRANSACTION_EVIDENCE", "RETRY_ELIGIBLE", "ACCEPTED_IN_LEDGER", "MISSING_FINGERPRINT_EVIDENCE",
    "RETRY_ELIGIBLE", "PRE_SEND_LEASE_ACTIVE", "PENDING_TRANSACTION_EVIDENCE",
  ])
  assert.equal(report.kafka_outcome_verified, false)
  assert.equal(pool.calls[0].sql, "BEGIN READ ONLY")
  assert.deepEqual(pool.calls[2].parameters, ["shop' OR true --", null, 51])
  assert.doesNotMatch(pool.calls[2].sql, /receipt_document|SELECT \*/)
  assert.equal(pool.calls.at(-2).sql, "COMMIT")
  assert.equal(pool.calls.at(-1).sql, "release")
})

test("claim inspector bounds results and validates before opening database", async () => {
  const pool = fakePool([{ has_fingerprint: false }, { has_fingerprint: false }])
  for (const options of [{ sourceId: "" }, { sourceId: "shop", limit: 101 }, { sourceId: "shop", eventId: "" }]) {
    await assert.rejects(inspectClaims({ pool, ...options }))
  }
  assert.equal(pool.calls.length, 0)
  const result = await inspectClaims({ pool, sourceId: "shop", eventId: "event", limit: 1 })
  assert.equal(result.truncated, true)
  assert.equal(result.claims.length, 1)
  assert.deepEqual(pool.calls[2].parameters, ["shop", "event", 2])
})

test("inspection failure rolls back and closes CLI pool without output", async () => {
  const failure = new Error("database unavailable")
  const pool = fakePool([], failure)
  const output = []
  await assert.rejects(runClaimInspector({ argv: ["shop"], env: { DATABASE_URL: "test" },
    createPool: () => pool, writeOutput: text => output.push(text),
  }), error => error === failure)
  assert.deepEqual(output, [])
  assert.deepEqual(pool.calls.slice(-3).map(call => call.sql), ["ROLLBACK", "release", "end"])
})

test("CLI help and invalid arguments do not open database", async () => {
  const createPool = () => { throw new Error("should not connect") }
  const help = await runClaimInspector({ argv: ["--help"], createPool, writeOutput: () => {} })
  assert.equal(help.status, "help")
  await assert.rejects(runClaimInspector({ argv: ["shop", "event", "extra"], createPool }), /expected/)
  await assert.rejects(runClaimInspector({ argv: ["shop"], env: {}, createPool }), /DATABASE_URL/)
})

test("CLI emits JSON, prefers Gateway database and closes pool", async () => {
  const pool = fakePool()
  let output
  const result = await runClaimInspector({ argv: ["shop", "event"],
    env: { INPUT_GATEWAY_DATABASE_URL: "gateway", DATABASE_URL: "fallback" },
    createPool: url => { assert.equal(url, "gateway"); return pool },
    writeOutput: text => { output = text },
  })
  assert.deepEqual(JSON.parse(output), result)
  assert.equal(result.truncated, false)
  assert.deepEqual(result.claims, [])
  assert.equal(pool.calls.at(-1).sql, "end")
})
