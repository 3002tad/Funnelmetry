import { randomUUID } from "node:crypto"
import { mkdirSync, statfsSync } from "node:fs"
import { dirname } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { RelayError } from "./errors.js"
import { fingerprintIngressEvent } from "./fingerprint.js"

function asNumber(value) {
  return typeof value === "bigint" ? Number(value) : Number(value ?? 0)
}

function nextLease(now, leaseMs) {
  return new Date(Date.parse(now) + leaseMs).toISOString()
}

function closeTransaction(database) {
  try {
    database.exec("ROLLBACK")
  } catch {}
}

export class RelayRepository {
  constructor({ databasePath, maxSpoolEvents, maxSpoolBytes, minFreeDiskBytes, createRelayId = () => `rel_${randomUUID()}` }) {
    mkdirSync(dirname(databasePath), { recursive: true })
    this.databasePath = databasePath
    this.maxSpoolEvents = maxSpoolEvents
    this.maxSpoolBytes = maxSpoolBytes
    this.minFreeDiskBytes = minFreeDiskBytes
    this.createRelayId = createRelayId
    this.database = new DatabaseSync(databasePath)
    this.database.exec("PRAGMA journal_mode = WAL")
    this.database.exec("PRAGMA synchronous = FULL")
    this.database.exec("PRAGMA busy_timeout = 5000")
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS relay_events (
        relay_id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        event_id TEXT NOT NULL,
        event_fingerprint TEXT NOT NULL,
        raw_body TEXT NOT NULL,
        payload_bytes INTEGER NOT NULL,
        relay_received_at TEXT NOT NULL,
        state TEXT NOT NULL CHECK(state IN ('QUEUED', 'FORWARDING', 'DELIVERED', 'QUARANTINED')),
        attempt_count INTEGER NOT NULL DEFAULT 0,
        next_attempt_at TEXT,
        lease_owner TEXT,
        lease_expires_at TEXT,
        last_error_code TEXT,
        gateway_status TEXT,
        gateway_ingestion_id TEXT,
        delivered_at TEXT,
        UNIQUE(source_id, event_id)
      );
      CREATE INDEX IF NOT EXISTS relay_events_due_idx
        ON relay_events(state, next_attempt_at, lease_expires_at);
    `)
  }

  getOne(sql, values = []) {
    return this.database.prepare(sql).get(...values)
  }

  getAll(sql, values = []) {
    return this.database.prepare(sql).all(...values)
  }

  run(sql, values = []) {
    return this.database.prepare(sql).run(...values)
  }

  assertDiskCapacity() {
    const stat = statfsSync(dirname(this.databasePath))
    const freeBytes = asNumber(stat.bavail) * asNumber(stat.bsize)
    if (freeBytes < this.minFreeDiskBytes) throw new RelayError("spool_disk_low")
  }

  enqueue({ event, rawBody, receivedAt }) {
    const fingerprint = fingerprintIngressEvent(event)
    const payloadBytes = Buffer.byteLength(rawBody, "utf8")
    this.database.exec("BEGIN IMMEDIATE")
    try {
      const existing = this.getOne(
        "SELECT relay_id, source_id, event_id, event_fingerprint, relay_received_at, state FROM relay_events WHERE source_id = ? AND event_id = ?",
        [event.source_id, event.event_id],
      )
      if (existing) {
        if (existing.event_fingerprint !== fingerprint) throw new RelayError("event_identity_conflict")
        this.database.exec("COMMIT")
        return { record: existing, duplicate: true }
      }

      this.assertDiskCapacity()
      const usage = this.getOne("SELECT COUNT(*) AS count, COALESCE(SUM(payload_bytes), 0) AS bytes FROM relay_events")
      if (asNumber(usage.count) >= this.maxSpoolEvents || asNumber(usage.bytes) + payloadBytes > this.maxSpoolBytes) {
        throw new RelayError("spool_capacity_exhausted")
      }

      const relayId = this.createRelayId()
      this.run(
        `INSERT INTO relay_events (
          relay_id, source_id, event_id, event_fingerprint, raw_body, payload_bytes,
          relay_received_at, state, next_attempt_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'QUEUED', ?)`,
        [relayId, event.source_id, event.event_id, fingerprint, rawBody, payloadBytes, receivedAt, receivedAt],
      )
      const record = this.getOne(
        "SELECT relay_id, source_id, event_id, relay_received_at, state FROM relay_events WHERE relay_id = ?",
        [relayId],
      )
      this.database.exec("COMMIT")
      return { record, duplicate: false }
    } catch (error) {
      closeTransaction(this.database)
      throw error
    }
  }

  claimDue({ now, owner, leaseMs, limit }) {
    this.database.exec("BEGIN IMMEDIATE")
    try {
      const candidates = this.getAll(
        `SELECT relay_id FROM relay_events
         WHERE (state = 'QUEUED' AND next_attempt_at <= ?)
            OR (state = 'FORWARDING' AND lease_expires_at <= ?)
         ORDER BY relay_received_at ASC
         LIMIT ?`,
        [now, now, limit],
      )
      const leaseExpiresAt = nextLease(now, leaseMs)
      const claimed = []
      for (const candidate of candidates) {
        const updated = this.run(
          `UPDATE relay_events
           SET state = 'FORWARDING', attempt_count = attempt_count + 1,
               lease_owner = ?, lease_expires_at = ?, last_error_code = NULL
           WHERE relay_id = ?
             AND ((state = 'QUEUED' AND next_attempt_at <= ?)
               OR (state = 'FORWARDING' AND lease_expires_at <= ?))`,
          [owner, leaseExpiresAt, candidate.relay_id, now, now],
        )
        if (asNumber(updated.changes) !== 1) continue
        claimed.push(this.getOne(
          `SELECT relay_id, source_id, event_id, raw_body, relay_received_at, state,
                  attempt_count, lease_owner, lease_expires_at
           FROM relay_events WHERE relay_id = ?`,
          [candidate.relay_id],
        ))
      }
      this.database.exec("COMMIT")
      return claimed
    } catch (error) {
      closeTransaction(this.database)
      throw error
    }
  }

  markDelivered({ relayId, owner, receipt, deliveredAt }) {
    const updated = this.run(
      `UPDATE relay_events
       SET state = 'DELIVERED', lease_owner = NULL, lease_expires_at = NULL,
           gateway_status = ?, gateway_ingestion_id = ?, delivered_at = ?, next_attempt_at = NULL
       WHERE relay_id = ? AND state = 'FORWARDING' AND lease_owner = ?`,
      [receipt.status, receipt.ingestion_id ?? null, deliveredAt, relayId, owner],
    )
    return asNumber(updated.changes) === 1
  }

  markRetry({ relayId, owner, nextAttemptAt, reasonCode }) {
    const updated = this.run(
      `UPDATE relay_events
       SET state = 'QUEUED', lease_owner = NULL, lease_expires_at = NULL,
           next_attempt_at = ?, last_error_code = ?
       WHERE relay_id = ? AND state = 'FORWARDING' AND lease_owner = ?`,
      [nextAttemptAt, reasonCode, relayId, owner],
    )
    return asNumber(updated.changes) === 1
  }

  markQuarantined({ relayId, owner, reasonCode }) {
    const updated = this.run(
      `UPDATE relay_events
       SET state = 'QUARANTINED', lease_owner = NULL, lease_expires_at = NULL,
           next_attempt_at = NULL, last_error_code = ?, gateway_status = 'rejected'
       WHERE relay_id = ? AND state = 'FORWARDING' AND lease_owner = ?`,
      [reasonCode, relayId, owner],
    )
    return asNumber(updated.changes) === 1
  }

  getStatus(now) {
    const states = this.getAll("SELECT state, COUNT(*) AS count FROM relay_events GROUP BY state")
    const stateCounts = Object.fromEntries(states.map((row) => [row.state, asNumber(row.count)]))
    const usage = this.getOne("SELECT COUNT(*) AS count, COALESCE(SUM(payload_bytes), 0) AS bytes FROM relay_events")
    const oldest = this.getOne(
      "SELECT relay_received_at FROM relay_events WHERE state IN ('QUEUED', 'FORWARDING') ORDER BY relay_received_at ASC LIMIT 1",
    )
    const oldestAgeSeconds = oldest ? Math.max(0, (Date.parse(now) - Date.parse(oldest.relay_received_at)) / 1000) : 0
    return {
      state_counts: stateCounts,
      event_count: asNumber(usage.count),
      spool_bytes: asNumber(usage.bytes),
      oldest_queued_age_seconds: oldestAgeSeconds,
    }
  }

  isHealthy() {
    this.getOne("SELECT 1 AS healthy")
    return true
  }

  close() {
    this.database.close()
  }
}
