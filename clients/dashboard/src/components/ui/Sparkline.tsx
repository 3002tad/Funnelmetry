import ReactECharts from 'echarts-for-react'
import { useMemo } from 'react'

interface SparklineProps {
  data: number[];
  color?: string;
  height?: number;
}

export default function Sparkline({ data, color = '#818CF8', height = 32 }: SparklineProps) {
  const option = useMemo(() => ({
    grid: { left: 0, right: 0, top: 4, bottom: 4 },
    xAxis: { type: 'category', show: false, data: data.map((_, i) => i), boundaryGap: false },
    yAxis: { type: 'value', show: false, scale: true },
    tooltip: { show: false },
    animation: false,
    series: [{
      type: 'line',
      data,
      smooth: true,
      symbol: 'none',
      lineStyle: { color, width: 1.5 },
      areaStyle: {
        color: {
          type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
          colorStops: [
            { offset: 0, color: color + '40' },
            { offset: 1, color: color + '00' },
          ],
        },
      },
    }],
  }), [data, color])

  if (!data || data.length === 0) {
    return <div style={{ height }} />
  }

  return (
    <ReactECharts
      option={option}
      style={{ height, width: '100%' }}
      notMerge={true}
      opts={{ renderer: 'svg' }}
    />
  )
}
