import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceDot, Legend,
} from 'recharts'
import { ArrowDownRight, ArrowLeftRight, ArrowUpRight, RefreshCw } from 'lucide-react'
import { clsx } from 'clsx'
import { PageHeader } from '../components/ui/PageHeader'
import { Card, CardTitle } from '../components/ui/Card'
import { MetricCard } from '../components/ui/MetricCard'
import { InfoTooltip } from '../components/ui/InfoTooltip'
import { useAppStore } from '../store/useAppStore'
import { fetchEcbDailyExchangeRates, readEcbCache, writeEcbCache, ECB_CACHE_TTL } from '../lib/ecb'
import { getCombinedEurUsdForecast, type ForecastPoint } from '../lib/currencyForecast'

type PairMode = 'EURUSD' | 'USDEUR'
type RangeKey = '1W' | '1M' | '1Y' | '2Y' | '5Y' | '10Y'

interface RatePoint {
  date: string
  rate: number
}

interface ChartRow {
  date: string
  tradingEconomics?: number
  ecbSpfMedian?: number
  ecbSpfP10?: number
  ecbSpfP90?: number
  euroFxFutures?: number
}

type ForecastSeriesKey = Exclude<keyof ChartRow, 'date'>

const ranges: RangeKey[] = ['1W', '1M', '1Y', '2Y', '5Y', '10Y']

function startDateForRange(range: RangeKey) {
  const daysByRange: Record<RangeKey, number> = {
    '1W': 7,
    '1M': 31,
    '1Y': 365,
    '2Y': 365 * 2,
    '5Y': 365 * 5,
    '10Y': 365 * 10,
  }
  const date = new Date()
  date.setDate(date.getDate() - daysByRange[range])
  return date.toISOString().slice(0, 10)
}

function formatRate(value: number | undefined, mode: PairMode) {
  if (value == null || !Number.isFinite(value)) return '—'
  return value.toLocaleString(undefined, {
    minimumFractionDigits: mode === 'EURUSD' ? 4 : 5,
    maximumFractionDigits: mode === 'EURUSD' ? 4 : 5,
  })
}

function displayValue(value: number | undefined, mode: PairMode) {
  if (value == null || !Number.isFinite(value) || value <= 0) return undefined
  return mode === 'EURUSD' ? value : 1 / value
}

function pointValue(point: ForecastPoint, mode: PairMode) {
  return displayValue(point.value ?? point.median ?? point.mean, mode)
}

function forecastKey(point: ForecastPoint): ForecastSeriesKey | null {
  if (point.source === 'trading_economics') return 'tradingEconomics'
  if (point.source === 'euro_fx_futures') return 'euroFxFutures'
  if (point.source === 'ecb_spf') return 'ecbSpfMedian'
  return null
}

function sourceLabelForKey(key: string) {
  const labels: Record<string, string> = {
    tradingEconomics: 'Trading Economics',
    ecbSpfMedian: 'ECB SPF median',
    ecbSpfP10: 'ECB SPF p10',
    ecbSpfP90: 'ECB SPF p90',
    euroFxFutures: 'Euro FX futures',
  }
  return labels[key] ?? key
}

function compactDate(date: string) {
  const parsed = new Date(`${date}T00:00:00`)
  return parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' })
}

function ForecastTooltip({ active, payload, label, mode }: {
  active?: boolean
  payload?: Array<{ name?: string; value?: number; color?: string }>
  label?: string
  mode: PairMode
}) {
  if (!active || !payload?.length) return null
  const items = payload
    .filter(item => item.value != null && Number.isFinite(item.value))
    .sort((a, b) => Number(b.value) - Number(a.value))
  if (items.length === 0) return null
  return (
    <div className="rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-2.5 py-2 text-[11px] shadow-lg">
      <div className="font-medium mb-1">{label ? compactDate(label) : ''}</div>
      {items.map(item => (
        <div key={item.name} className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: item.color }} />
          <span className="text-gray-500 dark:text-gray-400">{sourceLabelForKey(String(item.name))}</span>
          <span className="font-medium tabular-nums">{formatRate(item.value, mode)}</span>
        </div>
      ))}
    </div>
  )
}

function rangeEndDate(range: RangeKey) {
  const daysByRange: Record<RangeKey, number> = {
    '1W': 7,
    '1M': 31,
    '1Y': 365,
    '2Y': 365 * 2,
    '5Y': 365 * 5,
    '10Y': 365 * 10,
  }
  const date = new Date()
  date.setDate(date.getDate() + daysByRange[range])
  return date.toISOString().slice(0, 10)
}

function paddedDomain(values: Array<number | undefined>) {
  const finite = values.filter((value): value is number => value != null && Number.isFinite(value))
  if (finite.length === 0) return ['auto', 'auto'] as [string, string]
  const min = Math.min(...finite)
  const max = Math.max(...finite)
  const span = Math.max(max - min, Math.abs(max) * 0.0025, 0.0025)
  const pad = span * 0.12
  return [min - pad, max + pad] as [number, number]
}

function ChartTitle({ children, tooltip }: { children: ReactNode; tooltip: ReactNode }) {
  return (
    <div className="text-[11.5px] font-medium text-gray-500 dark:text-gray-400 flex items-center leading-none">
      <span>{children}</span>
      <InfoTooltip text={tooltip} />
    </div>
  )
}

function HoverNote({ children, text }: { children: ReactNode; text: string }) {
  return (
    <span className="relative inline-flex group">
      {children}
      <span className="pointer-events-none fixed left-1/2 top-[56px] z-50 w-56 -translate-x-1/2 rounded-lg bg-gray-900 px-2.5 py-2 text-left text-[10px] leading-[1.4] text-white opacity-0 shadow-xl transition-opacity duration-100 group-hover:opacity-100 dark:bg-gray-700">
        {text}
      </span>
    </span>
  )
}

export default function Currencies() {
  const { lmProxyUrl } = useAppStore()
  const [mode, setMode] = useState<PairMode>('EURUSD')
  const [range, setRange] = useState<RangeKey>('1Y')
  const [rates, setRates] = useState<RatePoint[]>([])
  const [forecasts, setForecasts] = useState<ForecastPoint[]>([])
  const [historicalLoading, setHistoricalLoading] = useState(false)
  const [forecastLoading, setForecastLoading] = useState(false)
  const [refreshNonce, setRefreshNonce] = useState(0)

  useEffect(() => {
    let cancelled = false
    const startDate = startDateForRange(range)

    async function load() {
      // Immediately show cached data if available (for instant render)
      const cached = readEcbCache()
      if (cached) {
        const sliced = cached.rows.filter(r => r.date >= startDate)
        if (sliced.length > 0 && !cancelled) {
          setRates(sliced.map(row => ({ date: row.date, rate: row.value })))
        }
        // Skip network fetch if cache is from today and fresh (within TTL) and not a forced refresh
        const cacheAge = Date.now() - new Date(cached.fetchedAt).getTime()
        const cacheIsToday = new Date(cached.fetchedAt).toISOString().slice(0, 10) === new Date().toISOString().slice(0, 10)
        if (refreshNonce === 0 && cacheIsToday && cacheAge < ECB_CACHE_TTL) {
          if (!cancelled) setHistoricalLoading(false)
          if (cancelled) return
          setForecastLoading(true)
          try {
            const forecast = await getCombinedEurUsdForecast({ proxyUrl: lmProxyUrl })
            if (!cancelled) setForecasts(forecast.points)
          } catch { if (!cancelled) setForecasts([]) }
          if (!cancelled) setForecastLoading(false)
          return
        }
      }

      setHistoricalLoading(true)
      try {
        const rows = await fetchEcbDailyExchangeRates(startDate, lmProxyUrl)
        if (!cancelled) {
          setRates(rows.map(row => ({ date: row.date, rate: row.value })))
          // Update shared cache if this fetch covers >= 1Y of data
          const cutoff = new Date()
          cutoff.setFullYear(cutoff.getFullYear() - 1)
          if (rows.length > 0 && rows[0].date <= cutoff.toISOString().slice(0, 10)) {
            writeEcbCache(rows)
          }
        }
      } catch {
        if (!cancelled) setRates([])
      }

      if (!cancelled) setHistoricalLoading(false)
      if (cancelled) return

      setForecastLoading(true)
      try {
        const forecast = await getCombinedEurUsdForecast({ proxyUrl: lmProxyUrl })
        if (!cancelled) setForecasts(forecast.points)
      } catch { if (!cancelled) setForecasts([]) }

      if (!cancelled) setForecastLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [lmProxyUrl, range, refreshNonce])

  const historicalRows = useMemo(() => rates.map(point => ({
    date: point.date,
    rate: displayValue(point.rate, mode),
  })), [rates, mode])
  const historicalExtrema = useMemo(() => {
    const points = historicalRows.filter((row): row is { date: string; rate: number } => row.rate != null && Number.isFinite(row.rate))
    if (points.length === 0) return null
    const min = points.reduce((best, point) => point.rate < best.rate ? point : best, points[0])
    const max = points.reduce((best, point) => point.rate > best.rate ? point : best, points[0])
    return { min, max }
  }, [historicalRows])

  const latestRate = rates.length > 0 ? rates[rates.length - 1].rate : undefined
  const priorRate = rates.length > 1 ? rates[rates.length - 2].rate : undefined
  const latestEurUsd = displayValue(latestRate, 'EURUSD')
  const latestUsdEur = displayValue(latestRate, 'USDEUR')
  const priorEurUsd = displayValue(priorRate, 'EURUSD')
  const latestDate = rates.length > 0 ? rates[rates.length - 1].date : null
  const pairLabel = mode === 'EURUSD' ? 'EUR to USD' : 'USD to EUR'

  const forecastRows = useMemo(() => {
    const rows = new Map<string, ChartRow>()
    for (const point of forecasts) {
      const key = forecastKey(point)
      if (!key) continue
      const value = pointValue(point, mode)
      if (value == null) continue
      const row = rows.get(point.date) ?? { date: point.date }
      row[key] = value
      if (point.kind === 'survey_forecast') {
        row.ecbSpfP10 = displayValue(point.low, mode)
        row.ecbSpfP90 = displayValue(point.high, mode)
      }
      rows.set(point.date, row)
    }
    return [...rows.values()].sort((a, b) => a.date.localeCompare(b.date))
  }, [forecasts, mode])

  const visibleForecastRows = useMemo(() => {
    const cutoff = rangeEndDate(range)
    const inRange = forecastRows.filter(row => row.date <= cutoff)
    return inRange.length > 0 ? inRange : forecastRows
  }, [forecastRows, range])
  const historicalDomain = useMemo(() => paddedDomain(historicalRows.map(row => row.rate)), [historicalRows])
  const forecastDomain = useMemo(() => paddedDomain(visibleForecastRows.flatMap(row => [
    row.tradingEconomics,
    row.ecbSpfMedian,
    row.ecbSpfP10,
    row.ecbSpfP90,
    row.euroFxFutures,
  ])), [visibleForecastRows])

  const predictionMarkets = forecasts.filter(point => point.kind === 'prediction_market_probability')
  const forecastSummary = useMemo(() => {
    const points = visibleForecastRows.flatMap(row => [
      row.tradingEconomics == null ? null : { date: row.date, value: row.tradingEconomics },
      row.ecbSpfMedian == null ? null : { date: row.date, value: row.ecbSpfMedian },
      row.ecbSpfP10 == null ? null : { date: row.date, value: row.ecbSpfP10 },
      row.ecbSpfP90 == null ? null : { date: row.date, value: row.ecbSpfP90 },
      row.euroFxFutures == null ? null : { date: row.date, value: row.euroFxFutures },
    ]).filter((point): point is { date: string; value: number } => point != null && Number.isFinite(point.value))
    if (points.length === 0) return null
    const min = points.reduce((best, point) => point.value < best.value ? point : best, points[0])
    const max = points.reduce((best, point) => point.value > best.value ? point : best, points[0])
    return { min, max }
  }, [visibleForecastRows])
  const trend = useMemo(() => {
    const current = displayValue(latestRate, mode)
    if (current == null) return null
    const medianRow = visibleForecastRows.find(row => row.ecbSpfMedian != null)
    const futureValue = medianRow?.ecbSpfMedian
    if (futureValue == null) return null
    const delta = futureValue - current
    if (Math.abs(delta) < 0.0001) return { direction: 'flat' as const, text: `Median forecast (${formatRate(futureValue, mode)}) is unchanged from current rate.` }
    const rising = delta > 0
    return {
      direction: rising ? 'up' as const : 'down' as const,
      text: `Median forecast (${formatRate(futureValue, mode)}) is ${rising ? 'higher' : 'lower'} than current rate.`,
    }
  }, [latestRate, mode, visibleForecastRows])
  const spotTrend = useMemo(() => {
    if (latestEurUsd == null || priorEurUsd == null || Math.abs(latestEurUsd - priorEurUsd) < 0.0001) return null
    const rising = latestEurUsd > priorEurUsd
    return {
      direction: rising ? 'up' as const : 'down' as const,
      text: `Was ${formatRate(priorEurUsd, 'EURUSD')} yesterday.`,
    }
  }, [latestEurUsd, priorEurUsd])
  const loading = historicalLoading || forecastLoading

  return (
    <div>
      <PageHeader title="Currency">
        <button
          type="button"
          onClick={() => setMode(mode === 'EURUSD' ? 'USDEUR' : 'EURUSD')}
          className="h-[28px] px-2 rounded-[5px] text-[12px] border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 flex items-center gap-1.5"
        >
          <ArrowLeftRight size={13} />
          {mode === 'EURUSD' ? 'EUR/USD' : 'USD/EUR'}
        </button>
        <div className="flex rounded-[6px] border border-gray-200 dark:border-gray-700 overflow-hidden">
          {ranges.map(item => (
            <button
              key={item}
              type="button"
              onClick={() => setRange(item)}
              className={clsx(
                'h-[28px] px-2 text-[11px] border-r border-gray-200 dark:border-gray-700 last:border-r-0',
                range === item ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900' : 'hover:bg-gray-50 dark:hover:bg-gray-800'
              )}
            >
              {item}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setRefreshNonce(n => n + 1)}
          className="h-[28px] px-2 rounded-[5px] text-[12px] border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 flex items-center gap-1.5"
        >
          <RefreshCw size={13} className={clsx(loading && 'animate-spin')} />
          Refresh
        </button>
      </PageHeader>

      <div className="p-4 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <MetricCard
            label={`Current rate${latestDate ? ` (${latestDate})` : ''}`}
            value={
              <span className="inline-flex items-center gap-2">
                <span className={spotTrend ? (spotTrend.direction === 'up' ? 'text-red-500' : 'text-green-600') : undefined}>
                  {formatRate(latestEurUsd, 'EURUSD')}
                </span>
                {spotTrend && (
                  <span className={spotTrend.direction === 'up' ? 'text-red-500 inline-flex items-center' : 'text-green-600 inline-flex items-center'}>
                    <HoverNote text={spotTrend.text}>
                      {spotTrend.direction === 'up' ? <ArrowUpRight size={17} /> : <ArrowDownRight size={17} />}
                    </HoverNote>
                  </span>
                )}
              </span>
            }
            sub={<span>{formatRate(latestUsdEur, 'USDEUR')} USD/EUR</span>}
            tooltip="Latest ECB daily reference rate, shown as EUR/USD with the inverse USD/EUR below."
          />
          <MetricCard
            label={`Range (${startDateForRange(range)} to ${latestDate ?? '—'})`}
            value={historicalExtrema ? `${formatRate(historicalExtrema.min.rate, mode)} / ${formatRate(historicalExtrema.max.rate, mode)}` : '—'}
            sub={historicalExtrema ? `${historicalExtrema.min.date} / ${historicalExtrema.max.date}` : '—'}
            tooltip="Minimum and maximum historical rates in the selected date range."
          />
          <MetricCard
            label="Forecast"
            value={
              <span className="inline-flex items-center gap-2">
                <span>{forecastSummary ? `${formatRate(forecastSummary.min.value, mode)} / ${formatRate(forecastSummary.max.value, mode)}` : '—'}</span>
                {trend && (
                  <span className={clsx('inline-flex items-center', trend.direction === 'up' ? 'text-red-500' : 'text-green-600')}>
                    <HoverNote text={trend.text}>
                      {trend.direction === 'up' ? <ArrowUpRight size={13} /> : trend.direction === 'down' ? <ArrowDownRight size={13} /> : null}
                    </HoverNote>
                  </span>
                )}
              </span>
            }
            sub={forecastSummary ? `(${forecastSummary.min.date} / ${forecastSummary.max.date})` : 'No forecast points'}
            tooltip="Minimum and maximum values shown in the forecast chart. Trend compares the ECB SPF median to the current displayed spot rate."
          />
        </div>

        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
            <div className="flex items-center gap-1.5">
              <ChartTitle tooltip="Historical chart uses ECB daily USD per EUR reference rates. The toggle inverts displayed values for USD to EUR.">
                Historical {pairLabel}
              </ChartTitle>
            </div>
          </div>

          <div className="h-[320px] relative">
            {historicalRows.length === 0 ? (
              <div className="h-full flex items-center justify-center text-[12px] text-gray-400">
                {historicalLoading ? 'Loading exchange rates…' : 'No historical rates loaded.'}
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={historicalRows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                  <XAxis dataKey="date" tickFormatter={compactDate} tick={{ fontSize: 10 }} tickLine={false} axisLine={false} minTickGap={28} />
                  <YAxis domain={historicalDomain} tickFormatter={value => formatRate(Number(value), mode)} tick={{ fontSize: 10 }} tickLine={false} axisLine={false} width={54} />
                  <Tooltip content={({ active, payload, label }) => <ForecastTooltip active={active} payload={payload as Array<{ name?: string; value?: number; color?: string }>} label={String(label)} mode={mode} />} />
                  <Line type="monotone" dataKey="rate" name={mode === 'EURUSD' ? 'EUR/USD' : 'USD/EUR'} stroke="#2563eb" strokeWidth={2} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            )}
            {historicalLoading && historicalRows.length > 0 && (
              <div className="absolute inset-0 bg-white/55 dark:bg-gray-950/45 flex items-center justify-center">
                <div className="flex items-center gap-2 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-[12px] shadow-sm">
                  <RefreshCw size={13} className="animate-spin" />
                  Loading exchange rates…
                </div>
              </div>
            )}
          </div>
        </Card>

        <Card>
          <div className="flex items-center gap-1.5 mb-3">
            <ChartTitle tooltip="Combines point-like values only: Trading Economics model forecast, ECB SPF survey assumptions, and Euro FX futures. Prediction markets are shown separately as event probabilities.">
              Forecast
            </ChartTitle>
          </div>
          <div className="h-[320px]">
            {visibleForecastRows.length === 0 ? (
              <div className="h-full flex items-center justify-center text-[12px] text-gray-400">
                {forecastLoading ? 'Loading forecasts…' : 'No forecast points loaded.'}
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={visibleForecastRows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                  <XAxis dataKey="date" tickFormatter={compactDate} tick={{ fontSize: 10 }} tickLine={false} axisLine={false} minTickGap={22} />
                  <YAxis domain={forecastDomain} tickFormatter={value => formatRate(Number(value), mode)} tick={{ fontSize: 10 }} tickLine={false} axisLine={false} width={54} />
                  <Tooltip content={({ active, payload, label }) => <ForecastTooltip active={active} payload={payload as Array<{ name?: string; value?: number; color?: string }>} label={String(label)} mode={mode} />} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line type="monotone" dataKey="tradingEconomics" name="Trading Economics" stroke="#7c3aed" strokeWidth={2} dot={{ r: 6 }} activeDot={{ r: 8 }} isAnimationActive={false} connectNulls />
                  <Line type="monotone" dataKey="ecbSpfMedian" name="ECB SPF median" stroke="#0891b2" strokeWidth={2} dot={{ r: 6 }} activeDot={{ r: 8 }} isAnimationActive={false} connectNulls />
                  <Line type="monotone" dataKey="ecbSpfP10" name="ECB SPF p10" stroke="#67e8f9" strokeWidth={1.5} dot={{ r: 6 }} activeDot={{ r: 8 }} isAnimationActive={false} connectNulls />
                  <Line type="monotone" dataKey="ecbSpfP90" name="ECB SPF p90" stroke="#67e8f9" strokeWidth={1.5} dot={{ r: 6 }} activeDot={{ r: 8 }} isAnimationActive={false} connectNulls />
                  <Line type="monotone" dataKey="euroFxFutures" name="Euro FX futures" stroke="#ea580c" strokeWidth={2} dot={{ r: 7 }} activeDot={{ r: 9 }} isAnimationActive={false} connectNulls />
                  {predictionMarkets.slice(0, 6).map(point => (
                    <ReferenceDot
                      key={`${point.source}-${point.label}-${point.date}`}
                      x={point.date}
                      y={visibleForecastRows[0]?.tradingEconomics ?? visibleForecastRows[0]?.ecbSpfMedian ?? visibleForecastRows[0]?.euroFxFutures}
                      r={7}
                      fill="#111827"
                      stroke="#ffffff"
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
          <ul className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-2 text-[11px] text-gray-500 dark:text-gray-400 list-disc pl-4">
            <li><a href="https://tradingeconomics.com/forecast/currency" target="_blank" rel="noreferrer" className="font-medium text-gray-700 dark:text-gray-200 hover:underline">Trading Economics</a>: model forecast; useful as a directional analyst/model view.</li>
            <li><a href="https://www.ecb.europa.eu/stats/ecb_surveys/survey_of_professional_forecasters/html/index.en.html" target="_blank" rel="noreferrer" className="font-medium text-gray-700 dark:text-gray-200 hover:underline">ECB SPF</a>: professional survey assumptions; use median for consensus and p10/p90 for disagreement.</li>
            <li><a href="https://www.cmegroup.com/markets/fx/g10/euro-fx.html" target="_blank" rel="noreferrer" className="font-medium text-gray-700 dark:text-gray-200 hover:underline">Euro FX futures</a>: market-implied forward price; useful for executable market expectations, not a spot prediction.</li>
          </ul>
        </Card>

        {predictionMarkets.length > 0 && (
          <Card>
            <CardTitle>Prediction market annotations</CardTitle>
            <div className="space-y-2">
              {predictionMarkets.slice(0, 6).map(point => (
                <div key={`${point.source}-${point.label}`} className="flex items-start justify-between gap-3 text-[12px] border-b border-gray-100 dark:border-gray-800 last:border-b-0 pb-2 last:pb-0">
                  <div>
                    <a href={point.url} target="_blank" rel="noreferrer" className="font-medium hover:underline">{point.label}</a>
                    <div className="text-[10.5px] text-gray-400">{point.sourceLabel} · {point.caveat}</div>
                  </div>
                  <div className="font-medium tabular-nums">{point.probability == null ? '—' : `${Math.round(point.probability * 100)}%`}</div>
                </div>
              ))}
            </div>
          </Card>
        )}

      </div>
    </div>
  )
}
