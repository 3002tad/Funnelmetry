import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api, ServiceStatus, AlertSeverity } from '@/lib/api'
import { format } from 'date-fns'
import { Activity, Database, Zap, Server, AlertTriangle, Play, RotateCcw } from 'lucide-react'
import Card from '@/components/ui/Card'
import clsx from 'clsx'

export default function Ops() {
  const [autoRefresh, setAutoRefresh] = useState(true)
  const queryClient = useQueryClient()

  // Fetch system health
  const { data: health, isLoading: healthLoading } = useQuery({
    queryKey: ['health'],
    queryFn: api.getSystemHealth,
    refetchInterval: autoRefresh ? 5000 : false,
  })

  // Fetch system metrics
  const { data: metrics, isLoading: metricsLoading } = useQuery({
    queryKey: ['metrics'],
    queryFn: api.getSystemMetrics,
    refetchInterval: autoRefresh ? 5000 : false,
  })

  // Fetch alerts
  const { data: alerts } = useQuery({
    queryKey: ['alerts'],
    queryFn: api.getAlerts,
    refetchInterval: autoRefresh ? 5000 : false,
  })

  // Mutation for simulations
  const simulateMutation = useMutation({
    mutationFn: api.simulateIssue,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['health'] })
      queryClient.invalidateQueries({ queryKey: ['alerts'] })
    },
  })

  const getStatusColor = (status: ServiceStatus) => {
    switch (status) {
      case 'healthy': return { bg: 'bg-green-50', border: 'border-success', text: 'text-success', dot: 'bg-success' }
      case 'degraded': return { bg: 'bg-yellow-50', border: 'border-warning', text: 'text-warning', dot: 'bg-warning' }
      case 'down': return { bg: 'bg-red-50', border: 'border-danger', text: 'text-danger', dot: 'bg-danger' }
    }
  }

  const getSeverityColor = (severity: AlertSeverity) => {
    switch (severity) {
      case 'critical': return { bg: 'bg-red-100', text: 'text-red-800', badge: 'bg-danger' }
      case 'warning': return { bg: 'bg-yellow-100', text: 'text-yellow-800', badge: 'bg-warning' }
      case 'info': return { bg: 'bg-blue-100', text: 'text-blue-800', badge: 'bg-info' }
    }
  }

  const ServiceHealthCard = ({ 
    name, 
    icon: Icon, 
    status, 
    message 
  }: { 
    name: string; 
    icon: any; 
    status: ServiceStatus; 
    message: string;
  }) => {
    const colors = getStatusColor(status)
    return (
      <div className={clsx('rounded-lg border-2 p-4', colors.bg, colors.border)}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Icon size={20} className={colors.text} />
            <h3 className="font-semibold text-gray-900">{name}</h3>
          </div>
          <div className="flex items-center gap-2">
            <div className={clsx('w-2.5 h-2.5 rounded-full', colors.dot)}></div>
            <span className={clsx('text-xs font-semibold uppercase', colors.text)}>
              {status}
            </span>
          </div>
        </div>
        <p className="text-sm text-gray-600">{message}</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Operations Console</h1>
          <p className="text-sm text-gray-500 mt-1">System health and administrative controls</p>
        </div>

        <button
          onClick={() => setAutoRefresh(!autoRefresh)}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg border text-sm font-medium transition-colors ${
            autoRefresh
              ? 'bg-success text-white border-success'
              : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
          }`}
        >
          <Activity size={16} className={autoRefresh ? 'animate-pulse' : ''} />
          Auto Refresh {autoRefresh ? 'ON' : 'OFF'}
        </button>
      </div>

      {/* System Health */}
      <div>
        <h2 className="text-lg font-semibold text-gray-900 mb-4">System Health</h2>
        {healthLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="bg-white rounded-lg border border-gray-200 p-4 h-24 animate-pulse" />
            ))}
          </div>
        ) : health ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <ServiceHealthCard
              name="Kafka"
              icon={Database}
              status={health.kafka.status}
              message={health.kafka.message}
            />
            <ServiceHealthCard
              name="Spark"
              icon={Zap}
              status={health.spark.status}
              message={health.spark.message}
            />
            <ServiceHealthCard
              name="Postgres"
              icon={Server}
              status={health.postgres.status}
              message={health.postgres.message}
            />
          </div>
        ) : null}
      </div>

      {/* Metrics & Controls */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Metrics */}
        <div className="lg:col-span-2 space-y-4">
          <h2 className="text-lg font-semibold text-gray-900">System Metrics</h2>
          
          <Card loading={metricsLoading}>
            {metrics && (
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <label className="text-sm text-gray-600">Kafka Lag</label>
                  <p className="text-3xl font-bold text-gray-900 mt-1">
                    {metrics.kafkaLag.toLocaleString()}
                  </p>
                  <p className="text-xs text-gray-500 mt-1">messages behind</p>
                </div>
                <div>
                  <label className="text-sm text-gray-600">Processing Rate</label>
                  <p className="text-3xl font-bold text-gray-900 mt-1">
                    {metrics.processedEventsPerSec.toLocaleString()}
                  </p>
                  <p className="text-xs text-gray-500 mt-1">events/second</p>
                </div>
              </div>
            )}
          </Card>

          {/* Alerts */}
          <div>
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Recent Alerts</h2>
            <Card>
              {alerts && alerts.length > 0 ? (
                <div className="space-y-3">
                  {alerts.map(alert => {
                    const colors = getSeverityColor(alert.severity)
                    return (
                      <div
                        key={alert.id}
                        className={clsx('rounded-lg p-4 border-l-4', colors.bg, `border-${alert.severity}`)}
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <span className={clsx('text-xs font-bold px-2 py-0.5 rounded uppercase text-white', colors.badge)}>
                                {alert.severity}
                              </span>
                              <span className="text-xs text-gray-500">{alert.service}</span>
                            </div>
                            <h4 className="font-semibold text-sm text-gray-900 mb-1">{alert.title}</h4>
                            <p className="text-sm text-gray-600">{alert.message}</p>
                            <p className="text-xs text-gray-500 mt-2">
                              {format(new Date(alert.timestamp), 'dd/MM/yyyy HH:mm:ss')}
                            </p>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div className="text-center py-8">
                  <AlertTriangle size={48} className="text-gray-300 mx-auto mb-2" />
                  <p className="text-sm text-gray-500">No alerts at this time</p>
                </div>
              )}
            </Card>
          </div>
        </div>

        {/* Control Panel */}
        <div>
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Simulation Controls</h2>
          <Card>
            <div className="space-y-3">
              <p className="text-sm text-gray-600 mb-4">
                Simulate system failures to test monitoring and alerting
              </p>

              <button
                onClick={() => simulateMutation.mutate('kafka_down')}
                disabled={simulateMutation.isPending}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-danger text-white rounded-lg hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm font-medium"
              >
                <Database size={18} />
                Kafka Down
              </button>

              <button
                onClick={() => simulateMutation.mutate('spark_crash')}
                disabled={simulateMutation.isPending}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-danger text-white rounded-lg hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm font-medium"
              >
                <Zap size={18} />
                Spark Crash
              </button>

              <button
                onClick={() => simulateMutation.mutate('reset')}
                disabled={simulateMutation.isPending}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-success text-white rounded-lg hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm font-medium"
              >
                <RotateCcw size={18} />
                Reset All
              </button>

              <div className="mt-6 pt-6 border-t border-gray-200">
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
                  <p className="text-xs text-yellow-800">
                    <strong>Note:</strong> These are mock simulations. No actual systems are affected.
                  </p>
                </div>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}
