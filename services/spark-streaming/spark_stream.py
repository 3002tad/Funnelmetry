#!/usr/bin/env python3
"""
Spark Structured Streaming Job for E-commerce Realtime Pipeline
Reads from Kafka -> Parse & Validate -> Clean & Deduplicate -> Calculate KPIs -> Persist to PostgreSQL
"""

from pyspark.sql import SparkSession
from pyspark.sql.functions import (
    col, from_json, to_timestamp, current_timestamp,
    window, sum as _sum, count, when, round as _round
)
from pyspark.sql.types import (
    StructType, StructField, StringType, DoubleType, TimestampType
)
import sys
import os
import time
from kafka.admin import KafkaAdminClient, NewTopic
from kafka.errors import TopicAlreadyExistsError

# ============================================================================
# CONFIGURATION — read from environment variables with sensible defaults
# ============================================================================
KAFKA_BOOTSTRAP_SERVERS = os.environ.get('KAFKA_BOOTSTRAP_SERVERS', 'kafka:9092')
KAFKA_TOPIC             = os.environ.get('KAFKA_TOPIC', 'events_raw')
KAFKA_NUM_PARTITIONS    = int(os.environ.get('KAFKA_NUM_PARTITIONS', '3'))
KAFKA_MAX_OFFSETS_PER_TRIGGER = int(os.environ.get('KAFKA_MAX_OFFSETS_PER_TRIGGER', '5000'))
CHECKPOINT_DIR          = os.environ.get('CHECKPOINT_DIR', '/app/checkpoints/spark_stream')

# PostgreSQL configuration
POSTGRES_HOST     = os.environ.get('POSTGRES_HOST', 'postgres')
POSTGRES_PORT     = int(os.environ.get('POSTGRES_PORT', '5432'))
POSTGRES_DB       = os.environ.get('POSTGRES_DB', 'realtime')
POSTGRES_URL      = f'jdbc:postgresql://{POSTGRES_HOST}:{POSTGRES_PORT}/{POSTGRES_DB}'
POSTGRES_USER     = os.environ.get('POSTGRES_USER', 'app')
POSTGRES_PASSWORD = os.environ.get('POSTGRES_PASSWORD', 'app')
POSTGRES_DRIVER   = 'org.postgresql.Driver'

# Kafka topic bootstrap behaviour
KAFKA_TOPIC_WAIT_TIMEOUT_SEC = int(os.environ.get('KAFKA_TOPIC_WAIT_TIMEOUT_SEC', '180'))
KAFKA_TOPIC_WAIT_INTERVAL_SEC = int(os.environ.get('KAFKA_TOPIC_WAIT_INTERVAL_SEC', '3'))

# ============================================================================
# SCHEMA DEFINITION
# ============================================================================

# Define schema for incoming JSON events
EVENT_SCHEMA = StructType([
    StructField('id', StringType(), nullable=False),
    StructField('eventTime', StringType(), nullable=False),
    StructField('eventType', StringType(), nullable=False),
    StructField('orderId', StringType(), nullable=False),
    StructField('userId', StringType(), nullable=False),
    StructField('amount', DoubleType(), nullable=False),
    StructField('currency', StringType(), nullable=False),
    StructField('status', StringType(), nullable=False),
])

# ============================================================================
# SPARK SESSION
# ============================================================================

def create_spark_session():
    """Create Spark session with necessary configurations"""
    spark = SparkSession.builder \
        .appName('EcommerceRealtimePipeline') \
        .master('local[*]') \
        .config('spark.sql.streaming.checkpointLocation', CHECKPOINT_DIR) \
    .config('spark.sql.shuffle.partitions', 12) \
    .config('spark.default.parallelism', 12) \
    .config('spark.sql.adaptive.enabled', 'true') \
        .config('spark.jars.packages', 
                'org.apache.spark:spark-sql-kafka-0-10_2.12:3.5.0,'
                'org.postgresql:postgresql:42.6.0') \
        .getOrCreate()
    
    spark.sparkContext.setLogLevel('WARN')
    return spark


def ensure_kafka_topic(topic_name, bootstrap_servers, timeout_sec=180, interval_sec=3):
    """
    Ensure Kafka topic exists before starting Spark readStream.
    This prevents immediate Stream failure with UnknownTopicOrPartitionException.
    """
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
                print(f'✅ Kafka topic exists: {topic_name}')
                return

            print(f'ℹ️  Topic "{topic_name}" not found. Creating...')
            admin.create_topics(
                new_topics=[NewTopic(name=topic_name, num_partitions=KAFKA_NUM_PARTITIONS, replication_factor=1)],
                validate_only=False,
            )
            print(f'✅ Kafka topic created: {topic_name} with {KAFKA_NUM_PARTITIONS} partitions')
            return
        except TopicAlreadyExistsError:
            print(f'✅ Kafka topic already exists: {topic_name}')
            return
        except Exception as e:
            last_error = e
            print(f'⏳ Waiting Kafka/topic ready ({interval_sec}s): {str(e)}')
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
# UC03 - PARSE & VALIDATE
# ============================================================================

def parse_and_validate(df):
    """
    Parse JSON from Kafka and validate basic rules
    - Parse JSON according to schema
    - Validate: id, eventTime, eventType, orderId != null
    - Validate: amount >= 0
    Invalid events are logged (not persisted to invalid topic in this version)
    """
    # Parse JSON
    parsed_df = df.select(
        col('value').cast('string').alias('raw_value')
    ).select(
        from_json(col('raw_value'), EVENT_SCHEMA).alias('data'),
        col('raw_value')
    ).select('data.*', 'raw_value')
    
    # Validation flags
    validated_df = parsed_df.withColumn(
        'is_valid',
        (col('id').isNotNull()) &
        (col('eventTime').isNotNull()) &
        (col('eventType').isNotNull()) &
        (col('orderId').isNotNull()) &
        (col('amount') >= 0)
    )
    
    # Filter valid events only
    valid_df = validated_df.filter(col('is_valid') == True).drop('is_valid', 'raw_value')
    
    # Invalid events - just count and log (could write to separate topic)
    # For now, we'll just filter them out
    
    return valid_df


# ============================================================================
# UC04 - CLEAN & DEDUPLICATE
# ============================================================================

def clean_and_deduplicate(df):
    """
    Clean and deduplicate events
    - Convert eventTime string to timestamp
    - Add ingest_time
    - dropDuplicates by id
    - withWatermark for late data handling
    """
    cleaned_df = df \
        .withColumn('event_time', to_timestamp(col('eventTime'), "yyyy-MM-dd'T'HH:mm:ss.SSSSSS'Z'")) \
        .withColumn('event_time', 
                   when(col('event_time').isNull(), 
                        to_timestamp(col('eventTime'))).otherwise(col('event_time'))) \
        .withColumn('ingest_time', current_timestamp()) \
        .withWatermark('event_time', '30 seconds') \
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
            col('ingest_time')
        )
    
    return cleaned_df


# ============================================================================
# UC05 - CALCULATE KPIs
# ============================================================================

def calculate_kpis(df):
    """
    Calculate 1-minute windowed KPIs:
    - revenue = sum(amount) where event_type = 'payment_success'
    - orders_created = count where event_type = 'order_created'
    - payment_success = count where event_type = 'payment_success'
    - payment_failed = count where event_type = 'payment_failed'
    - success_rate = payment_success / (payment_success + payment_failed) * 100
    """
    kpi_df = df \
        .groupBy(window(col('event_time'), '1 minute')) \
        .agg(
            # Revenue from successful payments only
            _sum(when(col('event_type') == 'payment_success', col('amount')).otherwise(0)).alias('revenue'),
            
            # Count by event type
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
            # Calculate success rate
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
# UC06 - PERSIST TO POSTGRESQL
# ============================================================================

def write_to_postgres(batch_df, batch_id, table_name):
    """
    Write batch DataFrame to PostgreSQL using foreachBatch
    Uses JDBC connection (append mode — for tables without PK conflicts)
    """
    # NOTE: avoid batch_df.count() here — it forces a full extra Spark scan before writing
    try:
        batch_df.write \
            .format('jdbc') \
            .option('url', POSTGRES_URL) \
            .option('dbtable', table_name) \
            .option('user', POSTGRES_USER) \
            .option('password', POSTGRES_PASSWORD) \
            .option('driver', POSTGRES_DRIVER) \
            .option('batchsize', '10000') \
            .option('numPartitions', '4') \
            .option('isolationLevel', 'READ_UNCOMMITTED') \
            .mode('append') \
            .save()
        
        print(f'✅ Batch {batch_id}: Wrote rows to {table_name}')
    except Exception as e:
        print(f'❌ Batch {batch_id}: Error writing to {table_name}: {str(e)}')
        raise


def upsert_kpi_to_postgres(batch_df, batch_id):
    """
    Upsert KPI rows into kpi_1m using ON CONFLICT (window_start) DO UPDATE.
    This handles Spark re-emitting updated windows without duplicate key errors.
    """
    import psycopg2

    # NOTE: avoid batch_df.count() — collect() returns [] if empty, no need for separate count scan
    rows = batch_df.collect()
    if not rows:
        print(f'⚠️  Batch {batch_id} is empty, skipping KPI upsert')
        return

    try:
        conn = psycopg2.connect(
            host=POSTGRES_HOST,
            port=POSTGRES_PORT,
            dbname=POSTGRES_DB,
            user=POSTGRES_USER,
            password=POSTGRES_PASSWORD,
        )
        cur = conn.cursor()

        upsert_sql = """
            INSERT INTO kpi_1m
                (window_start, window_end, revenue, orders_created, payment_initiated,
                 payment_success, payment_failed, order_cancelled, success_rate, processed_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
            ON CONFLICT (window_start) DO UPDATE SET
                window_end        = EXCLUDED.window_end,
                revenue           = EXCLUDED.revenue,
                orders_created    = EXCLUDED.orders_created,
                payment_initiated = EXCLUDED.payment_initiated,
                payment_success   = EXCLUDED.payment_success,
                payment_failed    = EXCLUDED.payment_failed,
                order_cancelled   = EXCLUDED.order_cancelled,
                success_rate      = EXCLUDED.success_rate,
                processed_at      = NOW()
        """

        data = [
            (
                row['window_start'],
                row['window_end'],
                float(row['revenue']),
                int(row['orders_created']),
                int(row['payment_initiated']),
                int(row['payment_success']),
                int(row['payment_failed']),
                int(row['order_cancelled']),
                float(row['success_rate']),
            )
            for row in rows
        ]

        cur.executemany(upsert_sql, data)
        conn.commit()
        cur.close()
        conn.close()
        print(f'✅ Batch {batch_id}: Upserted {len(data)} KPI rows into kpi_1m')
    except Exception as e:
        print(f'❌ Batch {batch_id}: Error upserting KPI: {str(e)}')
        raise


# ============================================================================
# MAIN STREAMING PIPELINE
# ============================================================================

def main():
    print('=' * 70)
    print('🚀 SPARK STRUCTURED STREAMING - E-COMMERCE PIPELINE')
    print('=' * 70)
    print(f'📡 Kafka: {KAFKA_BOOTSTRAP_SERVERS}')
    print(f'📝 Topic: {KAFKA_TOPIC}')
    print(f'🗄️  PostgreSQL: {POSTGRES_URL}')
    print(f'📂 Checkpoint: {CHECKPOINT_DIR}')
    print('=' * 70)
    print()
    
    # Create Spark session
    spark = create_spark_session()

    # Ensure topic exists before creating stream source
    ensure_kafka_topic(
        KAFKA_TOPIC,
        KAFKA_BOOTSTRAP_SERVERS,
        timeout_sec=KAFKA_TOPIC_WAIT_TIMEOUT_SEC,
        interval_sec=KAFKA_TOPIC_WAIT_INTERVAL_SEC,
    )
    
    # Read from Kafka
    print('📖 Reading from Kafka...')
    raw_stream = spark.readStream \
        .format('kafka') \
        .option('kafka.bootstrap.servers', KAFKA_BOOTSTRAP_SERVERS) \
        .option('subscribe', KAFKA_TOPIC) \
        .option('startingOffsets', 'latest') \
        .option('maxOffsetsPerTrigger', str(KAFKA_MAX_OFFSETS_PER_TRIGGER)) \
        .option('failOnDataLoss', 'false') \
        .option('kafka.allow.auto.create.topics', 'true') \
        .load()
    
    # UC03: Parse and validate
    print('🔍 UC03: Parsing and validating events...')
    valid_events = parse_and_validate(raw_stream)
    
    # UC04: Clean and deduplicate
    print('🧹 UC04: Cleaning and deduplicating...')
    clean_events = clean_and_deduplicate(valid_events)
    
    # UC05: Calculate KPIs
    print('📊 UC05: Calculating KPIs...')
    kpis = calculate_kpis(clean_events)
    
    # UC06: Persist to PostgreSQL
    print('💾 UC06: Setting up persistence to PostgreSQL...')
    
    # Stream 1: Write clean events to events_clean table
    events_query = clean_events.writeStream \
        .foreachBatch(lambda batch_df, batch_id: write_to_postgres(batch_df, batch_id, 'events_clean')) \
        .outputMode('append') \
        .trigger(processingTime='2 seconds') \
        .option('checkpointLocation', f'{CHECKPOINT_DIR}/events_clean') \
        .start()
    
    # Stream 2: Upsert KPIs to kpi_1m table (ON CONFLICT DO UPDATE)
    kpi_query = kpis.writeStream \
        .foreachBatch(upsert_kpi_to_postgres) \
        .outputMode('update') \
        .trigger(processingTime='2 seconds') \
        .option('checkpointLocation', f'{CHECKPOINT_DIR}/kpi_1m') \
        .start()
    
    print('✅ Streaming queries started!')
    print('🟢 Pipeline is running... (Press Ctrl+C to stop)')
    print()
    
    # Wait for termination
    try:
        spark.streams.awaitAnyTermination()
    except KeyboardInterrupt:
        print()
        print('=' * 70)
        print('🛑 Stopping Spark Streaming...')
        print('=' * 70)
        events_query.stop()
        kpi_query.stop()
        spark.stop()
        print('✅ Spark session closed')


if __name__ == '__main__':
    try:
        main()
    except Exception as e:
        print(f'❌ Fatal error: {str(e)}')
        sys.exit(1)
