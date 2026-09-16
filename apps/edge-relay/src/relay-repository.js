import { randomUUID } from "node:crypto"
import { EventEmitter } from "node:events"
import { mkdirSync, statfsSync } from "node:fs"
import { dirname } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { RelayError } from "./errors.js"
import { fingerprintIngressEvent } from "./fingerprint.js"

function asNumber(value) {
  return typeof value === "bigint" ? Number(value) : Number(value ?? 0)
}

function rollback(database) {
  try {
    database.exec("ROLLBACK")
  } catch {}
}

function parseEvent(record) {
  return {
    event_feed_id: record.event_feed_id,
    ingress_seq: asNumber(record.ingress_seq),
    accepted_at: record.accepted_at,
    transport_metadata: JSON.parse(record.transport_metadata_json),
    ...JSON.parse(record.event_json),
  }
}

/**
 * Source-owned durable event store. Its records never contain a Pipeline destination
 * or delivery state: Pipeline consumes this store through the authenticated feed.
 */
export class SourceEventStore {
  constructor({ databasePath, maxEventLogEvents, maxEventLogBytes, minFreeDiskBytes, createFeedId = randomUUID }) {
    mkdirSync(dirname(databasePath), { recursive: true })
    this.databasePath = databasePath
    this.maxEventLogEvents = maxEventLogEvents
    this.maxEventLogBytes = maxEventLogBytes
    this.minFreeDiskBytes = minFreeDiskBytes
    this.database = new DatabaseSync(databasePath)
    this.database.exec("PRAGMA journal_mode = WAL")
    this.database.exec("PRAGMA synchronous = FULL")
    this.database.exec("PRAGMA busy_timeout = 5000")
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS source_event_log_metadata (
        metadata_key TEXT PRIMARY KEY,
        metadata_value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS source_event_records (
        ingress_seq INTEGER PRIMARY KEY AUTOINCREMENT,
        event_feed_id TEXT NOT NULL,
        source_id TEXT NOT NULL,
        event_id TEXT NOT NULL,
        event_fingerprint TEXT NOT NULL,
        event_json TEXT NOT NULL,
        payload_bytes INTEGER NOT NULL,
        accepted_at TEXT NOT NULL,
        transport_metadata_json TEXT NOT NULL,
        UNIQUE(source_id, event_id)
      );
      CREATE INDEX IF NOT EXISTS source_event_records_feed_seq_idx
        ON source_event_records(event_feed_id, ingress_seq);
    `)
    this.eventFeedId = this.loadOrCreateFeedId(createFeedId)
    this.accepted = new EventEmitter()
    this.accepted.setMaxListeners(0)
  }

  loadOrCreateFeedId(createFeedId) {
    const existing = this.database.prepare("SELECT metadata_value FROM source_event_log_metadata WHERE metadata_key = 'event_feed_id'").get()
    if (existing) return existing.metadata_value
    const eventFeedId = createFeedId()
    this.database.prepare("INSERT INTO source_event_log_metadata (metadata_key, metadata_value) VALUES ('event_feed_id', ?)").run(eventFeedId)
    return eventFeedId
  }

  assertDiskCapacity() {
    const stat = statfsSync(dirname(this.databasePath))
    if (asNumber(stat.bavail) * asNumber(stat.bsize) < this.minFreeDiskBytes) throw new RelayError("event_log_disk_low")
  }

  accept({ event, rawBody, acceptedAt, transportMetadata }) {
    const eventFingerprint = fingerprintIngressEvent(event)
    const payloadBytes = Buffer.byteLength(rawBody, "utf8")
    this.database.exec("BEGIN IMMEDIATE")
    try {
      const existing = this.database.prepare(
        "SELECT ingress_seq, event_feed_id, source_id, event_id, event_fingerprint, accepted_at FROM source_event_records WHERE source_id = ? AND event_id = ?",
      ).get(event.source_id, event.event_id)
      if (existing) {
        if (existing.event_fingerprint !== eventFingerprint) throw new RelayError("event_identity_conflict")
        this.database.exec("COMMIT")
        return { duplicate: true, record: { ...existing, ingress_seq: asNumber(existing.ingress_seq) } }
      }

      this.assertDiskCapacity()
      const usage = this.database.prepare("SELECT COUNT(*) AS count, COALESCE(SUM(payload_bytes), 0) AS bytes FROM source_event_records").get()
      if (asNumber(usage.count) >= this.maxEventLogEvents || asNumber(usage.bytes) + payloadBytes > this.maxEventLogBytes) {
        throw new RelayError("event_log_capacity_exhausted")
      }
      this.database.prepare(`
        INSERT INTO source_event_records (
          event_feed_id, source_id, event_id, event_fingerprint, event_json,
          payload_bytes, accepted_at, transport_metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        this.eventFeedId,
        event.source_id,
        event.event_id,
        eventFingerprint,
        rawBody,
        payloadBytes,
        acceptedAt,
        JSON.stringify(transportMetadata),
      )
      const record = this.database.prepare(
        "SELECT ingress_seq, event_feed_id, source_id, event_id, accepted_at FROM source_event_records WHERE source_id = ? AND event_id = ?",
      ).get(event.source_id, event.event_id)
      this.database.exec("COMMIT")
      const normalized = { ...record, ingress_seq: asNumber(record.ingress_seq) }
      this.accepted.emit("record", normalized.ingress_seq)
      return { duplicate: false, record: normalized }
    } catch (error) {
      rollback(this.database)
      throw error
    }
  }

  getFeed({ afterSeq, limit }) {
    const stats = this.database.prepare(`
      SELECT
        COALESCE(MAX(ingress_seq), 0) AS latest_available_seq,
        MIN(ingress_seq) AS earliest_available_seq
      FROM source_event_records
      WHERE event_feed_id = ?
    `).get(this.eventFeedId)
    const retentionFloorSeq = 0
    if (afterSeq < retentionFloorSeq) throw new RelayError("retention_gap")
    const rows = this.database.prepare(`
      SELECT ingress_seq, event_feed_id, event_json, accepted_at, transport_metadata_json
      FROM source_event_records
      WHERE event_feed_id = ? AND ingress_seq > ?
      ORDER BY ingress_seq ASC
      LIMIT ?
    `).all(this.eventFeedId, afterSeq, limit)
    const events = rows.map(parseEvent)
    return {
      event_feed_id: this.eventFeedId,
      events,
      next_after_seq: events.length > 0 ? events.at(-1).ingress_seq : afterSeq,
      latest_available_seq: asNumber(stats.latest_available_seq),
      earliest_available_seq: stats.earliest_available_seq === null ? null : asNumber(stats.earliest_available_seq),
      retention_floor_seq: retentionFloorSeq,
    }
  }

  async waitForRecordAfter(afterSeq, waitMs) {
    if (waitMs <= 0) return false
    return new Promise((resolve) => {
      let completed = false
      const finish = (available) => {
        if (completed) return
        completed = true
        clearTimeout(timer)
        this.accepted.removeListener("record", onRecord)
        resolve(available)
      }
      const onRecord = (ingressSeq) => {
        if (ingressSeq > afterSeq) finish(true)
      }
      const timer = setTimeout(() => finish(false), waitMs)
      this.accepted.on("record", onRecord)
      if (this.getFeed({ afterSeq, limit: 1 }).events.length > 0) finish(true)
    })
  }

  getStatus(now) {
    const usage = this.database.prepare("SELECT COUNT(*) AS count, COALESCE(SUM(payload_bytes), 0) AS bytes, MIN(accepted_at) AS oldest FROM source_event_records").get()
    const latest = this.database.prepare("SELECT COALESCE(MAX(ingress_seq), 0) AS ingress_seq FROM source_event_records").get()
    return {
      event_feed_id: this.eventFeedId,
      event_count: asNumber(usage.count),
      event_log_bytes: asNumber(usage.bytes),
      oldest_event_age_seconds: usage.oldest ? Math.max(0, (Date.parse(now) - Date.parse(usage.oldest)) / 1000) : 0,
      latest_ingress_seq: asNumber(latest.ingress_seq),
      retention_floor_seq: 0,
    }
  }

  isHealthy() {
    this.database.prepare("SELECT 1 AS healthy").get()
    return true
  }

  close() {
    this.accepted.removeAllListeners()
    this.database.close()
  }
}
