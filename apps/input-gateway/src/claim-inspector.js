export async function inspectClaims({ pool, sourceId, eventId, limit = 50 }) {
  if (typeof sourceId !== "string" || !sourceId.trim()) throw new Error("source_id is required")
  if (eventId !== undefined && (typeof eventId !== "string" || !eventId.trim())) {
    throw new Error("event_id must be non-empty")
  }
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new Error("limit must be an integer between 1 and 100")
  }
  const client = await pool.connect()
  try {
    await client.query("BEGIN READ ONLY")
    await client.query("SET LOCAL statement_timeout = '5s'")
    const { rows } = await client.query(
      `SELECT source_id, event_id, ingestion_id, claim_state,
              event_fingerprint IS NOT NULL AS has_fingerprint,
              owner_token = 'released' AS explicitly_released,
              lease_expires_at <= NOW() AS lease_expired,
              send_authorized, send_guard_owner_token = owner_token AS has_send_guard,
              (SELECT jsonb_build_object(
                  'transactional_id', attempt.transactional_id,
                  'generation_id', attempt.producer_generation_id,
                  'authorized_at', attempt.authorized_at)
                 FROM ingress_send_attempts attempt
                WHERE attempt.source_id = ingress_receipt_claims.source_id
                  AND attempt.event_id = ingress_receipt_claims.event_id
                  AND attempt.owner_token = ingress_receipt_claims.owner_token) AS producer_attempt,
              created_at, updated_at
         FROM ingress_receipt_claims
        WHERE source_id = $1 AND ($2::text IS NULL OR event_id = $2)
        ORDER BY updated_at ASC, event_id ASC LIMIT $3`,
      [sourceId, eventId ?? null, limit + 1],
    )
    await client.query("COMMIT")
    return {
      source_id: sourceId,
      event_id: eventId ?? null,
      evidence: "postgres_coordination_only",
      kafka_outcome_verified: false,
      truncated: rows.length > limit,
      claims: rows.slice(0, limit).map(row => {
        let disposition
        if (!row.has_fingerprint) disposition = "MISSING_FINGERPRINT_EVIDENCE"
        else if (row.claim_state === "ACCEPTED") disposition = "ACCEPTED_IN_LEDGER"
        else if (row.explicitly_released) disposition = "RETRY_ELIGIBLE"
        else if (row.send_authorized === false && row.has_send_guard) {
          disposition = row.lease_expired ? "RETRY_ELIGIBLE" : "PRE_SEND_LEASE_ACTIVE"
        }
        else disposition = "PENDING_TRANSACTION_EVIDENCE"
        return { ...row, disposition }
      }),
    }
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {})
    throw error
  } finally {
    client.release()
  }
}
