-- ============================================================================
-- REALTIME E-COMMERCE DATA PIPELINE - DATABASE SCHEMA
-- ============================================================================
-- Database: realtime
-- User: app / Password: app
-- ============================================================================

-- Drop tables if exist (for clean re-initialization)
DROP TABLE IF EXISTS kpi_1m CASCADE;
DROP TABLE IF EXISTS events_clean CASCADE;

-- ============================================================================
-- TABLE 1: events_clean
-- Stores cleaned and validated events from Kafka
-- ============================================================================
CREATE TABLE events_clean (
    id VARCHAR(50) PRIMARY KEY,
    event_time TIMESTAMP NOT NULL,
    event_type VARCHAR(50) NOT NULL,
    order_id VARCHAR(50) NOT NULL,
    user_id VARCHAR(50) NOT NULL,
    amount DECIMAL(15, 2) NOT NULL,
    currency VARCHAR(10) NOT NULL,
    status VARCHAR(20) NOT NULL,
    ingest_time TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    -- Constraints
    CONSTRAINT chk_amount CHECK (amount >= 0),
    CONSTRAINT chk_event_type CHECK (
        event_type IN (
            'order_created',
            'payment_initiated',
            'payment_success',
            'payment_failed',
            'order_cancelled'
        )
    ),
    CONSTRAINT chk_status CHECK (status IN ('success', 'failed', 'pending'))
);

-- Index for time-based queries
CREATE INDEX idx_events_clean_event_time ON events_clean(event_time DESC);
CREATE INDEX idx_events_clean_event_type ON events_clean(event_type);
CREATE INDEX idx_events_clean_order_id ON events_clean(order_id);

-- ============================================================================
-- TABLE 2: kpi_1m
-- Stores 1-minute windowed KPIs
-- ============================================================================
CREATE TABLE kpi_1m (
    window_start TIMESTAMP PRIMARY KEY,
    window_end TIMESTAMP NOT NULL,
    revenue DECIMAL(18, 2) NOT NULL DEFAULT 0,
    orders_created INTEGER NOT NULL DEFAULT 0,
    payment_initiated INTEGER NOT NULL DEFAULT 0,
    payment_success INTEGER NOT NULL DEFAULT 0,
    payment_failed INTEGER NOT NULL DEFAULT 0,
    order_cancelled INTEGER NOT NULL DEFAULT 0,
    success_rate DECIMAL(5, 2) DEFAULT 0,
    
    -- Metadata
    processed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    -- Constraints
    CONSTRAINT chk_window_order CHECK (window_end > window_start),
    CONSTRAINT chk_success_rate CHECK (success_rate BETWEEN 0 AND 100)
);

-- Index for time-range queries
CREATE INDEX idx_kpi_1m_window_start ON kpi_1m(window_start DESC);

-- ============================================================================
-- TABLE 3: event_traces
-- Stores distributed tracing data for pipeline latency monitoring
-- ============================================================================
DROP TABLE IF EXISTS event_traces CASCADE;

CREATE TABLE event_traces (
    event_id VARCHAR(50) PRIMARY KEY,
    t_generated TIMESTAMP,
    t_kafka_sent TIMESTAMP,
    t_spark_processed TIMESTAMP,
    t_db_written TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    latency_gen_to_kafka_ms INTEGER,
    latency_kafka_to_spark_ms INTEGER,
    latency_spark_to_db_ms INTEGER,
    latency_total_ms INTEGER
);

CREATE INDEX idx_event_traces_t_generated ON event_traces(t_generated DESC);

-- ============================================================================
-- VIEWS FOR DASHBOARD (OPTIONAL - FOR EASIER API QUERIES)
-- ============================================================================

-- View: Last 15 minutes KPI aggregation
CREATE OR REPLACE VIEW v_kpi_15m AS
SELECT
    MIN(window_start) as period_start,
    MAX(window_end) as period_end,
    SUM(revenue) as total_revenue,
    SUM(orders_created) as total_orders,
    SUM(payment_initiated) as total_payment_initiated,
    SUM(payment_success) as total_success,
    SUM(payment_failed) as total_payment_failed,
    SUM(order_cancelled) as total_cancelled,
    SUM(orders_created + payment_initiated) as total_pending,
    SUM(payment_failed + order_cancelled) as total_failed_all,
    SUM(orders_created + payment_initiated + payment_success + payment_failed + order_cancelled) as total_events,
    COALESCE(
        ROUND(100.0 * SUM(payment_success) / NULLIF(SUM(payment_success) + SUM(payment_failed) + SUM(order_cancelled), 0), 2),
        0
    ) as success_rate
FROM kpi_1m
WHERE window_start >= NOW() - INTERVAL '15 minutes';

-- View: Last 1 hour KPI aggregation
CREATE OR REPLACE VIEW v_kpi_1h AS
SELECT
    MIN(window_start) as period_start,
    MAX(window_end) as period_end,
    SUM(revenue) as total_revenue,
    SUM(orders_created) as total_orders,
    SUM(payment_initiated) as total_payment_initiated,
    SUM(payment_success) as total_success,
    SUM(payment_failed) as total_payment_failed,
    SUM(order_cancelled) as total_cancelled,
    SUM(orders_created + payment_initiated) as total_pending,
    SUM(payment_failed + order_cancelled) as total_failed_all,
    SUM(orders_created + payment_initiated + payment_success + payment_failed + order_cancelled) as total_events,
    COALESCE(
        ROUND(100.0 * SUM(payment_success) / NULLIF(SUM(payment_success) + SUM(payment_failed) + SUM(order_cancelled), 0), 2),
        0
    ) as success_rate
FROM kpi_1m
WHERE window_start >= NOW() - INTERVAL '1 hour';

-- View: Last 24 hours KPI aggregation
CREATE OR REPLACE VIEW v_kpi_24h AS
SELECT
    MIN(window_start) as period_start,
    MAX(window_end) as period_end,
    SUM(revenue) as total_revenue,
    SUM(orders_created) as total_orders,
    SUM(payment_initiated) as total_payment_initiated,
    SUM(payment_success) as total_success,
    SUM(payment_failed) as total_payment_failed,
    SUM(order_cancelled) as total_cancelled,
    SUM(orders_created + payment_initiated) as total_pending,
    SUM(payment_failed + order_cancelled) as total_failed_all,
    SUM(orders_created + payment_initiated + payment_success + payment_failed + order_cancelled) as total_events,
    COALESCE(
        ROUND(100.0 * SUM(payment_success) / NULLIF(SUM(payment_success) + SUM(payment_failed) + SUM(order_cancelled), 0), 2),
        0
    ) as success_rate
FROM kpi_1m
WHERE window_start >= NOW() - INTERVAL '24 hours';

-- ============================================================================
-- SAMPLE QUERIES (FOR TESTING)
-- ============================================================================

-- Check events_clean
-- SELECT * FROM events_clean ORDER BY event_time DESC LIMIT 10;

-- Check KPIs
-- SELECT * FROM kpi_1m ORDER BY window_start DESC LIMIT 10;

-- Get last 15 minutes stats
-- SELECT * FROM v_kpi_15m;

-- Count events by type
-- SELECT event_type, COUNT(*) FROM events_clean GROUP BY event_type;

-- Revenue over time
-- SELECT window_start, revenue, orders_created FROM kpi_1m ORDER BY window_start DESC LIMIT 20;
