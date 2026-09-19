import { validateIngressReceipt } from '@3002tad/funnelmetry-input-contract'
import { ConnectorError } from './connector.js'

// Supply a connected KafkaJS transactional producer, with stable unique
// transactionalId per connector. Recreate it after an ambiguous commit/fencing.
export function createKafkaPublisher({ producer, rawTopic, receiptTopic }) {
  if (!producer?.transaction || !rawTopic || !receiptTopic || rawTopic === receiptTopic) {
    throw new ConnectorError('INVALID_KAFKA_PUBLISHER')
  }
  let busy = false, failed = false
  return async message => {
    if (failed) throw new ConnectorError('KAFKA_PUBLISHER_FAILED')
    if (busy) throw new ConnectorError('KAFKA_PUBLISH_IN_PROGRESS')
    const raw = JSON.parse(message.value)
    const event = JSON.parse(raw.raw_body)
    const receipt = validateIngressReceipt({ status: 'accepted', source_id: event.source_id,
      event_id: event.event_id, ingestion_id: raw.ingestion_id, received_at: raw.received_at })
    busy = true
    let transaction
    try {
      transaction = await producer.transaction()
      await transaction.send({ topic: rawTopic, acks: -1, messages: [message] })
      await transaction.send({ topic: receiptTopic, acks: -1,
        messages: [{ key: message.key, value: JSON.stringify(receipt) }] })
      await transaction.commit()
    } catch {
      // Unknown commit outcome must never advance cursor or reuse this producer.
      failed = true
      if (transaction) { try { await transaction.abort() } catch { /* recreate producer required */ } }
      throw new ConnectorError('KAFKA_HANDOFF_FAILED')
    } finally { busy = false }
  }
}
