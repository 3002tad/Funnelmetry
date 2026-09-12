import { validateIngressReceipt } from "@3002tad/funnelmetry-input-contract"
import { RelayError } from "./errors.js"

function credentialsBySource(registry) {
  const result = new Map()
  for (const [keyId, credential] of Object.entries(registry)) {
    result.set(credential.source_id, { keyId, secret: credential.secret })
  }
  return result
}

export function createUpstreamClient({ ingressUrl, upstreamBrowserKeys, requestTimeoutMs, fetchImpl = globalThis.fetch }) {
  const sourceCredentials = credentialsBySource(upstreamBrowserKeys)
  if (typeof fetchImpl !== "function") throw new Error("fetch is required for the Relay upstream client")

  return Object.freeze({
    async forward(record) {
      const credential = sourceCredentials.get(record.source_id)
      if (!credential) throw new RelayError("upstream_credential_missing")
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), requestTimeoutMs)
      try {
        const response = await fetchImpl(ingressUrl, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-funnelmetry-source-key-id": credential.keyId,
            "x-funnelmetry-write-key": credential.secret,
          },
          body: record.raw_body,
          signal: controller.signal,
        })
        const text = await response.text()
        let receipt
        try {
          receipt = validateIngressReceipt(JSON.parse(text))
        } catch {
          throw new RelayError(`upstream_invalid_receipt_${response.status}`)
        }
        if (receipt.source_id !== record.source_id || receipt.event_id !== record.event_id) {
          throw new RelayError("upstream_receipt_identity_mismatch")
        }
        return receipt
      } finally {
        clearTimeout(timer)
      }
    },
  })
}
