// ============================================================================
// TYPES & INTERFACES
// ============================================================================

export type TimeRange = '15m' | '1h' | '24h';
export type EventType = 'order_created' | 'payment_initiated' | 'payment_success' | 'payment_failed' | 'order_cancelled';
export type EventStatus = 'success' | 'failed' | 'pending';
export type ServiceStatus = 'healthy' | 'degraded' | 'down';
export type AlertSeverity = 'critical' | 'warning' | 'info';

// Dashboard KPI
// Status mapping:
//   success  = paymentSuccess
//   pending  = orders_created + payment_initiated
//   failed   = totalFailed (payment_failed + order_cancelled)
export interface BusinessKPI {
  revenue: number;
  totalEvents: number;
  paymentSuccess: number;
  pending: number;
  totalFailed: number;
  successRate: number;
}

// Time series data for charts
export interface TimeSeriesData {
  timestamp: string;
  revenue: number;
  ordersCreated: number;
  paymentSuccess: number;
  paymentFailed: number;
}

// Event data
export interface Event {
  id: string;
  eventTime: string;
  eventType: EventType;
  orderId: string;
  userId: string;
  amount: number;
  currency: string;
  status: EventStatus;
  metadata?: Record<string, any>;
}

export interface EventsResponse {
  events: Event[];
  total: number;
  page: number;
  pageSize: number;
  statusCounts?: { success: number; failed: number; pending: number };
}

// Ops/System Health
export interface SystemHealth {
  kafka: { status: ServiceStatus; message: string };
  spark: { status: ServiceStatus; message: string };
  postgres: { status: ServiceStatus; message: string };
}

export interface SystemMetrics {
  kafkaLag: number;
  processedEventsPerSec: number;
  timestamp: string;
}

export interface Alert {
  id: string;
  severity: AlertSeverity;
  title: string;
  message: string;
  timestamp: string;
  service: string;
}

// Full time series (all 5 event types)
export interface FullTimeSeriesData {
  timestamp: string;
  revenue: number;
  ordersCreated: number;
  paymentInitiated: number;
  paymentSuccess: number;
  paymentFailed: number;
  orderCancelled: number;
  successRate: number;
}

// Top users
export interface TopUser {
  userId: string;
  eventCount: number;
  totalAmount: number;
  successCount: number;
  failedCount: number;
}

// Amount distribution
export interface AmountBucket {
  range: string;
  count: number;
}

// Latency timeline
export interface LatencyTimelinePoint {
  timestamp: string;
  p50: number;
  p95: number;
  count: number;
}

// Scatter plot: amount vs latency
export interface ScatterPoint {
  amount: number;
  latency: number;
  eventType: EventType;
  status: EventStatus;
}

// Revenue by event type
export interface RevenueByType {
  eventType: string;
  count: number;
  revenue: number;
}

// Heatmap data
export interface HeatmapCell {
  hour: number;
  eventType: string;
  count: number;
}

// Category analytics
export interface CategoryStat {
  category: string;
  count: number;
  revenue: number;
}

// Region analytics
export interface RegionStat {
  region: string;
  count: number;
  revenue: number;
}

// Payment method analytics
export interface PaymentStat {
  paymentMethod: string;
  count: number;
  revenue: number;
  successRate: number;
}

// Top products
export interface TopProduct {
  productId: string;
  productName: string;
  category: string;
  revenue: number;
  orderCount: number;
}

// Distributed tracing
export interface EventTrace {
  eventId: string;
  tGenerated: string | null;
  tKafkaSent: string | null;
  tSparkProcessed: string | null;
  tDbWritten: string | null;
  latencyGenToKafkaMs: number | null;
  latencyKafkaToSparkMs: number | null;
  latencySparkToDbMs: number | null;
  latencyTotalMs: number | null;
}

export interface TraceStats {
  count: number;
  p50: number | null;
  p95: number | null;
  p99: number | null;
  avgGenToKafkaMs: number | null;
  avgKafkaToSparkMs: number | null;
  avgSparkToDbMs: number | null;
}

// ============================================================================
// MOCK DATA GENERATOR
// ============================================================================

class MockDataGenerator {
  private baseRevenue = 1000000;
  private systemHealth: SystemHealth = {
    kafka: { status: 'healthy', message: 'All brokers operational' },
    spark: { status: 'healthy', message: 'Streaming jobs running' },
    postgres: { status: 'healthy', message: 'Database responsive' },
  };
  private alerts: Alert[] = [];

  // Generate KPI data based on time range
  generateKPI(timeRange: TimeRange): BusinessKPI {
    const multiplier = this.getTimeRangeMultiplier(timeRange);
    const totalEvents = Math.floor(Math.random() * 500 * multiplier) + 1000 * multiplier;
    const paymentSuccess = Math.floor(totalEvents * 0.35);
    const pending = Math.floor(totalEvents * 0.55);
    const totalFailed = totalEvents - paymentSuccess - pending;
    const successRate = (paymentSuccess / (paymentSuccess + totalFailed)) * 100;

    return {
      revenue: Math.floor(this.baseRevenue * multiplier + Math.random() * 100000),
      totalEvents,
      paymentSuccess,
      pending,
      totalFailed,
      successRate: Math.round(successRate * 100) / 100,
    };
  }

  // Generate time series data for charts
  generateTimeSeries(timeRange: TimeRange): TimeSeriesData[] {
    const points = this.getTimeSeriesPoints(timeRange);
    const data: TimeSeriesData[] = [];
    const now = Date.now();

    for (let i = points; i >= 0; i--) {
      const timestamp = new Date(now - i * this.getIntervalMs(timeRange));
      const baseOrders = Math.floor(Math.random() * 50) + 20;
      const paymentSuccess = Math.floor(baseOrders * 0.85);
      const paymentFailed = baseOrders - paymentSuccess;

      data.push({
        timestamp: timestamp.toISOString(),
        revenue: Math.floor(Math.random() * 50000) + 20000,
        ordersCreated: baseOrders,
        paymentSuccess,
        paymentFailed,
      });
    }

    return data;
  }

  // Generate events for table
  generateEvents(page: number, pageSize: number, filters?: { eventType?: EventType; status?: EventStatus }): EventsResponse {
    const eventTypes: EventType[] = ['order_created', 'payment_initiated', 'payment_success', 'payment_failed', 'order_cancelled'];
    const statuses: EventStatus[] = ['success', 'failed', 'pending'];
    const currencies = ['VND', 'USD'];
    
    const total = 2847; // Mock total
    const events: Event[] = [];
    
    for (let i = 0; i < pageSize; i++) {
      const eventType = filters?.eventType || eventTypes[Math.floor(Math.random() * eventTypes.length)];
      const status = filters?.status || statuses[Math.floor(Math.random() * statuses.length)];
      
      events.push({
        id: `evt_${Date.now()}_${i}`,
        eventTime: new Date(Date.now() - Math.random() * 86400000).toISOString(),
        eventType,
        orderId: `ORD${Math.floor(Math.random() * 100000)}`,
        userId: `USR${Math.floor(Math.random() * 10000)}`,
        amount: Math.floor(Math.random() * 5000000) + 100000,
        currency: currencies[Math.floor(Math.random() * currencies.length)],
        status,
        metadata: {
          ip: `192.168.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`,
          device: ['mobile', 'desktop', 'tablet'][Math.floor(Math.random() * 3)],
        },
      });
    }

    return { events, total, page, pageSize };
  }

  // Get system health
  getSystemHealth(): SystemHealth {
    return { ...this.systemHealth };
  }

  // Get system metrics
  getSystemMetrics(): SystemMetrics {
    return {
      kafkaLag: Math.floor(Math.random() * 200) + 50,
      processedEventsPerSec: Math.floor(Math.random() * 500) + 800,
      timestamp: new Date().toISOString(),
    };
  }

  // Get alerts
  getAlerts(): Alert[] {
    return [...this.alerts];
  }

  // Generate mock trace data
  generateTrace(eventId: string): EventTrace {
    const now = Date.now();
    const genToKafka = Math.floor(Math.random() * 80) + 10;
    const kafkaToSpark = Math.floor(Math.random() * 300) + 50;
    const sparkToDb = Math.floor(Math.random() * 50) + 5;
    const total = genToKafka + kafkaToSpark + sparkToDb;
    const tGen = new Date(now - total).toISOString();
    const tKafka = new Date(now - total + genToKafka).toISOString();
    const tSpark = new Date(now - sparkToDb).toISOString();
    const tDb = new Date(now).toISOString();
    return {
      eventId,
      tGenerated: tGen,
      tKafkaSent: tKafka,
      tSparkProcessed: tSpark,
      tDbWritten: tDb,
      latencyGenToKafkaMs: genToKafka,
      latencyKafkaToSparkMs: kafkaToSpark,
      latencySparkToDbMs: sparkToDb,
      latencyTotalMs: total,
    };
  }

  // Generate full time series (all 5 event types)
  generateFullTimeSeries(timeRange: TimeRange): FullTimeSeriesData[] {
    const points = this.getTimeSeriesPoints(timeRange);
    const data: FullTimeSeriesData[] = [];
    const now = Date.now();
    for (let i = points; i >= 0; i--) {
      const timestamp = new Date(now - i * this.getIntervalMs(timeRange));
      const ordersCreated = Math.floor(Math.random() * 30) + 10;
      const paymentInitiated = Math.floor(ordersCreated * 0.9);
      const paymentSuccess = Math.floor(paymentInitiated * 0.8);
      const paymentFailed = Math.floor(paymentInitiated * 0.1);
      const orderCancelled = Math.floor(ordersCreated * 0.05);
      const successRate = paymentSuccess + paymentFailed + orderCancelled > 0
        ? Math.round(10000 * paymentSuccess / (paymentSuccess + paymentFailed + orderCancelled)) / 100
        : 0;
      data.push({
        timestamp: timestamp.toISOString(),
        revenue: Math.floor(Math.random() * 50000) + 20000,
        ordersCreated, paymentInitiated, paymentSuccess, paymentFailed, orderCancelled, successRate,
      });
    }
    return data;
  }

  // Generate top users
  generateTopUsers(limit: number): TopUser[] {
    const users: TopUser[] = [];
    for (let i = 0; i < limit; i++) {
      const eventCount = Math.floor(Math.random() * 200) + 10;
      users.push({
        userId: `USR${Math.floor(Math.random() * 10000)}`,
        eventCount,
        totalAmount: eventCount * (Math.floor(Math.random() * 500000) + 100000),
        successCount: Math.floor(eventCount * 0.7),
        failedCount: Math.floor(eventCount * 0.1),
      });
    }
    return users.sort((a, b) => b.eventCount - a.eventCount);
  }

  // Generate amount distribution
  generateAmountDistribution(): AmountBucket[] {
    return [
      { range: '0', count: Math.floor(Math.random() * 20) },
      { range: '< 100K', count: Math.floor(Math.random() * 200) + 50 },
      { range: '100K-500K', count: Math.floor(Math.random() * 300) + 100 },
      { range: '500K-1M', count: Math.floor(Math.random() * 250) + 80 },
      { range: '1M-3M', count: Math.floor(Math.random() * 150) + 30 },
      { range: '3M+', count: Math.floor(Math.random() * 50) + 10 },
    ];
  }

  // Generate latency timeline
  generateLatencyTimeline(timeRange: TimeRange): LatencyTimelinePoint[] {
    const points = this.getTimeSeriesPoints(timeRange);
    const data: LatencyTimelinePoint[] = [];
    const now = Date.now();
    for (let i = points; i >= 0; i--) {
      const timestamp = new Date(now - i * this.getIntervalMs(timeRange));
      data.push({
        timestamp: timestamp.toISOString(),
        p50: Math.floor(Math.random() * 200) + 80,
        p95: Math.floor(Math.random() * 400) + 300,
        count: Math.floor(Math.random() * 100) + 20,
      });
    }
    return data;
  }

  // Generate scatter data
  generateScatter(limit: number): ScatterPoint[] {
    const types: EventType[] = ['order_created', 'payment_initiated', 'payment_success', 'payment_failed', 'order_cancelled'];
    const statuses: EventStatus[] = ['success', 'failed', 'pending'];
    const points: ScatterPoint[] = [];
    for (let i = 0; i < limit; i++) {
      points.push({
        amount: Math.floor(Math.random() * 5000000) + 10000,
        latency: Math.floor(Math.random() * 800) + 50,
        eventType: types[Math.floor(Math.random() * types.length)],
        status: statuses[Math.floor(Math.random() * statuses.length)],
      });
    }
    return points;
  }

  // Generate revenue by type
  generateRevenueByType(): RevenueByType[] {
    return [
      { eventType: 'order_created', count: Math.floor(Math.random() * 500) + 200, revenue: Math.floor(Math.random() * 2000000) + 500000 },
      { eventType: 'payment_initiated', count: Math.floor(Math.random() * 400) + 150, revenue: Math.floor(Math.random() * 1800000) + 400000 },
      { eventType: 'payment_success', count: Math.floor(Math.random() * 350) + 100, revenue: Math.floor(Math.random() * 1500000) + 300000 },
      { eventType: 'payment_failed', count: Math.floor(Math.random() * 100) + 20, revenue: Math.floor(Math.random() * 500000) + 50000 },
      { eventType: 'order_cancelled', count: Math.floor(Math.random() * 80) + 10, revenue: Math.floor(Math.random() * 300000) + 30000 },
    ];
  }

  // Generate heatmap data
  generateHeatmap(): HeatmapCell[] {
    const types = ['order_created', 'payment_initiated', 'payment_success', 'payment_failed', 'order_cancelled'];
    const cells: HeatmapCell[] = [];
    for (let h = 0; h < 24; h++) {
      for (const t of types) {
        // Higher activity during business hours
        const base = h >= 8 && h <= 20 ? 30 : 5;
        cells.push({ hour: h, eventType: t, count: Math.floor(Math.random() * base) + 1 });
      }
    }
    return cells;
  }

  // Generate category stats
  generateCategoryStats(): CategoryStat[] {
    const categories = ['electronics', 'fashion', 'food', 'home', 'beauty', 'books'];
    const priceRanges: Record<string, number> = { electronics: 3000000, fashion: 800000, food: 150000, home: 1200000, beauty: 500000, books: 200000 };
    return categories.map(cat => {
      const count = Math.floor(Math.random() * 300) + 50;
      return { category: cat, count, revenue: Math.floor(count * priceRanges[cat] * (0.8 + Math.random() * 0.4)) };
    }).sort((a, b) => b.revenue - a.revenue);
  }

  // Generate region stats
  generateRegionStats(): RegionStat[] {
    const regions = ['VN', 'US', 'SG', 'JP', 'TH', 'MY', 'ID', 'PH', 'AU'];
    return regions.map(region => {
      const count = Math.floor(Math.random() * 400) + 20;
      return { region, count, revenue: Math.floor(count * (Math.random() * 1000000 + 200000)) };
    }).sort((a, b) => b.count - a.count);
  }

  // Generate payment stats
  generatePaymentStats(): PaymentStat[] {
    const methods = ['credit_card', 'e_wallet', 'bank_transfer', 'cod'];
    return methods.map(method => {
      const count = Math.floor(Math.random() * 400) + 80;
      const successRate = Math.round((0.6 + Math.random() * 0.35) * 10000) / 100;
      return { paymentMethod: method, count, revenue: Math.floor(count * (Math.random() * 1000000 + 200000)), successRate };
    });
  }

  // Generate top products
  generateTopProducts(limit: number): TopProduct[] {
    const products = [
      { productId: 'E001', productName: 'iPhone 15 Pro', category: 'electronics' },
      { productId: 'E002', productName: 'Samsung Galaxy S24', category: 'electronics' },
      { productId: 'F001', productName: 'Nike Air Max 270', category: 'fashion' },
      { productId: 'H001', productName: 'Dyson V15 Vacuum', category: 'home' },
      { productId: 'B001', productName: 'Lipstick Set Premium', category: 'beauty' },
      { productId: 'E003', productName: 'iPad Pro 12.9"', category: 'electronics' },
      { productId: 'F002', productName: 'Adidas Ultraboost 22', category: 'fashion' },
      { productId: 'O001', productName: 'Pho Bo Special', category: 'food' },
      { productId: 'H002', productName: 'KitchenAid Mixer', category: 'home' },
      { productId: 'K001', productName: 'Clean Code (Book)', category: 'books' },
    ];
    return products.slice(0, limit).map(p => {
      const orderCount = Math.floor(Math.random() * 100) + 10;
      return { ...p, orderCount, revenue: Math.floor(orderCount * (Math.random() * 2000000 + 500000)) };
    }).sort((a, b) => b.revenue - a.revenue);
  }

  // Simulate system issues
  simulateIssue(type: 'kafka_down' | 'spark_crash' | 'reset') {
    if (type === 'reset') {
      this.systemHealth = {
        kafka: { status: 'healthy', message: 'All brokers operational' },
        spark: { status: 'healthy', message: 'Streaming jobs running' },
        postgres: { status: 'healthy', message: 'Database responsive' },
      };
      this.alerts = this.alerts.filter(a => a.severity === 'info');
      this.addAlert('info', 'System Reset', 'All systems restored to normal', 'system');
    } else if (type === 'kafka_down') {
      this.systemHealth.kafka = { status: 'down', message: 'Connection timeout - brokers unreachable' };
      this.addAlert('critical', 'Kafka Cluster Down', 'Unable to connect to Kafka brokers', 'kafka');
    } else if (type === 'spark_crash') {
      this.systemHealth.spark = { status: 'down', message: 'Streaming job failed - OOM error' };
      this.addAlert('critical', 'Spark Job Crashed', 'Streaming application terminated', 'spark');
    }

    return this.systemHealth;
  }

  private addAlert(severity: AlertSeverity, title: string, message: string, service: string) {
    this.alerts.unshift({
      id: `alert_${Date.now()}`,
      severity,
      title,
      message,
      timestamp: new Date().toISOString(),
      service,
    });
    // Keep only last 20 alerts
    if (this.alerts.length > 20) {
      this.alerts = this.alerts.slice(0, 20);
    }
  }

  private getTimeRangeMultiplier(timeRange: TimeRange): number {
    switch (timeRange) {
      case '15m': return 1;
      case '1h': return 4;
      case '24h': return 96;
    }
  }

  private getTimeSeriesPoints(timeRange: TimeRange): number {
    switch (timeRange) {
      case '15m': return 15;
      case '1h': return 60;
      case '24h': return 48;
    }
  }

  private getIntervalMs(timeRange: TimeRange): number {
    switch (timeRange) {
      case '15m': return 60000; // 1 minute
      case '1h': return 60000; // 1 minute
      case '24h': return 1800000; // 30 minutes
    }
  }
}

// Singleton instance
const mockGenerator = new MockDataGenerator();

// ============================================================================
// API CONFIGURATION
// ============================================================================

// Read from environment variables
export const USE_MOCK = import.meta.env.VITE_USE_MOCK === 'true';
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api';

// ============================================================================
// AUTH HEADER HELPER
// ============================================================================

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem('rt_dashboard_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function authFetch(url: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(url, {
    ...init,
    headers: { ...authHeaders(), ...init?.headers },
  });
  if (response.status === 401) {
    // Token expired — clear storage and dispatch event for React to handle
    localStorage.removeItem('rt_dashboard_token');
    localStorage.removeItem('rt_dashboard_user');
    window.dispatchEvent(new CustomEvent('auth:expired'));
    throw new Error('Session expired');
  }
  return response;
}

// ============================================================================
// API FUNCTIONS
// ============================================================================

export const api = {
  // Dashboard APIs
  async getKpi(timeRange: TimeRange): Promise<BusinessKPI> {
    if (USE_MOCK) {
      await new Promise(resolve => setTimeout(resolve, 300)); // Simulate network delay
      return mockGenerator.generateKPI(timeRange);
    }
    const response = await authFetch(`${API_BASE_URL}/kpi?timeRange=${timeRange}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    return response.json();
  },

  async getTimeSeries(timeRange: TimeRange): Promise<TimeSeriesData[]> {
    if (USE_MOCK) {
      await new Promise(resolve => setTimeout(resolve, 300));
      return mockGenerator.generateTimeSeries(timeRange);
    }
    const response = await authFetch(`${API_BASE_URL}/timeseries?timeRange=${timeRange}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    return response.json();
  },

  // Events APIs
  async getEvents(params: {
    page?: number;
    pageSize?: number;
    eventType?: EventType;
    status?: EventStatus;
    search?: string;
    sortBy?: string;
    sortDir?: 'asc' | 'desc';
  } = {}): Promise<EventsResponse> {
    const { page = 1, pageSize = 20, eventType, status, search, sortBy, sortDir } = params;

    if (USE_MOCK) {
      await new Promise(resolve => setTimeout(resolve, 400));
      return mockGenerator.generateEvents(page, pageSize, { eventType, status });
    }

    const queryParams = new URLSearchParams({
      page: page.toString(),
      pageSize: pageSize.toString(),
      ...(eventType && { eventType }),
      ...(status && { status }),
      ...(search && { search }),
      ...(sortBy && { sortBy }),
      ...(sortDir && { sortDir }),
    });
    const response = await authFetch(`${API_BASE_URL}/events?${queryParams}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    return response.json();
  },

  // Export events as CSV download
  getExportUrl(params: { eventType?: string; status?: string; search?: string } = {}): string {
    const queryParams = new URLSearchParams();
    if (params.eventType) queryParams.set('eventType', params.eventType);
    if (params.status) queryParams.set('status', params.status);
    if (params.search) queryParams.set('search', params.search);
    return `${API_BASE_URL}/events/export?${queryParams}`;
  },

  // Ops APIs
  async getSystemHealth(): Promise<SystemHealth> {
    if (USE_MOCK) {
      await new Promise(resolve => setTimeout(resolve, 200));
      return mockGenerator.getSystemHealth();
    }
    const response = await authFetch(`${API_BASE_URL}/health`);
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    return response.json();
  },

  async getSystemMetrics(): Promise<SystemMetrics> {
    if (USE_MOCK) {
      await new Promise(resolve => setTimeout(resolve, 200));
      return mockGenerator.getSystemMetrics();
    }
    const response = await authFetch(`${API_BASE_URL}/metrics`);
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    return response.json();
  },

  async getAlerts(): Promise<Alert[]> {
    if (USE_MOCK) {
      await new Promise(resolve => setTimeout(resolve, 200));
      return mockGenerator.getAlerts();
    }
    const response = await authFetch(`${API_BASE_URL}/alerts`);
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    return response.json();
  },

  async simulateIssue(type: 'kafka_down' | 'spark_crash' | 'reset'): Promise<SystemHealth> {
    if (USE_MOCK) {
      await new Promise(resolve => setTimeout(resolve, 300));
      return mockGenerator.simulateIssue(type);
    }
    const response = await authFetch(`${API_BASE_URL}/simulate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    return response.json();
  },

  // Tracing APIs
  async getEventTrace(eventId: string): Promise<EventTrace | null> {
    if (USE_MOCK) {
      await new Promise(resolve => setTimeout(resolve, 200));
      return mockGenerator.generateTrace(eventId);
    }
    const response = await authFetch(`${API_BASE_URL}/events/${eventId}/trace`);
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    return response.json();
  },

  // Full time series (all 5 event types)
  async getFullTimeSeries(timeRange: TimeRange): Promise<FullTimeSeriesData[]> {
    if (USE_MOCK) {
      await new Promise(resolve => setTimeout(resolve, 300));
      return mockGenerator.generateFullTimeSeries(timeRange);
    }
    const response = await authFetch(`${API_BASE_URL}/timeseries/full?timeRange=${timeRange}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    return response.json();
  },

  // Top users
  async getTopUsers(timeRange: TimeRange, limit = 10): Promise<TopUser[]> {
    if (USE_MOCK) {
      await new Promise(resolve => setTimeout(resolve, 300));
      return mockGenerator.generateTopUsers(limit);
    }
    const response = await authFetch(`${API_BASE_URL}/events/top-users?timeRange=${timeRange}&limit=${limit}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    return response.json();
  },

  // Amount distribution
  async getAmountDistribution(timeRange: TimeRange): Promise<AmountBucket[]> {
    if (USE_MOCK) {
      await new Promise(resolve => setTimeout(resolve, 300));
      return mockGenerator.generateAmountDistribution();
    }
    const response = await authFetch(`${API_BASE_URL}/events/amount-distribution?timeRange=${timeRange}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    return response.json();
  },

  // Latency timeline
  async getLatencyTimeline(timeRange: TimeRange): Promise<LatencyTimelinePoint[]> {
    if (USE_MOCK) {
      await new Promise(resolve => setTimeout(resolve, 300));
      return mockGenerator.generateLatencyTimeline(timeRange);
    }
    const response = await authFetch(`${API_BASE_URL}/traces/timeline?timeRange=${timeRange}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    return response.json();
  },

  // Scatter: amount vs latency
  async getScatterData(timeRange: TimeRange, limit = 200): Promise<ScatterPoint[]> {
    if (USE_MOCK) {
      await new Promise(resolve => setTimeout(resolve, 300));
      return mockGenerator.generateScatter(limit);
    }
    const response = await authFetch(`${API_BASE_URL}/events/scatter?timeRange=${timeRange}&limit=${limit}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    return response.json();
  },

  // Revenue by event type
  async getRevenueByType(timeRange: TimeRange): Promise<RevenueByType[]> {
    if (USE_MOCK) {
      await new Promise(resolve => setTimeout(resolve, 300));
      return mockGenerator.generateRevenueByType();
    }
    const response = await authFetch(`${API_BASE_URL}/events/revenue-by-type?timeRange=${timeRange}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    return response.json();
  },

  // Heatmap
  async getHeatmap(timeRange: TimeRange): Promise<HeatmapCell[]> {
    if (USE_MOCK) {
      await new Promise(resolve => setTimeout(resolve, 300));
      return mockGenerator.generateHeatmap();
    }
    const response = await authFetch(`${API_BASE_URL}/events/heatmap?timeRange=${timeRange}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    return response.json();
  },

  async getTraceStats(timeRange: TimeRange): Promise<TraceStats> {
    if (USE_MOCK) {
      await new Promise(resolve => setTimeout(resolve, 200));
      return { count: 1200, p50: 180, p95: 450, p99: 820, avgGenToKafkaMs: 35, avgKafkaToSparkMs: 120, avgSparkToDbMs: 15 };
    }
    const response = await authFetch(`${API_BASE_URL}/traces/stats?timeRange=${timeRange}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    return response.json();
  },

  // Category analytics
  async getByCategory(timeRange: TimeRange): Promise<CategoryStat[]> {
    if (USE_MOCK) {
      await new Promise(resolve => setTimeout(resolve, 300));
      return mockGenerator.generateCategoryStats();
    }
    const response = await authFetch(`${API_BASE_URL}/events/by-category?timeRange=${timeRange}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    return response.json();
  },

  // Region analytics
  async getByRegion(timeRange: TimeRange): Promise<RegionStat[]> {
    if (USE_MOCK) {
      await new Promise(resolve => setTimeout(resolve, 300));
      return mockGenerator.generateRegionStats();
    }
    const response = await authFetch(`${API_BASE_URL}/events/by-region?timeRange=${timeRange}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    return response.json();
  },

  // Payment method analytics
  async getByPayment(timeRange: TimeRange): Promise<PaymentStat[]> {
    if (USE_MOCK) {
      await new Promise(resolve => setTimeout(resolve, 300));
      return mockGenerator.generatePaymentStats();
    }
    const response = await authFetch(`${API_BASE_URL}/events/by-payment?timeRange=${timeRange}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    return response.json();
  },

  // Top products by revenue
  async getTopProducts(timeRange: TimeRange, limit = 10): Promise<TopProduct[]> {
    if (USE_MOCK) {
      await new Promise(resolve => setTimeout(resolve, 300));
      return mockGenerator.generateTopProducts(limit);
    }
    const response = await authFetch(`${API_BASE_URL}/events/top-products?timeRange=${timeRange}&limit=${limit}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    return response.json();
  },
};
