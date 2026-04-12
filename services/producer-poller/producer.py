"""
Kafka Producer Poller

Polls the Event Generator API drain endpoint and produces events to Kafka.
Uses batch drain for high throughput.

Architecture:
    API Generator (http://localhost:7070/gen/drain?limit=N)
    → Producer Poller (this script)
    → Kafka (topic: events_raw)
"""

import json
import time
import logging
from datetime import datetime, timezone
import os
from typing import Optional, Dict, Any

import requests
from kafka import KafkaProducer
from kafka.errors import KafkaError

# ============================================================================
# CONFIGURATION
# ============================================================================

# API Configuration
API_DRAIN_URL = os.getenv('API_DRAIN_URL', 'http://localhost:7070/gen/drain')
API_TIMEOUT = int(os.getenv('API_TIMEOUT', '5'))  # seconds

# Kafka Configuration
KAFKA_BOOTSTRAP_SERVERS = os.getenv('KAFKA_BOOTSTRAP_SERVERS', 'kafka:9092')
KAFKA_TOPIC = os.getenv('KAFKA_TOPIC', 'events_raw')

# Polling Configuration
POLL_INTERVAL_MS = int(os.getenv('POLL_INTERVAL_MS', '20'))  # 20ms polling
POLL_BATCH_LIMIT = int(os.getenv('POLL_BATCH_LIMIT', '100'))
MAX_RETRIES = int(os.getenv('MAX_RETRIES', '3'))
RETRY_DELAY_SEC = int(os.getenv('RETRY_DELAY_SEC', '2'))

# Logging Configuration
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
logger = logging.getLogger(__name__)

# ============================================================================
# KAFKA PRODUCER SETUP
# ============================================================================

def create_kafka_producer() -> Optional[KafkaProducer]:
    """Create and return a Kafka Producer instance"""
    try:
        producer = KafkaProducer(
            bootstrap_servers=KAFKA_BOOTSTRAP_SERVERS,
            value_serializer=lambda v: json.dumps(v).encode('utf-8'),
            key_serializer=lambda k: k.encode('utf-8') if k else None,
            acks=1,
            retries=3,
            linger_ms=10,
            batch_size=65536,
            buffer_memory=67108864,
            compression_type='gzip',
        )
        logger.info(f"✅ Connected to Kafka: {KAFKA_BOOTSTRAP_SERVERS}")
        return producer
    except KafkaError as e:
        logger.error(f"❌ Failed to connect to Kafka: {e}")
        return None

# ============================================================================
# API POLLING
# ============================================================================

def poll_events_from_api(retry_count: int = 0) -> list:
    """
    Poll a batch of events from the API Generator drain endpoint.
    Returns empty list when queue is empty (204).
    """
    try:
        response = requests.get(
            API_DRAIN_URL,
            params={'limit': POLL_BATCH_LIMIT},
            timeout=API_TIMEOUT,
        )

        # 204 = queue empty
        if response.status_code == 204:
            return []

        response.raise_for_status()

        payload = response.json()
        events = payload.get('events', []) if isinstance(payload, dict) else []

        if events:
            logger.debug(f"📥 Drained {len(events)} events from queue")
        return events

    except requests.exceptions.Timeout:
        logger.warning(f"⏱️ API timeout (attempt {retry_count + 1}/{MAX_RETRIES})")
        return retry_poll(retry_count)

    except requests.exceptions.ConnectionError:
        logger.warning(f"🔌 API connection error (attempt {retry_count + 1}/{MAX_RETRIES})")
        return retry_poll(retry_count)

    except requests.exceptions.HTTPError as e:
        logger.error(f"❌ API HTTP error: {e.response.status_code} - {e.response.text}")
        return retry_poll(retry_count)

    except json.JSONDecodeError:
        logger.error(f"❌ Invalid JSON response from API")
        return []

    except Exception as e:
        logger.error(f"❌ Unexpected error polling API: {e}")
        return []


def retry_poll(retry_count: int) -> list:
    """Retry polling with exponential backoff."""
    if retry_count < MAX_RETRIES:
        time.sleep(RETRY_DELAY_SEC * (retry_count + 1))
        return poll_events_from_api(retry_count + 1)
    else:
        logger.error(f"❌ Max retries ({MAX_RETRIES}) exceeded")
        return []

# ============================================================================
# KAFKA PRODUCTION
# ============================================================================

def produce_to_kafka(producer: KafkaProducer, event: Dict[str, Any]) -> bool:
    """Send event to Kafka topic"""
    try:
        key = event.get('orderId', '')

        # Distributed tracing — stamp Kafka send time
        event.setdefault('trace', {})
        event['trace']['t_kafka_sent'] = datetime.now(timezone.utc).isoformat()

        def on_send_success(record_metadata):
            logger.debug(
                f"📤 Kafka ack: partition={record_metadata.partition} "
                f"offset={record_metadata.offset} type={event.get('eventType')}"
            )

        def on_send_error(exc):
            logger.error(f"❌ Kafka send error: {exc}")

        producer.send(KAFKA_TOPIC, key=key, value=event) \
            .add_callback(on_send_success) \
            .add_errback(on_send_error)
        return True

    except KafkaError as e:
        logger.error(f"❌ Kafka production error: {e}")
        return False

    except Exception as e:
        logger.error(f"❌ Unexpected error producing to Kafka: {e}")
        return False

# ============================================================================
# MAIN POLLING LOOP
# ============================================================================

def main():
    """Main polling loop: drain API queue → Kafka"""
    logger.info("=" * 70)
    logger.info("🚀 Kafka Producer Poller Starting...")
    logger.info("=" * 70)
    logger.info(f"API Drain URL: {API_DRAIN_URL}")
    logger.info(f"Kafka: {KAFKA_BOOTSTRAP_SERVERS}")
    logger.info(f"Topic: {KAFKA_TOPIC}")
    logger.info(f"Poll Interval: {POLL_INTERVAL_MS}ms")
    logger.info(f"Poll Batch Limit: {POLL_BATCH_LIMIT}")
    logger.info("=" * 70)

    # Create Kafka Producer
    producer = create_kafka_producer()
    if not producer:
        logger.error("❌ Cannot start without Kafka connection. Exiting.")
        return

    # Statistics
    total_pulled = 0
    total_produced = 0
    total_failed = 0

    try:
        while True:
            start_time = time.time()

            # Step 1: Drain batch from API queue
            events = poll_events_from_api()

            if events:
                total_pulled += len(events)

                # Step 2: Produce all events in batch
                for event in events:
                    success = produce_to_kafka(producer, event)
                    if success:
                        total_produced += 1
                    else:
                        total_failed += 1
            else:
                logger.debug("⏸️  Queue empty, waiting for UI events...")

            # Log statistics every 200 events
            if total_pulled > 0 and total_pulled % 200 == 0:
                logger.info(
                    f"📊 Stats: Pulled={total_pulled} | Produced={total_produced} | Failed={total_failed}"
                )

            # Sleep to maintain polling interval
            elapsed_ms = (time.time() - start_time) * 1000
            sleep_ms = max(0, POLL_INTERVAL_MS - elapsed_ms)
            time.sleep(sleep_ms / 1000)

    except KeyboardInterrupt:
        logger.info("\n🛑 Shutting down gracefully...")
        logger.info(f"📊 Final Stats: Pulled={total_pulled} | Produced={total_produced} | Failed={total_failed}")
        producer.close()
        logger.info("✅ Producer closed. Goodbye!")

if __name__ == "__main__":
    main()
