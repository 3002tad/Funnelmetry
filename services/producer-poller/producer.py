"""
Kafka Producer Poller — High-Throughput Edition

Polls the Event Generator API drain endpoint and produces events to Kafka.
Uses batch drain, Snappy compression, and adaptive backoff for max throughput.

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
POLL_INTERVAL_MS = int(os.getenv('POLL_INTERVAL_MS', '50'))       # base interval
POLL_BATCH_LIMIT = int(os.getenv('POLL_BATCH_LIMIT', '500'))      # drain up to 500/poll
MAX_RETRIES = int(os.getenv('MAX_RETRIES', '3'))
RETRY_DELAY_SEC = int(os.getenv('RETRY_DELAY_SEC', '2'))

# Adaptive backoff: slow down when queue is empty, speed up when busy
BACKOFF_MAX_MS = int(os.getenv('BACKOFF_MAX_MS', '500'))           # max sleep when idle
BACKOFF_MULTIPLIER = float(os.getenv('BACKOFF_MULTIPLIER', '1.5')) # grow factor

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
    """Create a Kafka Producer tuned for high throughput."""
    try:
        producer = KafkaProducer(
            bootstrap_servers=KAFKA_BOOTSTRAP_SERVERS,
            value_serializer=lambda v: json.dumps(v).encode('utf-8'),
            key_serializer=lambda k: k.encode('utf-8') if k else None,
            acks=1,                     # leader-only ack — fastest reliable mode
            retries=3,
            linger_ms=50,               # wait up to 50ms to fill batch (was 10)
            batch_size=131072,          # 128 KB batch (was 64KB) — more events per request
            buffer_memory=67108864,     # 64 MB buffer
            compression_type='snappy',  # snappy: ~3x faster than gzip, low CPU
            max_in_flight_requests_per_connection=5,  # allow pipelining
        )
        logger.info(f"Connected to Kafka: {KAFKA_BOOTSTRAP_SERVERS}")
        logger.info(f"  linger_ms=50, batch_size=128KB, compression=snappy")
        return producer
    except KafkaError as e:
        logger.error(f"Failed to connect to Kafka: {e}")
        return None

# ============================================================================
# API POLLING
# ============================================================================

def poll_events_from_api(session: requests.Session, retry_count: int = 0) -> list:
    """
    Poll a batch of events from the API Generator drain endpoint.
    Uses persistent HTTP session for connection reuse (keep-alive).
    """
    try:
        response = session.get(
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
        return events

    except requests.exceptions.Timeout:
        logger.warning(f"API timeout (attempt {retry_count + 1}/{MAX_RETRIES})")
        return retry_poll(session, retry_count)

    except requests.exceptions.ConnectionError:
        logger.warning(f"API connection error (attempt {retry_count + 1}/{MAX_RETRIES})")
        return retry_poll(session, retry_count)

    except requests.exceptions.HTTPError as e:
        logger.error(f"API HTTP error: {e.response.status_code}")
        return retry_poll(session, retry_count)

    except json.JSONDecodeError:
        logger.error("Invalid JSON response from API")
        return []

    except Exception as e:
        logger.error(f"Unexpected error polling API: {e}")
        return []


def retry_poll(session: requests.Session, retry_count: int) -> list:
    """Retry polling with capped backoff."""
    if retry_count < MAX_RETRIES:
        delay = min(10, RETRY_DELAY_SEC * (retry_count + 1))
        time.sleep(delay)
        return poll_events_from_api(session, retry_count + 1)
    else:
        logger.error(f"Max retries ({MAX_RETRIES}) exceeded")
        return []

# ============================================================================
# KAFKA PRODUCTION — BATCH SEND
# ============================================================================

def produce_batch_to_kafka(producer: KafkaProducer, events: list) -> tuple:
    """
    Send entire batch to Kafka without per-event overhead.
    Returns (success_count, fail_count).
    """
    now_iso = datetime.now(timezone.utc).isoformat()
    success = 0
    failed = 0

    for event in events:
        try:
            key = event.get('orderId', '')
            # Stamp Kafka send time
            event.setdefault('trace', {})
            event['trace']['t_kafka_sent'] = now_iso  # reuse same timestamp for batch

            producer.send(KAFKA_TOPIC, key=key, value=event)
            success += 1
        except KafkaError as e:
            logger.error(f"Kafka send error: {e}")
            failed += 1

    # Flush the batch — triggers actual network send
    producer.flush()
    return success, failed

# ============================================================================
# MAIN POLLING LOOP
# ============================================================================

def main():
    """Main polling loop with adaptive backoff: fast when busy, slow when idle."""
    logger.info("=" * 70)
    logger.info("Kafka Producer Poller Starting (High-Throughput)")
    logger.info("=" * 70)
    logger.info(f"API Drain URL:    {API_DRAIN_URL}")
    logger.info(f"Kafka:            {KAFKA_BOOTSTRAP_SERVERS}")
    logger.info(f"Topic:            {KAFKA_TOPIC}")
    logger.info(f"Poll Interval:    {POLL_INTERVAL_MS}ms (adaptive: up to {BACKOFF_MAX_MS}ms idle)")
    logger.info(f"Poll Batch Limit: {POLL_BATCH_LIMIT}")
    logger.info("=" * 70)

    # Create Kafka Producer
    producer = create_kafka_producer()
    if not producer:
        logger.error("Cannot start without Kafka connection. Exiting.")
        return

    # Persistent HTTP session — reuses TCP connections (keep-alive)
    session = requests.Session()
    adapter = requests.adapters.HTTPAdapter(
        pool_connections=2,
        pool_maxsize=5,
        max_retries=0,  # we handle retries ourselves
    )
    session.mount('http://', adapter)

    # Statistics
    total_pulled = 0
    total_produced = 0
    total_failed = 0
    current_interval_ms = POLL_INTERVAL_MS  # adaptive
    last_log_time = time.time()

    try:
        while True:
            start_time = time.time()

            # Step 1: Drain batch from API queue
            events = poll_events_from_api(session)

            if events:
                batch_size = len(events)
                total_pulled += batch_size

                # Step 2: Send entire batch to Kafka + flush
                success, failed = produce_batch_to_kafka(producer, events)
                total_produced += success
                total_failed += failed

                # Reset backoff — queue has data, poll fast
                current_interval_ms = POLL_INTERVAL_MS
            else:
                # Adaptive backoff — queue empty, slow down gradually
                current_interval_ms = min(
                    BACKOFF_MAX_MS,
                    int(current_interval_ms * BACKOFF_MULTIPLIER)
                )

            # Log statistics every 5 seconds
            now = time.time()
            if now - last_log_time >= 5.0 and total_pulled > 0:
                elapsed = now - last_log_time
                rate = total_produced / max(1, now - start_time + elapsed) if total_produced else 0
                logger.info(
                    f"Stats: Pulled={total_pulled} | Produced={total_produced} | "
                    f"Failed={total_failed} | Interval={current_interval_ms}ms"
                )
                last_log_time = now

            # Sleep to maintain polling interval
            elapsed_ms = (time.time() - start_time) * 1000
            sleep_ms = max(0, current_interval_ms - elapsed_ms)
            if sleep_ms > 0:
                time.sleep(sleep_ms / 1000)

    except KeyboardInterrupt:
        logger.info("\nShutting down gracefully...")
        logger.info(f"Final Stats: Pulled={total_pulled} | Produced={total_produced} | Failed={total_failed}")
        producer.flush()
        producer.close()
        session.close()
        logger.info("Producer closed. Goodbye!")

if __name__ == "__main__":
    main()
