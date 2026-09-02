import { createHash } from "node:crypto"

const LOCK_NAME = "funnelmetry.funnel-maturity-scheduler.v1"

function evaluationId(candidate, observedAt) {
  const identity = [candidate.funnel_instance_id, candidate.target_state,
    candidate.next_step_id ?? "", candidate.due_at, observedAt].join("|")
  return `maturity-${createHash("sha256").update(identity).digest("hex")}`
}

export function createMaturitySchedulerRuntime({
  pool,
  repository,
  instanceId,
  batchSize = 100,
  pollIntervalMs = 5_000,
  now = () => new Date().toISOString(),
  logger = console,
  lockName = LOCK_NAME,
} = {}) {
  if (!pool || typeof pool.connect !== "function") throw new Error("A PostgreSQL pool is required")
  if (!repository || typeof repository.listDueCandidates !== "function"
    || typeof repository.recordEvaluation !== "function") {
    throw new Error("A maturity repository is required")
  }
  if (typeof instanceId !== "string" || !instanceId) throw new Error("instanceId is required")
  if (!Number.isSafeInteger(batchSize) || batchSize <= 0) throw new Error("batchSize must be positive")
  if (!Number.isSafeInteger(pollIntervalMs) || pollIntervalMs <= 0) {
    throw new Error("pollIntervalMs must be positive")
  }
  if (typeof lockName !== "string" || !lockName) throw new Error("lockName is required")

  let coordinationClient
  let leader = false
  let running = false
  let loopPromise
  let wakeTimer
  let wakeLoop

  async function acquireLeadership() {
    try {
      if (!coordinationClient) coordinationClient = await pool.connect()
      const alreadyLeader = leader
      const result = await coordinationClient.query(
        "SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS acquired",
        [lockName],
      )
      leader = result.rows[0].acquired
      if (alreadyLeader && leader) {
        await coordinationClient.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [lockName])
      }
      return leader
    } catch (error) {
      leader = false
      coordinationClient?.release?.(true)
      coordinationClient = undefined
      throw error
    }
  }

  async function runOnce() {
    if (!await acquireLeadership()) {
      return Object.freeze({ role: "standby", observed_at: null, candidates: 0, recorded: 0, failed: 0 })
    }
    const observedAt = new Date(now()).toISOString()
    const candidates = await repository.listDueCandidates({ observed_at: observedAt, limit: batchSize })
    let recorded = 0
    let failed = 0
    for (const candidate of candidates) {
      try {
        const result = await repository.recordEvaluation({
          evaluation_id: evaluationId(candidate, observedAt),
          funnel_instance_id: candidate.funnel_instance_id,
          source_id: candidate.source_id,
          evaluated_at: observedAt,
        })
        if (result.status === "recorded") recorded += 1
      } catch (error) {
        failed += 1
        logger.error?.(`maturity evaluation failed for ${candidate.funnel_instance_id}`, error)
      }
    }
    return Object.freeze({
      role: "leader", observed_at: observedAt, candidates: candidates.length, recorded, failed,
    })
  }

  function waitForNextPoll() {
    return new Promise((resolve) => {
      wakeLoop = resolve
      wakeTimer = setTimeout(resolve, pollIntervalMs)
    }).finally(() => {
      clearTimeout(wakeTimer)
      wakeTimer = undefined
      wakeLoop = undefined
    })
  }

  async function loop() {
    while (running) {
      try {
        const result = await runOnce()
        if (result.recorded > 0) {
          logger.info?.(`maturity scheduler ${instanceId} recorded ${result.recorded}/${result.candidates} evaluations`)
        }
      } catch (error) {
        logger.error?.("maturity scheduler poll failed", error)
      }
      if (running) await waitForNextPoll()
    }
  }

  return Object.freeze({
    runOnce,
    async start() {
      if (running) return
      running = true
      loopPromise = loop()
    },
    async stop() {
      running = false
      wakeLoop?.()
      await loopPromise
      loopPromise = undefined
      if (coordinationClient) {
        const client = coordinationClient
        try {
          if (leader) {
            await client.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [lockName])
          }
          client.release()
        } catch (error) {
          client.release?.(true)
          logger.error?.(`maturity scheduler ${instanceId} coordination shutdown failed`, error)
        } finally {
          coordinationClient = undefined
          leader = false
        }
      }
    },
  })
}
