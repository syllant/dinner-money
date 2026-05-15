import {
  CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { formatCompact, formatCurrency } from '../../lib/format'

export const DETERMINISTIC_SERIES_DEF = [
  { key: 'median', label: 'Total NW', color: '#64748b' },
  { key: 'liquidNW', label: 'Liquid NW', color: '#3b82f6' },
  { key: 'realEstateNW', label: 'Real Estate NW', color: '#8b5cf6' },
  { key: 'income', label: 'Income', color: '#22c55e' },
  { key: 'expense', label: 'Expenses', color: '#ef4444' },
  { key: 'tax', label: 'Tax', color: '#f97316' },
  { key: 'netCashFlow', label: 'Net', color: '#64748b' },
  { key: 'portfolioGrowth', label: 'Portfolio growth', color: '#14b8a6' },
  { key: 'withdrawal', label: 'Withdrawal', color: '#3b82f6' },
]

function ProjectionDetailsTooltip({ active, payload, label, currency = 'EUR' }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-gray-900 text-white text-[11px] px-3 py-2 rounded-lg shadow-lg border border-gray-700">
      <div className="font-semibold mb-1 pb-1 border-b border-gray-700">{label}</div>
      {payload.map((pt: any, i: number) => (
        <div key={i} className="flex items-center gap-2 mb-0.5">
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: pt.color }} />
          <span className="text-gray-300 flex-1">{pt.name}</span>
          <span className="font-medium">{formatCurrency(pt.value, currency)}</span>
        </div>
      ))}
    </div>
  )
}

export function DeterministicProjectionChart({
  data,
  ticks,
  selectedSeries,
  currency,
  height = 240,
}: {
  data: Array<Record<string, unknown>>
  ticks: string[]
  selectedSeries: string[]
  currency: string
  height?: number | string
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 10, right: 0, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#374151" opacity={0.2} />
        <XAxis dataKey="label" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} ticks={ticks} />
        <YAxis tickFormatter={(v) => formatCompact(v, currency)} tick={{ fontSize: 10 }} tickLine={false} axisLine={false} width={48} />
        <Tooltip content={<ProjectionDetailsTooltip currency={currency} />} />
        {DETERMINISTIC_SERIES_DEF.filter(series => selectedSeries.includes(series.key)).map(series => (
          <Line key={series.key} type="monotone" dataKey={series.key} name={series.label} stroke={series.color} strokeWidth={2} dot={false} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  )
}
