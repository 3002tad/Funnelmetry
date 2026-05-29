import { config } from "../config.js";

export async function postBusinessBatch(events) {
  if (!events.length) return { ok: true };

  const res = await fetch(config.ingestUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.ingestApiKey}`,
    },
    body: JSON.stringify({
      tenant_id: config.tenantId,
      source: config.source,
      schema_version: "business_event.v1",
      events,
    }),
  });

  const body = await res.json().catch(() => ({}));
  if (res.status === 202 || res.status === 200) {
    console.log(
      "[adapter] ingest ok accepted=%s duplicate=%s",
      body.accepted_count,
      body.duplicate_count
    );
    return { ok: true, body };
  }

  if (res.status === 400) {
    console.error("[adapter] ingest validation failed", body);
    return { ok: false, retry: false, body };
  }

  if (res.status === 401 || res.status === 403) {
    console.error("[adapter] ingest auth failed");
    return { ok: false, retry: false, body };
  }

  console.warn("[adapter] ingest retryable status=%s", res.status);
  return { ok: false, retry: true, body };
}
