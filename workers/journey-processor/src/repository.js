import { createHash } from "node:crypto"
import { validateCanonicalEvent } from "@funnelmetry/canonical-contract"
import { extractJourneyEvidence } from "./evidence.js"

export class JourneyResolutionConflictError extends Error {
  constructor(message) {
    super(message)
    this.name = "JourneyResolutionConflictError"
  }
}

function deterministicJourneyId(event) {
  const digest = createHash("sha256")
    .update(JSON.stringify([event.source_id, event.canonical_event_id]))
    .digest("hex")
  return `journey_${digest}`
}

function evidenceQuery(evidence) {
  const values = []
  const tuples = evidence.map((item, index) => {
    values.push(item.entity_type, item.entity_key)
    const offset = index * 2
    return `($${offset + 2}, $${offset + 3})`
  })
  return {
    sql: `SELECT entity_type, entity_key, journey_id
            FROM journey_entities
           WHERE source_id = $1
             AND (entity_type, entity_key) IN (${tuples.join(", ")})
           FOR UPDATE`,
    values,
  }
}

function resolutionFromRow(row, status = "duplicate") {
  return Object.freeze({
    status,
    canonical_event_id: row.canonical_event_id,
    journey_id: row.journey_id,
    link_method: row.link_method,
    link_confidence: row.link_confidence,
    matched_entity_type: row.matched_entity_type ?? undefined,
    matched_entity_key: row.matched_entity_key ?? undefined,
    linked_at: new Date(row.linked_at).toISOString(),
  })
}

export function createJourneyRepository({ pool, now = () => new Date().toISOString() } = {}) {
  if (!pool || typeof pool.connect !== "function") throw new Error("A PostgreSQL pool is required")

  return Object.freeze({
    async resolve(input) {
      const event = validateCanonicalEvent(input)
      const evidence = extractJourneyEvidence(event)
      const client = await pool.connect()
      try {
        await client.query("BEGIN")
        const existingEvent = await client.query(
          `SELECT canonical_event_id, journey_id, link_method, link_confidence,
                  matched_entity_type, matched_entity_key, linked_at
             FROM journey_events
            WHERE canonical_event_id = $1`,
          [event.canonical_event_id],
        )
        if (existingEvent.rowCount === 1) {
          await client.query("COMMIT")
          return resolutionFromRow(existingEvent.rows[0])
        }

        let matches = []
        if (evidence.length > 0) {
          const query = evidenceQuery(evidence)
          const result = await client.query(query.sql, [event.source_id, ...query.values])
          matches = result.rows
        }
        const journeyIds = new Set(matches.map((match) => match.journey_id))
        if (journeyIds.size > 1) {
          throw new JourneyResolutionConflictError("journey evidence points to multiple journeys; automatic merge is disabled")
        }

        let journeyId = [...journeyIds][0]
        let matchedEvidence
        if (journeyId) {
          matchedEvidence = evidence.find((item) => matches.some(
            (match) => match.entity_type === item.entity_type && match.entity_key === item.entity_key,
          ))
        } else {
          journeyId = deterministicJourneyId(event)
          await client.query(
            `INSERT INTO journeys (journey_id, source_id, first_event_at, last_event_at, event_count)
             VALUES ($1, $2, $3, $3, 0)`,
            [journeyId, event.source_id, event.occurred_at],
          )
        }

        const linkedAt = now()
        for (const item of evidence) {
          await client.query(
            `INSERT INTO journey_entities (
               source_id, entity_type, entity_key, journey_id, linked_at,
               link_method, link_confidence, evidence_event_id
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             ON CONFLICT DO NOTHING`,
            [
              event.source_id, item.entity_type, item.entity_key, journeyId, linkedAt,
              item.link_method, item.link_confidence, event.canonical_event_id,
            ],
          )
          const owner = await client.query(
            `SELECT journey_id FROM journey_entities
              WHERE source_id = $1 AND entity_type = $2 AND entity_key = $3`,
            [event.source_id, item.entity_type, item.entity_key],
          )
          if (owner.rowCount !== 1 || owner.rows[0].journey_id !== journeyId) {
            throw new JourneyResolutionConflictError("journey entity was concurrently linked to another journey")
          }
        }

        const linkMethod = matchedEvidence?.link_method ?? "NEW_JOURNEY"
        const linkConfidence = matchedEvidence?.link_confidence ?? "ISOLATED"
        await client.query(
          `INSERT INTO journey_events (
             canonical_event_id, journey_id, event_type, occurred_at, link_method,
             link_confidence, matched_entity_type, matched_entity_key, linked_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            event.canonical_event_id, journeyId, event.event_type, event.occurred_at,
            linkMethod, linkConfidence, matchedEvidence?.entity_type ?? null,
            matchedEvidence?.entity_key ?? null, linkedAt,
          ],
        )
        await client.query(
          `UPDATE journeys
              SET first_event_at = LEAST(first_event_at, $2),
                  last_event_at = GREATEST(last_event_at, $2),
                  event_count = event_count + 1,
                  updated_at = $3
            WHERE journey_id = $1`,
          [journeyId, event.occurred_at, linkedAt],
        )
        await client.query("COMMIT")
        return Object.freeze({
          status: "linked",
          canonical_event_id: event.canonical_event_id,
          journey_id: journeyId,
          link_method: linkMethod,
          link_confidence: linkConfidence,
          matched_entity_type: matchedEvidence?.entity_type,
          matched_entity_key: matchedEvidence?.entity_key,
          linked_at: linkedAt,
        })
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {})
        throw error
      } finally {
        client.release()
      }
    },
  })
}
