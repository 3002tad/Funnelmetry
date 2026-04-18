#!/usr/bin/env python3
"""
Spark Structured Streaming Job — High-Throughput Edition

Reads from Kafka -> Parse & Validate -> Clean & Deduplicate -> Calculate KPIs -> Persist to PostgreSQL

Performance optimizations:
  - maxOffsetsPerTrigger: 50,000 (was 5,000)
  - shuffle.partitions: 4 (was 12) — optimal for local[*] mode
  - psycopg2 connection pooling (reuse across batches)
  - Snappy + in-memory Spark optimizations
  - Fixed latency_spark_to_db_ms bug (was always 0)
"""

from pyspark.sql import SparkSession
from pyspark.sql.functions import (
    col, from_json, to_timestamp, current_timestamp,
    window, sum as _sum, count, when, round as _round
)
from pyspark.sql.types import (
    StructType, StructField, StringType, DoubleType, IntegerType, TimestampType
)
import sys
import os
import time
from kafka.admin import KafkaAdminClient, NewTopic
from kafka.errors import TopicAlreadyExistsError

# ============================================================================
# CONFIGURATION
# ============================================================================
KAFKA_BOOTSTRAP_SERVERS = os.environ.get('KAFKA_BOOTSTRAP_SERVERS', 'kafka:9092')
KAFKA_TOPIC             = os.environ.get('KAFKA_TOPIC', 'events_raw')
KAFKA_NUM_PARTITIONS    = int(os.environ.get('KAFKA_NUM_PARTITIONS', '6'))
KAFKA_MAX_OFFSETS_PER_TRIGGER = int(os.environ.get('KAFKA_MAX_OFFSETS_PER_TRIGGER', '50000'))
CHECKPOINT_DIR          = os.environ.get('CHECKPOINT_DIR', '/app/checkpoints/spark_stream')

# PostgreSQL
POSTGRES_HOST     = os.environ.get('POSTGRES_HOST', 'postgres')
POSTGRES_PORT     = int(os.environ.get('POSTGRES_PORT', '5432'))
POSTGRES_DB       = os.environ.get('POSTGRES_DB', 'realtime')
POSTGRES_URL      = f'jdbc:postgresql://{POSTGRES_HOST}:{POSTGRES_PORT}/{POSTGRES_DB}'
POSTGRES_USER     = os.environ.get('POSTGRES_USER', 'app')
POSTGRES_PASSWORD = os.environ.get('POSTGRES_PASSWORD', 'app')

# Kafka topic bootstrap
KAFKA_TOPIC_WAIT_TIMEOUT_SEC = int(os.environ.get('KAFKA_TOPIC_WAIT_TIMEOUT_SEC', '180'))
KAFKA_TOPIC_WAIT_INTERVAL_SEC = int(os.environ.get('KAFKA_TOPIC_WAIT_INTERVAL_SEC', '3'))

# ============================================================================
# SCHEMA
# ============================================================================

TRACE_SCHEMA = StructType([
    StructField('t_generated', StringType(), nullable=True),
    StructField('t_kafka_sent', StringType(), nullable=True),
])

EVENT_SCHEMA = StructType([
    StructField('id', StringType(), nullable=False),
    StructField('eventTime', StringType(), nullable=False),
    StructField('eventType', StringType(), nullable=False),
    StructField('orderId', StringType(), nullable=False),
    StructField('userId', StringType(), nullable=False),
    StructField('amount', DoubleType(), nullable=False),
    StructField('currency', StringType(), nullable=False),
    StructField('status', StringType(), nullable=False),
    # New fields
    StructField('productId', StringType(), nullable=True),
    StructField('productName', StringType(), nullable=True),
    StructField('category', StringType(), nullable=True),
    StructField('quantity', IntegerType(), nullable=True),
    StructField('paymentMethod', StringType(), nullable=True),
    StructField('region', StringType(), nullable=True),
    # Tracing
    StructField('trace', TRACE_SCHEMA, nullable=True),
])

# ============================================================================
# SPARK SESSION — tuned for single-machine streaming
# ============================================================================

def create_spark_session():
    spark = SparkSession.builder \
        .appName('EcommerceRealtimePipeline') \
        .master('local[*]') \
        .config('spark.sql.streaming.checkpointLocation', CHECKPOINT_DIR) \
        .config('spark.sql.shuffle.partitions', 4) \
        .config('spark.default.parallelism', 4) \
        .config('spark.sql.adaptive.enabled', 'true') \
        .config('spark.sql.adaptive.coalescePartitions.enabled', 'true') \
        .config('spark.serializer', 'org.apache.spark.serializer.KryoSerializer') \
        .config('spark.sql.streaming.noDataMicroBatches.enabled', 'false') \
        .config('spark.jars.packages',
                'org.apache.spark:spark-sql-kafka-0-10_2.12:3.5.0,'
                'org.postgresql:postgresql:42.6.0') \
        .getOrCreate()

    spark.sparkContext.setLogLevel('WARN')
    return spark


def ensure_kafka_topic(topic_name, bootstrap_servers, timeout_sec=180, interval_sec=3):
    """Ensure Kafka topic exists before starting Spark readStream."""
    deadline = time.time() + timeout_sec
    last_error = None

    while time.time() < deadline:
        admin = None
        try:
            admin = KafkaAdminClient(
                bootstrap_servers=bootstrap_servers,
                client_id='spark-topic-bootstrap',
                request_timeout_ms=10000,
                api_version_auto_timeout_ms=10000,
            )

            existing_topics = set(admin.list_topics())
            if topic_name in existing_topics:
                print(f'[OK] Kafka topic exists: {topic_name}')
                return

            print(f'[INFO] Topic "{topic_name}" not found. Creating with {KAFKA_NUM_PARTITIONS} partitions...')
            admin.create_topics(
                new_topics=[NewTopic(name=topic_name, num_partitions=KAFKA_NUM_PARTITIONS, replication_factor=1)],
                validate_only=False,
            )
            print(f'[OK] Kafka topic created: {topic_name}')
            return
        except TopicAlreadyExistsError:
            print(f'[OK] Kafka topic already exists: {topic_name}')
            return
        except Exception as e:
            last_error = e
            print(f'[WAIT] Kafka not ready ({interval_sec}s): {str(e)}')
            time.sleep(interval_sec)
        finally:
            if admin is not None:
                try:
                    admin.close()
                except Exception:
                    pass

    raise RuntimeError(
        f'Kafka topic "{topic_name}" not ready after {timeout_sec}s. Last error: {last_error}'
    )


# ============================================================================
# UC03 — PARSE & VALIDATE
# ============================================================================

def parse_and_validate(df):
    """Parse JSON from Kafka value and validate required fields."""
    # Parse JSON directly — no intermediate raw_value column
    parsed_df = df.select(
        from_json(col('value').cast('string'), EVENT_SCHEMA).alias('data')
    ).select('data.*')

    # Filter valid events
    valid_df = parsed_df.filter(
        col('id').isNotNull() &
        col('eventTime').isNotNull() &
        col('eventType').isNotNull() &
        col('orderId').isNotNull() &
        (col('amount') >= 0)
    )

    # Extract trace fields
    valid_df = valid_df \
        .withColumn('trace_t_generated', col('trace.t_generated')) \
        .withColumn('trace_t_kafka_sent', col('trace.t_kafka_sent')) \
        .drop('trace')

    return valid_df


# ============================================================================
# UC04 — CLEAN & DEDUPLICATE
# ============================================================================

def clean_and_deduplicate(df):
    """
    Clean timestamps, deduplicate by id within watermark window.
    Watermark = 2 minutes (was 30s — too aggressive for late data).
    """
    cleaned_df = df \
        .withColumn('event_time', to_timestamp(col('eventTime'), "yyyy-MM-dd'T'HH:mm:ss.SSSSSS'Z'")) \
        .withColumn('event_time',
                   when(col('event_time').isNull(),
                        to_timestamp(col('eventTime'))).otherwise(col('event_time'))) \
        .withColumn('ingest_time', current_timestamp()) \
        .withWatermark('event_time', '2 minutes') \
        .dropDuplicates(['id']) \
        .select(
            col('id'),
            col('event_time'),
            col('eventType').alias('event_type'),
            col('orderId').alias('order_id'),
            col('userId').alias('user_id'),
            col('amount'),
            col('currency'),
            col('status'),
            col('productId').alias('product_id'),
            col('productName').alias('product_name'),
            col('category'),
            col('quantity'),
            col('paymentMethod').alias('payment_method'),
            col('region'),
            col('ingest_time'),
            col('trace_t_generated'),
            col('trace_t_kafka_sent')
        )

    return cleaned_df


# ============================================================================
# UC05 — CALCULATE KPIs
# ============================================================================

def calculate_kpis(df):
    """1-minute windowed KPIs with pre-calculated success_rate."""
    kpi_df = df \
        .groupBy(window(col('event_time'), '1 minute')) \
        .agg(
            _sum(when(col('event_type') == 'payment_success', col('amount')).otherwise(0)).alias('revenue'),
            _sum(when(col('event_type') == 'order_created', 1).otherwise(0)).alias('orders_created'),
            _sum(when(col('event_type') == 'payment_initiated', 1).otherwise(0)).alias('payment_initiated'),
            _sum(when(col('event_type') == 'payment_success', 1).otherwise(0)).alias('payment_success'),
            _sum(when(col('event_type') == 'payment_failed', 1).otherwise(0)).alias('payment_failed'),
            _sum(when(col('event_type') == 'order_cancelled', 1).otherwise(0)).alias('order_cancelled')
        ) \
        .select(
            col('window.start').alias('window_start'),
            col('window.end').alias('window_end'),
            col('revenue'),
            col('orders_created'),
            col('payment_initiated'),
            col('payment_success'),
            col('payment_failed'),
            col('order_cancelled'),
            _round(
                when(
                    (col('payment_success') + col('payment_failed')) > 0,
                    (col('payment_success') / (col('payment_success') + col('payment_failed')) * 100)
                ).otherwise(0),
                2
            ).alias('success_rate')
        )

    return kpi_df


# ============================================================================
# UC06 — PERSIST TO POSTGRESQL (with connection pooling)
# ============================================================================

# Global connection pool — reused across all batches (no per-batch TCP handshake)
_pg_pool = None

def get_pg_pool():
    """Lazy-init a psycopg2 connection pool (min=1, max=4)."""
    global _pg_pool
    if _pg_pool is None or _pg_pool.closed:
        import psycopg2.pool
        _pg_pool = psycopg2.pool.ThreadedConnectionPool(
            minconn=1, maxconn=4,
            host=POSTGRES_HOST, port=POSTGRES_PORT,
            dbname=POSTGRES_DB, user=POSTGRES_USER, password=POSTGRES_PASSWORD,
        )
        print('[OK] PostgreSQL connection pool created (max=4)')
    return _pg_pool


def write_events_and_traces(batch_df, batch_id):
    """
    Bulk-write events + traces in one transaction using psycopg2 connection pool.
    Fixed: latency_spark_to_db_ms now correctly measures Spark→DB time.
    """
    from psycopg2.extras import execute_values
    from datetime import datetime as dt, timezone

    rows = batch_df.collect()
    if not rows:
        return

    t_spark = dt.now(timezone.utc)  # timestamp when Spark starts processing

    def parse_iso(s):
        if not s:
            return None
        try:
            s = s.replace('Z', '+00:00')
            return dt.fromisoformat(s)
        except Exception:
            return None

    def ms_between(a, b):
        if a and b:
            return max(0, int((b - a).total_seconds() * 1000))
        return None

    pool = get_pg_pool()
    conn = pool.getconn()
    try:
        cur = conn.cursor()

        # Bulk insert events_clean (with new product/payment/region fields)
        event_data = [
            (r['id'], r['event_time'], r['event_type'], r['order_id'],
             r['user_id'], float(r['amount']), r['currency'], r['status'],
             r['product_id'], r['product_name'], r['category'],
             int(r['quantity']) if r['quantity'] else None,
             r['payment_method'], r['region'],
             r['ingest_time'])
            for r in rows
        ]
        execute_values(cur,
            """INSERT INTO events_clean
               (id, event_time, event_type, order_id, user_id, amount, currency, status,
                product_id, product_name, category, quantity, payment_method, region, ingest_time)
               VALUES %s ON CONFLICT (id) DO NOTHING""",
            event_data, page_size=2000)

        # Bulk insert traces — fixed latency calculations
        t_db = dt.now(timezone.utc)  # timestamp after events written
        trace_data = []
        for r in rows:
            t_gen = parse_iso(r['trace_t_generated'])
            t_kafka = parse_iso(r['trace_t_kafka_sent'])
            trace_data.append((
                r['id'], t_gen, t_kafka, t_spark, t_db,
                ms_between(t_gen, t_kafka),       # gen → kafka
                ms_between(t_kafka, t_spark),      # kafka → spark
                ms_between(t_spark, t_db),         # spark → db (FIXED: was ms_between(now, now) = 0)
                ms_between(t_gen, t_db),           # total end-to-end
            ))
        execute_values(cur,
            """INSERT INTO event_traces (event_id, t_generated, t_kafka_sent, t_spark_processed, t_db_written,
                   latency_gen_to_kafka_ms, latency_kafka_to_spark_ms, latency_spark_to_db_ms, latency_total_ms)
               VALUES %s ON CONFLICT (event_id) DO NOTHING""",
            trace_data, page_size=2000)

        conn.commit()
        cur.close()
        print(f'[OK] Batch {batch_id}: Wrote {len(rows)} events + traces')
    except Exception as e:
        conn.rollback()
        print(f'[ERR] Batch {batch_id}: {str(e)}')
        raise
    finally:
        pool.putconn(conn)


def upsert_kpi_to_postgres(batch_df, batch_id):
    """
    Upsert KPI rows using execute_values (bulk) instead of executemany (row-by-row).
    Uses connection pool instead of creating new connection per batch.
    """
    from psycopg2.extras import execute_values

    rows = batch_df.collect()
    if not rows:
        return

    pool = get_pg_pool()
    conn = pool.getconn()
    try:
        cur = conn.cursor()

        kpi_data = [
            (
                row['window_start'], row['window_end'],
                float(row['revenue']),
                int(row['orders_created']), int(row['payment_initiated']),
                int(row['payment_success']), int(row['payment_failed']),
                int(row['order_cancelled']), float(row['success_rate']),
            )
            for row in rows
        ]

        # Bulk upsert using execute_values with ON CONFLICT (much faster than executemany)
        execute_values(cur,
            """INSERT INTO kpi_1m
                (window_start, window_end, revenue, orders_created, payment_initiated,
                 payment_success, payment_failed, order_cancelled, success_rate, processed_at)
               VALUES %s
               ON CONFLICT (window_start) DO UPDATE SET
                 window_end        = EXCLUDED.window_end,
                 revenue           = EXCLUDED.revenue,
                 orders_created    = EXCLUDED.orders_created,
                 payment_initiated = EXCLUDED.payment_initiated,
                 payment_success   = EXCLUDED.payment_success,
                 payment_failed    = EXCLUDED.payment_failed,
                 order_cancelled   = EXCLUDED.order_cancelled,
                 success_rate      = EXCLUDED.success_rate,
                 processed_at      = NOW()""",
            kpi_data,
            template='(%s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())',
            page_size=500)

        conn.commit()
        cur.close()
        print(f'[OK] Batch {batch_id}: Upserted {len(kpi_data)} KPI rows')
    except Exception as e:
        conn.rollback()
        print(f'[ERR] Batch {batch_id}: KPI upsert error: {str(e)}')
        raise
    finally:
        pool.putconn(conn)


# ============================================================================
# MAIN STREAMING PIPELINE
# ============================================================================

def main():
    print('=' * 70)
    print('SPARK STRUCTURED STREAMING — HIGH-THROUGHPUT PIPELINE')
    print('=' * 70)
    print(f'Kafka:       {KAFKA_BOOTSTRAP_SERVERS}')
    print(f'Topic:       {KAFKA_TOPIC} ({KAFKA_NUM_PARTITIONS} partitions)')
    print(f'PostgreSQL:  {POSTGRES_URL}')
    print(f'Checkpoint:  {CHECKPOINT_DIR}')
    print(f'MaxOffsets:  {KAFKA_MAX_OFFSETS_PER_TRIGGER}/trigger')
    print(f'Shuffle:     4 partitions (local mode)')
    print('=' * 70)

    spark = create_spark_session()

    # Ensure topic exists
    ensure_kafka_topic(
        KAFKA_TOPIC, KAFKA_BOOTSTRAP_SERVERS,
        timeout_sec=KAFKA_TOPIC_WAIT_TIMEOUT_SEC,
        interval_sec=KAFKA_TOPIC_WAIT_INTERVAL_SEC,
    )

    # Read from Kafka
    print('[INFO] Reading from Kafka...')
    raw_stream = spark.readStream \
        .format('kafka') \
        .option('kafka.bootstrap.servers', KAFKA_BOOTSTRAP_SERVERS) \
        .option('subscribe', KAFKA_TOPIC) \
        .option('startingOffsets', 'latest') \
        .option('maxOffsetsPerTrigger', str(KAFKA_MAX_OFFSETS_PER_TRIGGER)) \
        .option('failOnDataLoss', 'false') \
        .option('kafka.fetch.min.bytes', '1024') \
        .option('kafka.fetch.max.wait.ms', '200') \
        .load()

    # UC03: Parse and validate
    print('[INFO] UC03: Parse & Validate')
    valid_events = parse_and_validate(raw_stream)

    # UC04: Clean and deduplicate
    print('[INFO] UC04: Clean & Deduplicate (watermark=2min)')
    clean_events = clean_and_deduplicate(valid_events)

    # UC05: Calculate KPIs
    print('[INFO] UC05: Calculate KPIs (1-min windows)')
    kpis = calculate_kpis(clean_events)

    # UC06: Persist to PostgreSQL
    print('[INFO] UC06: Persist to PostgreSQL')

    # Stream 1: events + traces (append mode, 5s trigger)
    events_query = clean_events.writeStream \
        .foreachBatch(write_events_and_traces) \
        .outputMode('append') \
        .trigger(processingTime='5 seconds') \
        .option('checkpointLocation', f'{CHECKPOINT_DIR}/events_clean') \
        .start()

    # Stream 2: KPI upsert (update mode, 5s trigger)
    kpi_query = kpis.writeStream \
        .foreachBatch(upsert_kpi_to_postgres) \
        .outputMode('update') \
        .trigger(processingTime='5 seconds') \
        .option('checkpointLocation', f'{CHECKPOINT_DIR}/kpi_1m') \
        .start()

    print('[OK] 2 streaming queries started (trigger=5s)')
    print('[RUN] Pipeline running... (Ctrl+C to stop)')
    print()

    try:
        spark.streams.awaitAnyTermination()
    except KeyboardInterrupt:
        print()
        print('=' * 70)
        print('[STOP] Stopping Spark Streaming...')
        events_query.stop()
        kpi_query.stop()
        spark.stop()
        # Close connection pool
        try:
            if _pg_pool and not _pg_pool.closed:
                _pg_pool.closeall()
        except Exception:
            pass
        print('[OK] Spark session closed')


if __name__ == '__main__':
    try:
        main()
    except Exception as e:
        print(f'[FATAL] {str(e)}')
        sys.exit(1)
