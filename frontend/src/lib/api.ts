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

console.log('🔧 API Configuration:', {
  mode: USE_MOCK ? 'MOCK' : 'REAL API',
  baseURL: API_BASE_URL,
});

// ============================================================================
// API FUNCTIONS
// ============================================================================

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
    const response = await fetch(`${API_BASE_URL}/kpi?timeRange=${timeRange}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    return response.json();
  },

  async getTimeSeries(timeRange: TimeRange): Promise<TimeSeriesData[]> {
    if (USE_MOCK) {
      await new Promise(resolve => setTimeout(resolve, 300));
      return mockGenerator.generateTimeSeries(timeRange);
    }
    const response = await fetch(`${API_BASE_URL}/timeseries?timeRange=${timeRange}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    return response.json();
  },

  // Events APIs
  async getEvents(params: { page?: number; pageSize?: number; eventType?: EventType; status?: EventStatus } = {}): Promise<EventsResponse> {
    const { page = 1, pageSize = 20, eventType, status } = params;
    
    if (USE_MOCK) {
      await new Promise(resolve => setTimeout(resolve, 400));
      return mockGenerator.generateEvents(page, pageSize, { eventType, status });
    }
    
    const queryParams = new URLSearchParams({
      page: page.toString(),
      pageSize: pageSize.toString(),
      ...(eventType && { eventType }),
      ...(status && { status }),
    });
    const response = await fetch(`${API_BASE_URL}/events?${queryParams}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    return response.json();
  },

  // Ops APIs
  async getSystemHealth(): Promise<SystemHealth> {
    if (USE_MOCK) {
      await new Promise(resolve => setTimeout(resolve, 200));
      return mockGenerator.getSystemHealth();
    }
    const response = await fetch(`${API_BASE_URL}/health`);
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    return response.json();
  },

  async getSystemMetrics(): Promise<SystemMetrics> {
    if (USE_MOCK) {
      await new Promise(resolve => setTimeout(resolve, 200));
      return mockGenerator.getSystemMetrics();
    }
    const response = await fetch(`${API_BASE_URL}/metrics`);
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    return response.json();
  },

  async getAlerts(): Promise<Alert[]> {
    if (USE_MOCK) {
      await new Promise(resolve => setTimeout(resolve, 200));
      return mockGenerator.getAlerts();
    }
    const response = await fetch(`${API_BASE_URL}/alerts`);
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    return response.json();
  },

  async simulateIssue(type: 'kafka_down' | 'spark_crash' | 'reset'): Promise<SystemHealth> {
    if (USE_MOCK) {
      await new Promise(resolve => setTimeout(resolve, 300));
      return mockGenerator.simulateIssue(type);
    }
    const response = await fetch(`${API_BASE_URL}/simulate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    return response.json();
  },
};
