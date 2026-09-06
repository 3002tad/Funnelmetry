import assert from "node:assert/strict"
import test from "node:test"
import { runCli, USAGE } from "../src/cli.js"

function harness({ argv, document = {}, methodResult = { status: "recorded" }, env } = {}) {
  const calls = []
  const output = []
  let poolEnded = false
  const repository = new Proxy({}, {
    get(_target, method) {
      return async (request) => {
        calls.push({ method, request })
        return methodResult
      }
    },
  })
  return {
    calls,
    output,
    poolEnded: () => poolEnded,
    options: {
      argv,
      env: env ?? { RECONCILIATION_DATABASE_URL: "postgresql://local/reconciliation" },
      readText: async () => JSON.stringify(document),
      writeOutput: (value) => output.push(value),
      createPool: (connectionString) => ({
        connectionString,
        end: async () => { poolEnded = true },
      }),
      createRepository: ({ pool }) => {
        calls.push({ method: "createRepository", connectionString: pool.connectionString })
        return repository
      },
    },
  }
}

test("prints help without opening a database connection", async () => {
  const state = harness({ argv: ["--help"], env: {} })
  const result = await runCli(state.options)
  assert.deepEqual(result, { status: "help" })
  assert.equal(state.output.join(""), `${USAGE}\n`)
  assert.deepEqual(state.calls, [])
  assert.equal(state.poolEnded(), false)
})

for (const [command, method] of [
  ["snapshot", "recordSnapshot"],
  ["projection", "recordCurrentProjection"],
  ["compare", "recordComparison"],
  ["repair", "repairComparison"],
  ["verify", "verifyRepair"],
]) {
  test(`${command} dispatches one JSON document to ${method}`, async () => {
    const document = { command }
    const state = harness({ argv: [command, `${command}.json`], document })
    const result = await runCli(state.options)
    assert.deepEqual(result, { status: "recorded" })
    assert.deepEqual(state.calls, [
      { method: "createRepository", connectionString: "postgresql://local/reconciliation" },
      { method, request: document },
    ])
    assert.equal(state.poolEnded(), true)
    assert.deepEqual(JSON.parse(state.output.join("")), { status: "recorded" })
  })
}

test("rejects unknown commands before reading files or opening the database", async () => {
  const state = harness({ argv: ["unknown", "request.json"] })
  await assert.rejects(() => runCli(state.options), /unsupported command/)
  assert.deepEqual(state.calls, [])
  assert.equal(state.poolEnded(), false)
})

test("requires database configuration without exposing a CLI credential option", async () => {
  const state = harness({ argv: ["snapshot", "request.json"], env: {} })
  await assert.rejects(() => runCli(state.options), /DATABASE_URL is required/)
  assert.deepEqual(state.calls, [])
  assert.equal(state.poolEnded(), false)
})

test("always closes the pool when a repository operation fails", async () => {
  const state = harness({ argv: ["repair", "request.json"] })
  state.options.createRepository = () => ({
    repairComparison: async () => { throw new Error("stale comparison") },
  })
  await assert.rejects(() => runCli(state.options), /stale comparison/)
  assert.equal(state.poolEnded(), true)
})
