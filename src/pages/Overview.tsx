import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { PanelTopOpen, RefreshCw } from 'lucide-react'
import { PageHeader } from '../components/ui/PageHeader'
import { Card } from '../components/ui/Card'
import { InfoTooltip } from '../components/ui/InfoTooltip'
import { AccountLogo } from '../components/ui/AccountLabel'
import {
  CUR_BADGE, EUR_BADGE_CLS, USD_BADGE_CLS,
  findFirstNegative, fmtNative, formatK,
} from '../components/cashflow/ProjectionView'
import { DeterministicProjectionChart } from '../components/lifetime/DeterministicProjectionChart'
import { useAppStore } from '../store/useAppStore'
import { useHistoricalSimulation } from '../hooks/useHistoricalSimulation'
import { buildCashProjection } from '../lib/cashProjection'
import { convertToBase } from '../lib/currency'
import { computeAnnualDividendsEUR } from '../lib/dividends'
import { readEcbCache } from '../lib/ecb'
import { formatCompact, formatCurrency } from '../lib/format'
import { fetchIntradayFxRates, fetchIntradayPrices, isUsMarketHours, type IntradayPricePoint } from '../lib/tiingo'
import {
  accountBaseValue,
  aggregateNavHistory,
  currentPlanningAccounts,
  investmentAccountValue,
  liquidAccountValue,
  totalAccountValue,
} from '../lib/accountMetrics'
import type { Account, AccountType, Currency } from '../types'

type ReturnRow = { label: string; amount: number | null; pct: number | null }
type SparkRange = '1D' | '1W' | '1M' | 'YTD' | '1Y'
type FxRange = '1D' | '1W' | '1M' | '1Y'
type CashPoint = {
  label: string
  date: string
  month: ReturnType<typeof buildCashProjection>[number]
  balances: ReturnType<typeof buildCashProjection>[number]['accountBalances']
  eur: number
  usd: number
}

const ACCOUNT_TYPE_COLORS: Record<string, string> = {
  cash: '#0ea5e9',
  investment: '#22c55e',
  retirement: '#7F77DD',
  real_estate: '#f59e0b',
}

function signedCurrency(amount: number | null, currency: Currency | string): string {
  if (amount == null || !isFinite(amount)) return '-'
  return `${amount > 0 ? '+' : ''}${formatCurrency(amount, currency)}`
}

function signedPct(value: number | null, decimals = 2): string {
  if (value == null || !isFinite(value)) return '-'
  return `${value >= 0 ? '+' : ''}${(value * 100).toFixed(decimals)}%`
}

function usePersistedState<T>(key: string, init: T): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key)
      return raw ? JSON.parse(raw) as T : init
    } catch {
      return init
    }
  })
  const setPersisted = (next: T) => {
    setValue(next)
    try { localStorage.setItem(key, JSON.stringify(next)) } catch {}
  }
  return [value, setPersisted]
}

function trendClass(value: number | null | undefined): string {
  if (value == null || !isFinite(value)) return 'text-gray-400'
  return value >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400'
}

function SectionTitle({ to, title, tooltip, right }: {
  to: string
  title: string
  tooltip: string
  right?: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between mb-3">
      <div className="flex items-center gap-2 min-w-0">
        <div className="flex items-center text-[12px] font-medium text-gray-700 dark:text-gray-200">
          {title}
          <InfoTooltip text={tooltip} />
        </div>
        {right}
      </div>
      <Link to={to} className="h-6 w-6 rounded-[5px] flex items-center justify-center text-gray-400 hover:text-gray-700 hover:bg-gray-50 dark:hover:text-gray-200 dark:hover:bg-gray-800">
        <PanelTopOpen size={14} />
      </Link>
    </div>
  )
}

function MiniSparkline({ points, color = '#378ADD', height = 72, formatValue }: {
  points: Array<{ date: string; value: number | null }>
  color?: string
  height?: number
  formatValue?: (value: number) => string
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)
  const values = points.map(point => point.value).filter((value): value is number => value != null && isFinite(value))
  if (values.length < 2) {
    return <div className="rounded-md bg-gray-50 dark:bg-gray-800" style={{ height }} />
  }
  const width = 260
  const axisY = height - 14
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = Math.max(max - min, 0.0001)
  const coords = points.map((point, index) => {
    if (point.value == null) return null
      const x = 6 + index * ((width - 12) / Math.max(1, points.length - 1))
      const y = height - 20 - ((point.value - min) / span) * (height - 30)
      return { x, y, point, index }
    })
  const path = coords
    .map(coord => coord ? `${coord.x.toFixed(1)},${coord.y.toFixed(1)}` : null)
    .filter((point): point is string => point != null)
    .join(' ')
  const ticks = [...new Set([0, Math.round((points.length - 1) / 3), Math.round((points.length - 1) * 2 / 3), points.length - 1])]
    .filter(index => index >= 0 && index < points.length)
  const hoverCoord = hoverIdx != null ? coords[hoverIdx] : null
  const tooltipText = hoverCoord && hoverCoord.point.value != null
    ? `${fmtAxisDate(hoverCoord.point.date)} · ${(formatValue ?? ((value: number) => value.toLocaleString()))(hoverCoord.point.value)}`
    : ''
  const handleMove = (event: React.MouseEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const svgX = ((event.clientX - rect.left) / rect.width) * width
    const nearest = coords
      .filter((coord): coord is NonNullable<typeof coord> => coord != null)
      .reduce((best, coord) => Math.abs(coord.x - svgX) < Math.abs(best.x - svgX) ? coord : best)
    setHoverIdx(nearest.index)
  }
  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full"
        style={{ height }}
        preserveAspectRatio="none"
        aria-hidden="true"
        onMouseMove={handleMove}
        onMouseLeave={() => setHoverIdx(null)}
      >
        <polyline points={path} fill="none" stroke={color} strokeWidth="2.25" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />
        <line x1="6" y1={axisY} x2={width - 6} y2={axisY} stroke="#e5e7eb" strokeWidth="0.8" vectorEffect="non-scaling-stroke" />
        {ticks.map(index => {
          const x = 6 + index * ((width - 12) / Math.max(1, points.length - 1))
          return (
            <g key={index}>
              <line x1={x} y1={axisY} x2={x} y2={axisY + 3} stroke="#d1d5db" strokeWidth="0.7" vectorEffect="non-scaling-stroke" />
              <text x={x} y={height - 2} textAnchor={index === 0 ? 'start' : index === points.length - 1 ? 'end' : 'middle'} fontSize="8.5" fill="#9ca3af">
                {fmtAxisDate(points[index].date)}
              </text>
            </g>
          )
        })}
        {hoverCoord && (
          <>
            <line x1={hoverCoord.x} y1={4} x2={hoverCoord.x} y2={axisY} stroke="#9ca3af" strokeWidth="0.8" strokeDasharray="2 2" vectorEffect="non-scaling-stroke" />
            <circle cx={hoverCoord.x} cy={hoverCoord.y} r="3.5" fill={color} vectorEffect="non-scaling-stroke" />
          </>
        )}
      </svg>
      {hoverCoord && (
        <div
          className="pointer-events-none absolute z-20 rounded-lg bg-gray-900 px-2.5 py-1.5 text-[10.5px] text-white shadow-xl whitespace-nowrap"
          style={{
            left: `${Math.min(80, Math.max(0, hoverCoord.x / width * 100))}%`,
            top: 2,
            transform: 'translateX(-50%)',
          }}
        >
          {tooltipText}
        </div>
      )}
    </div>
  )
}

function lastNonNull(points: Array<{ value: number | null }>): number | null {
  for (let i = points.length - 1; i >= 0; i--) {
    const value = points[i].value
    if (value != null && isFinite(value)) return value
  }
  return null
}

function fmtAxisDate(dateStr: string): string {
  if (dateStr.includes('T')) {
    const date = new Date(dateStr)
    if (Number.isNaN(date.getTime())) return ''
    return date.toLocaleTimeString(undefined, { hour: 'numeric' })
  }
  const date = new Date(`${dateStr}T12:00:00`)
  if (Number.isNaN(date.getTime())) return dateStr.slice(5)
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function formatMonthEnd(year: number, month: number): string {
  const date = new Date(year, month, 0)
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function todayLabel(): string {
  return new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function RangeTabs<T extends string>({ ranges, value, onChange }: {
  ranges: T[]
  value: T
  onChange: (value: T) => void
}) {
  return (
    <div className="flex items-center gap-1">
      {ranges.map(range => (
        <button
          key={range}
          type="button"
          onClick={() => onChange(range)}
          className={`h-5 px-1.5 rounded-[4px] text-[9.5px] font-medium transition-colors ${
            value === range
              ? 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-100'
              : 'text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
          }`}
        >
          {range}
        </button>
      ))}
    </div>
  )
}

function dateDaysAgo(days: number): string {
  const date = new Date()
  date.setDate(date.getDate() - days)
  return date.toISOString().slice(0, 10)
}

function ytdStart(): string {
  return `${new Date().getFullYear()}-01-01`
}

function monthStart(): string {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-01`
}

function rangeStart(range: SparkRange | FxRange): string {
  if (range === '1D') return dateDaysAgo(2)
  if (range === '1W') return dateDaysAgo(8)
  if (range === '1M') return dateDaysAgo(33)
  if (range === 'YTD') return ytdStart()
  return dateDaysAgo(366)
}

function valueAtOrBefore(points: Array<{ date: string; value: number }>, date: string) {
  for (let i = points.length - 1; i >= 0; i--) {
    if (points[i].date <= date) return points[i]
  }
  return null
}

function navReturn(points: Array<{ date: string; value: number }> | null, startDate: string, currentValue: number) {
  if (!points || points.length < 2) return { amount: null as number | null, pct: null as number | null }
  const start = valueAtOrBefore(points, startDate) ?? points[0]
  if (!start || start.value <= 0) return { amount: null, pct: null }
  const amount = currentValue - start.value
  return { amount, pct: amount / start.value }
}

function slicePoints(points: Array<{ date: string; value: number }>, range: SparkRange | FxRange) {
  const start = rangeStart(range)
  const sliced = points.filter(point => point.date >= start)
  return (sliced.length >= 2 ? sliced : points.slice(-2)).map(point => ({ ...point }))
}

function padToMarketClose(points: Array<{ date: string; value: number }>): Array<{ date: string; value: number | null }> {
  if (points.length === 0) return []
  const last = new Date(points[points.length - 1].date)
  const month = last.getUTCMonth()
  const isDST = month >= 2 && month <= 9
  const closeHourUTC = isDST ? 20 : 21
  if (new Date().getUTCHours() >= closeHourUTC) return points.map(point => ({ ...point }))
  const intervalMs = points.length >= 2
    ? new Date(points[1].date).getTime() - new Date(points[0].date).getTime()
    : 3_600_000
  const result: Array<{ date: string; value: number | null }> = points.map(point => ({ ...point }))
  let next = new Date(last.getTime() + intervalMs)
  while (next.getUTCHours() < closeHourUTC) {
    result.push({ date: next.toISOString().replace('Z', '+00:00'), value: null })
    next = new Date(next.getTime() + intervalMs)
  }
  return result
}

function accountNativeBalance(account: Account): number {
  if (account.holdings && account.holdings.length > 0) {
    return account.holdings.reduce((sum, holding) => sum + holding.institutionValue, 0)
  }
  return account.balance
}

function accountHasDataIssue(account: Account): boolean {
  const linkedInvestment = (account.type === 'investment' || account.type === 'retirement') &&
    (account.plaidAccessToken || account.ibkrAccountId)
  return Boolean(linkedInvestment && (account.holdings?.length ?? 0) === 0 && (account.taxLots?.length ?? 0) === 0)
}

function NativeCurrencyBadge({ currency }: { currency: string }) {
  const cur = currency.toUpperCase()
  return (
    <span className={`${CUR_BADGE} ${cur === 'EUR' ? EUR_BADGE_CLS : cur === 'USD' ? USD_BADGE_CLS : 'bg-gray-200 text-gray-700'}`}>
      {cur === 'EUR' ? '€' : cur === 'USD' ? '$' : cur}
    </span>
  )
}

function CashBalanceTooltip({ point, accounts, fxRate }: { point: CashPoint; accounts: Account[]; fxRate: number }) {
  const accountById = new Map(accounts.map(account => [account.id, account]))
  const rows = (['EUR', 'USD'] as const).map(currency => {
    const balances = point.balances.filter(account => account.currency === currency)
    const symbol = currency === 'EUR' ? '€' : '$'
    const toNative = (value: number) => currency === 'EUR' ? value : value * fxRate
    return {
      currency,
      symbol,
      label: currency === 'EUR' ? 'Euro balance' : 'USD balance',
      total: balances.reduce((sum, account) => sum + toNative(account.balanceEUR), 0),
      balances,
      toNative,
    }
  })
  return (
    <div className="rounded-lg border border-gray-700 bg-gray-900 px-3 py-2.5 text-[11px] text-white shadow-xl w-[320px]">
      <div className="font-semibold mb-1.5 pb-1 border-b border-gray-700 text-[11.5px]">{point.label}</div>
      {rows.map(row => (
        <div key={row.currency} className="mb-2 last:mb-0">
          <div className="flex min-h-5 items-center justify-between">
            <span className="inline-flex items-center gap-1.5">
              <span className={`${CUR_BADGE} ${row.currency === 'EUR' ? EUR_BADGE_CLS : USD_BADGE_CLS}`}>{row.currency === 'EUR' ? '€' : '$'}</span>
              <span className="text-[10px] font-medium text-gray-300">{row.label}</span>
            </span>
            <span className={`tabular-nums text-[10px] font-medium ${row.total >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              {fmtNative(Math.round(row.total), row.symbol)}
            </span>
          </div>
          {row.balances.map(balance => {
            const account = accountById.get(balance.id)
            const native = row.toNative(balance.balanceEUR)
            return (
              <div key={balance.id} className="flex min-h-5 items-center justify-between gap-2 pl-3">
                <span className="text-gray-400 text-[10px] leading-5 flex-1 min-w-0 inline-flex items-center gap-1.5">
                  {account && <AccountLogo account={account} size="xs" />}
                  <span className="truncate">{balance.name}</span>
                </span>
                <span className={`tabular-nums text-[10px] leading-5 ${native >= 0 ? 'text-gray-300' : 'text-red-400'}`}>
                  {fmtNative(Math.round(native), row.symbol)}
                </span>
              </div>
            )
          })}
          {row.balances.length === 0 && <div className="pl-3 text-[10px] text-gray-500">No {row.currency} cash accounts</div>}
        </div>
      ))}
    </div>
  )
}

function NetWorthBar({ accounts, currency, fxRate, liquidNetWorth, netWorth }: {
  accounts: Account[]
  currency: Currency
  fxRate: number
  liquidNetWorth: number
  netWorth: number
}) {
  const [hoveredSegment, setHoveredSegment] = useState<{
    type: AccountType
    label: string
    value: number
    color: string
    centerPct: number
  } | null>(null)
  const segments = ([
    ['cash', 'Cash'],
    ['investment', 'Investments'],
    ['retirement', 'Retirement'],
    ['real_estate', 'Real estate'],
  ] as Array<[AccountType, string]>).map(([type, label]) => ({
    type,
    label,
    value: accounts
      .filter(account => account.type === type)
      .reduce((sum, account) => sum + Math.max(0, accountBaseValue(account, currency, fxRate)), 0),
    color: ACCOUNT_TYPE_COLORS[type],
  })).filter(segment => segment.value > 0)
  const totalPositive = segments.reduce((sum, segment) => sum + segment.value, 0)
  let segmentOffsetPct = 0
  const positionedSegments = segments.map(segment => {
    const widthPct = totalPositive > 0 ? segment.value / totalPositive * 100 : 0
    const positioned = { ...segment, widthPct, centerPct: segmentOffsetPct + widthPct / 2 }
    segmentOffsetPct += widthPct
    return positioned
  })
  const liquidVisualValue = segments
    .filter(segment => segment.type === 'cash' || segment.type === 'investment')
    .reduce((sum, segment) => sum + segment.value, 0)
  const liquidPct = totalPositive > 0 ? Math.min(100, Math.max(0, liquidVisualValue / totalPositive * 100)) : 0

  return (
    <Card className="min-h-[190px]">
      <SectionTitle to="/investments" title="Net worth" tooltip="Included account value split by account type. The marker shows the liquid boundary." />
      <div className="text-[26px] font-semibold tracking-tight tabular-nums">{formatCurrency(netWorth, currency)}</div>
      <div className="mt-5">
        <div className="mb-1 flex items-center gap-2 text-[11px] text-gray-500 dark:text-gray-400">
          <span className="font-medium text-gray-700 dark:text-gray-200">Liquid NW</span>
          <span className="tabular-nums">{formatCurrency(liquidNetWorth, currency)}</span>
          <span>({liquidPct.toFixed(0)}%)</span>
        </div>
        <div className="relative pt-3">
          <div className="absolute top-0 h-3 border-l border-r border-t border-gray-500 dark:border-gray-300 rounded-t-sm" style={{ left: 0, width: `${liquidPct}%` }} />
          {hoveredSegment && (
            <div
              className="pointer-events-none absolute top-[-26px] z-30 -translate-x-1/2 rounded-lg bg-gray-900 px-2.5 py-1.5 text-[10.5px] text-white shadow-xl whitespace-nowrap"
              style={{ left: `${Math.min(88, Math.max(12, hoveredSegment.centerPct))}%` }}
            >
              {hoveredSegment.label}: {formatCurrency(hoveredSegment.value, currency)}
            </div>
          )}
          <div className="flex h-6 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
            {positionedSegments.map(segment => (
              <div
                key={segment.type}
                onMouseEnter={() => setHoveredSegment(segment)}
                onMouseLeave={() => setHoveredSegment(null)}
                style={{ width: `${segment.widthPct}%`, backgroundColor: segment.color }}
              />
            ))}
          </div>
        </div>
        <div className="mt-2 flex items-center gap-3 text-[10.5px] text-gray-400">
          {segments.map(segment => (
            <span key={segment.type} className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: segment.color }} />
              {segment.label}
            </span>
          ))}
        </div>
      </div>
    </Card>
  )
}

function PortfolioCard({
  value, points, currency,
  accounts, baseCurrency, fxRate, tiingoApiKey, lmProxyUrl,
  onTodayReturn,
}: {
  value: number
  points: Array<{ date: string; value: number }>
  currency: Currency
  accounts: Account[]
  baseCurrency: Currency
  fxRate: number
  tiingoApiKey: string | null
  lmProxyUrl: string | null
  onTodayReturn?: (value: { amount: number | null; pct: number | null }) => void
}) {
  const [range, setRange] = usePersistedState<SparkRange>('overview.portfolioRange', '1M')
  const [intradayPoints, setIntradayPoints] = useState<Array<{ date: string; value: number }>>([])
  const [intradayRefreshNonce, setIntradayRefreshNonce] = useState(0)
  const investableHoldings = useMemo(() => {
    const map = new Map<string, number>()
    for (const account of accounts) {
      if (account.type !== 'investment' && account.type !== 'retirement') continue
      for (const holding of account.holdings ?? []) {
        if (!holding.ticker || /^CUR:|^T-Bill/.test(holding.ticker) || holding.securityType === 'cash') continue
        const value = convertToBase(holding.institutionValue, holding.currency, baseCurrency, fxRate)
        map.set(holding.ticker.toUpperCase(), (map.get(holding.ticker.toUpperCase()) ?? 0) + value)
      }
    }
    return [...map.entries()].map(([ticker, value]) => ({ ticker, value }))
  }, [accounts, baseCurrency, fxRate])

  useEffect(() => {
    if (range !== '1D' || !tiingoApiKey || investableHoldings.length === 0) {
      setIntradayPoints([])
      return
    }
    let cancelled = false
    const tickers = [...new Set(investableHoldings.map(holding => holding.ticker)), 'SPY']
    Promise.allSettled(tickers.map(ticker => fetchIntradayPrices(tiingoApiKey, ticker, lmProxyUrl)))
      .then(results => {
        if (cancelled) return
        const intradayMap = new Map<string, IntradayPricePoint[]>()
        results.forEach((result, index) => {
          if (result.status === 'fulfilled' && result.value.length > 0) intradayMap.set(tickers[index], result.value)
        })
        const spyData = intradayMap.get('SPY') ?? []
        if (spyData.length < 2) return
        const latestDate = spyData[spyData.length - 1].date.slice(0, 10)
        const todaySpy = spyData.filter(point => point.date.startsWith(latestDate))
        if (todaySpy.length < 2) return
        const baseByTicker = new Map<string, number>()
        const closeByTicker = new Map<string, Map<string, number>>()
        for (const [ticker, prices] of intradayMap) {
          const todayPrices = prices.filter(point => point.date.startsWith(latestDate))
          if (todayPrices.length === 0) continue
          baseByTicker.set(ticker, todayPrices[0].close)
          closeByTicker.set(ticker, new Map(todayPrices.map(point => [point.date, point.close])))
        }
        const next = todaySpy.map(spyPoint => {
          let totalValue = 0
          let weightedReturn = 0
          for (const holding of investableHoldings) {
            const close = closeByTicker.get(holding.ticker)?.get(spyPoint.date)
            const base = baseByTicker.get(holding.ticker)
            if (close == null || base == null || base <= 0) continue
            weightedReturn += (close / base - 1) * holding.value
            totalValue += holding.value
          }
          const portfolioReturn = totalValue > 0 ? weightedReturn / totalValue : 0
          return { date: spyPoint.date, value: Math.round(value * (1 + portfolioReturn)) }
        })
        if (!cancelled) setIntradayPoints(next)
      })
      .catch(() => { if (!cancelled) setIntradayPoints([]) })
    return () => { cancelled = true }
  }, [range, tiingoApiKey, lmProxyUrl, investableHoldings, value, intradayRefreshNonce])

  useEffect(() => {
    if (range !== '1D' || !tiingoApiKey || investableHoldings.length === 0) return
    const refresh = () => {
      if (document.visibilityState === 'visible' && isUsMarketHours()) setIntradayRefreshNonce(n => n + 1)
    }
    const id = setInterval(refresh, 60_000)
    document.addEventListener('visibilitychange', refresh)
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', refresh) }
  }, [range, tiingoApiKey, investableHoldings.length])

  const displayPoints = range === '1D' && intradayPoints.length >= 2
    ? padToMarketClose(intradayPoints)
    : slicePoints(points, range)
  const first = displayPoints[0]?.value
  const last = lastNonNull(displayPoints)
  const rangeAmount = first != null && last != null ? last - first : null
  const chartColor = rangeAmount == null ? '#378ADD' : rangeAmount >= 0 ? '#16a34a' : '#dc2626'
  useEffect(() => {
    if (range !== '1D' || !onTodayReturn) return
    const pct = first != null && first > 0 && last != null ? (last - first) / first : null
    onTodayReturn({ amount: rangeAmount, pct })
  }, [range, first, last, rangeAmount, onTodayReturn])
  return (
    <Card className="min-h-[190px]">
      <SectionTitle
        to="/investments"
        title="Portfolio"
        tooltip="Portfolio balance and selected-range movement from the Investments snapshot."
        right={<RangeTabs ranges={['1D', '1W', '1M', 'YTD', '1Y']} value={range} onChange={setRange} />}
      />
      <div className="text-[24px] font-semibold tracking-tight tabular-nums">{formatCurrency(value, currency)}</div>
      <div className="mt-2">
        <MiniSparkline points={displayPoints} color={chartColor} height={96} formatValue={value => formatCurrency(value, currency)} />
      </div>
    </Card>
  )
}

function FxCard({ liveRate }: { liveRate: number }) {
  const tiingoApiKey = useAppStore(s => s.tiingoApiKey)
  const lmProxyUrl = useAppStore(s => s.lmProxyUrl)
  const [range, setRange] = usePersistedState<FxRange>('overview.fxRange', '1M')
  const [intradayPoints, setIntradayPoints] = useState<Array<{ date: string; value: number }>>([])
  const rows = readEcbCache()?.rows ?? []
  const points = (rows.length > 0 ? rows : [{ date: new Date().toISOString().slice(0, 10), value: liveRate }])
  useEffect(() => {
    if (range !== '1D' || !tiingoApiKey) {
      setIntradayPoints([])
      return
    }
    let cancelled = false
    fetchIntradayFxRates(tiingoApiKey, 'eurusd', lmProxyUrl)
      .then(points => {
        if (cancelled || points.length === 0) return
        const latestDate = points[points.length - 1].date.slice(0, 10)
        const isDST = (() => { const month = new Date(`${latestDate}T12:00:00Z`).getUTCMonth(); return month >= 2 && month <= 9 })()
        const openHourUTC = isDST ? 14 : 15
        const sessionPoints = points
          .filter(point => point.date.startsWith(latestDate) && new Date(point.date).getUTCHours() >= openHourUTC)
          .map(point => ({ date: point.date, value: point.close }))
        if (!cancelled) setIntradayPoints(sessionPoints.length >= 2 ? sessionPoints : [])
      })
      .catch(() => { if (!cancelled) setIntradayPoints([]) })
    return () => { cancelled = true }
  }, [range, tiingoApiKey, lmProxyUrl])
  const displayPoints = range === '1D' && intradayPoints.length >= 2
    ? padToMarketClose(intradayPoints)
    : slicePoints(points, range)
  const first = displayPoints[0]?.value
  const last = lastNonNull(displayPoints) ?? liveRate
  const pct = first != null && first > 0 ? (last - first) / first : null
  const color = pct == null ? '#9ca3af' : pct <= 0 ? '#16a34a' : '#dc2626'
  return (
    <Card className="min-h-[190px]">
      <SectionTitle
        to="/currencies"
        title="EUR / USD"
        tooltip="ECB EUR/USD rate. Green means USD strengthened over the selected range."
        right={<RangeTabs ranges={['1D', '1W', '1M', '1Y']} value={range} onChange={setRange} />}
      />
      <div className="flex items-baseline gap-2">
        <div className="text-[24px] font-semibold tracking-tight tabular-nums">{last.toFixed(4)}</div>
        <div className={`text-[12px] font-medium tabular-nums ${pct == null ? 'text-gray-400' : pct <= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400'}`}>{signedPct(pct)}</div>
      </div>
      <div className="mt-2">
        <MiniSparkline points={displayPoints} color={color} height={96} formatValue={value => value.toFixed(4)} />
      </div>
    </Card>
  )
}

function ReturnsBars({ rows, currency }: { rows: ReturnRow[]; currency: Currency }) {
  return (
    <div className="space-y-2.5">
      {rows.map((row, index) => {
        const isToday = index === 0
        return (
          <div key={row.label} className={`grid grid-cols-[52px_1fr_1fr] items-center gap-2 rounded-md ${isToday ? 'bg-gray-50 dark:bg-gray-800 px-2 py-4 text-[20px]' : 'text-[12px]'}`}>
            <span className={`${isToday ? 'font-medium text-gray-700 dark:text-gray-200' : 'text-gray-500 dark:text-gray-400'}`}>{row.label}</span>
            <span className={`tabular-nums text-right font-medium ${trendClass(row.pct)}`}>{signedPct(row.pct, row.label === 'Today' ? 2 : 1)}</span>
            <span className={`tabular-nums text-right ${isToday ? 'font-medium' : ''} ${trendClass(row.amount)}`}>{signedCurrency(row.amount, currency)}</span>
          </div>
        )
      })}
    </div>
  )
}

function StatusBadge({ children, variant }: { children: React.ReactNode; variant: 'emerald' | 'amber' }) {
  return (
    <span className={`inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded ${
      variant === 'emerald'
        ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300'
        : 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300'
    }`}>
      {children}
    </span>
  )
}

function HorizontalCashFlowMini({ projection, accounts, fxRate }: {
  projection: ReturnType<typeof buildCashProjection>
  accounts: Account[]
  fxRate: number
}) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)
  const currentProjection = projection[0]
  const currentPoint: CashPoint | null = currentProjection ? {
    label: todayLabel(),
    date: new Date().toISOString().slice(0, 10),
    month: currentProjection,
    balances: currentProjection.openingAccountBalances,
    eur: currentProjection.openingAccountBalances
      .filter(account => account.currency === 'EUR')
      .reduce((sum, account) => sum + account.balanceEUR, 0),
    usd: currentProjection.openingAccountBalances
      .filter(account => account.currency === 'USD')
      .reduce((sum, account) => sum + account.balanceEUR * fxRate, 0),
  } : null
  const monthEndPoints: CashPoint[] = projection.map(month => ({
    label: formatMonthEnd(month.year, month.month),
    date: `${month.year}-${String(month.month).padStart(2, '0')}`,
    month,
    balances: month.accountBalances,
    eur: month.accountBalances
      .filter(account => account.currency === 'EUR')
      .reduce((sum, account) => sum + account.balanceEUR, 0),
    usd: month.accountBalances
      .filter(account => account.currency === 'USD')
      .reduce((sum, account) => sum + account.balanceEUR * fxRate, 0),
  }))
  const points = currentPoint ? [currentPoint, ...monthEndPoints] : monthEndPoints
  const rows = (['EUR', 'USD'] as const).map(currency => ({
    currency,
    color: currency === 'EUR' ? '#0284c7' : '#059669',
    symbol: currency === 'EUR' ? '€' : '$',
    values: points.map(point => currency === 'EUR' ? point.eur : point.usd),
  }))
  const values = rows.flatMap(row => row.values)
  const min = Math.min(0, ...values)
  const max = Math.max(1, ...values)
  const span = Math.max(max - min, 1)
  const width = 520
  const height = 156
  const left = 36
  const right = 12
  const plotLeft = left + 16
  const plotRight = width - right
  const plotTop = 14
  const plotBottom = 116
  const axisY = 132
  const xFor = (index: number) => plotLeft + index * ((plotRight - plotLeft) / Math.max(1, points.length - 1))
  const yScale = (value: number) => plotBottom - ((value - min) / span) * (plotBottom - plotTop)
  const yFor = (value: number, offset: number) => yScale(value) + offset
  const zeroY = yScale(0)
  const hoverPoint = hoverIndex != null ? points[hoverIndex] : null
  const hoverX = hoverIndex != null ? xFor(hoverIndex) : null
  const tooltipLeftPct = hoverX == null ? 50 : Math.min(86, Math.max(14, hoverX / width * 100))
  const tooltipOnRight = hoverIndex == null || hoverIndex < points.length / 2
  const yTicks = [...new Set([max, 0, min].map(value => Math.round(value)))]

  return (
    <div className="relative w-full">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-[190px] w-full"
        preserveAspectRatio="none"
        aria-hidden="true"
        onMouseMove={event => {
          const rect = event.currentTarget.getBoundingClientRect()
          const svgX = ((event.clientX - rect.left) / rect.width) * width
          const nearest = points.reduce((best, _point, index) => Math.abs(xFor(index) - svgX) < Math.abs(xFor(best) - svgX) ? index : best, 0)
          setHoverIndex(nearest)
        }}
        onMouseLeave={() => setHoverIndex(null)}
      >
        {yTicks.map(value => {
          const y = yScale(value)
          return (
            <g key={value}>
              <text x={left - 7} y={y + 3} textAnchor="end" fontSize="8.5" fill="#9ca3af">{formatK(value)}</text>
            </g>
          )
        })}
        {min < 0 && (
          <>
            <rect x={left} y={zeroY} width={plotRight - left} height={plotBottom - zeroY} fill="#ef4444" opacity="0.16" />
            <line x1={left} y1={zeroY} x2={plotRight} y2={zeroY} stroke="#b91c1c" strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
          </>
        )}
        <line x1={left} y1={plotTop} x2={left} y2={axisY} stroke="#e5e7eb" strokeWidth="0.9" vectorEffect="non-scaling-stroke" />
        <line x1={left} y1={axisY} x2={plotRight} y2={axisY} stroke="#e5e7eb" strokeWidth="0.9" vectorEffect="non-scaling-stroke" />
        {points.map((point, index) => {
          const x = xFor(index)
          return (
            <g key={`${point.label}-${index}`}>
              <line x1={x} y1={axisY} x2={x} y2={axisY + 3} stroke="#d1d5db" strokeWidth="0.7" vectorEffect="non-scaling-stroke" />
              <text x={x} y={height - 6} textAnchor={index === 0 ? 'start' : index === points.length - 1 ? 'end' : 'middle'} fontSize="8.5" fill="#9ca3af">{point.label}</text>
            </g>
          )
        })}
        {rows.map((row, rowIndex) => {
          const offset = rowIndex === 0 ? -6 : 6
          const polyline = row.values.map((value, index) => `${xFor(index).toFixed(1)},${yFor(value, offset).toFixed(1)}`).join(' ')
          return (
            <g key={row.currency}>
              <polyline points={polyline} fill="none" stroke={row.color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
              {row.values.map((value, index) => {
                const x = xFor(index)
                const y = yFor(value, offset)
                return (
                  <g key={`${row.currency}-${index}`}>
                    <circle cx={x} cy={y} r="3" fill={row.color} vectorEffect="non-scaling-stroke" />
                    <text x={x} y={y + (rowIndex === 0 ? -8 : 15)} textAnchor="middle" fontSize="8.5" fontWeight="600" fill={row.color}>
                      {fmtNative(Math.round(value), row.symbol)}
                    </text>
                  </g>
                )
              })}
            </g>
          )
        })}
        {hoverIndex != null && (
          <line x1={xFor(hoverIndex)} y1={plotTop} x2={xFor(hoverIndex)} y2={axisY} stroke="#9ca3af" strokeWidth="0.8" strokeDasharray="2 2" vectorEffect="non-scaling-stroke" />
        )}
      </svg>
      {hoverPoint && (
        <div
          className="pointer-events-none absolute top-3 z-30"
          style={{
            left: `${tooltipLeftPct}%`,
            transform: tooltipOnRight ? 'translateX(12px)' : 'translateX(calc(-100% - 12px))',
          }}
        >
          <CashBalanceTooltip point={hoverPoint} accounts={accounts} fxRate={fxRate} />
        </div>
      )}
    </div>
  )
}

function CashTopUpWarnings({ fullProjection, fxRate }: {
  fullProjection: ReturnType<typeof buildCashProjection>
  fxRate: number
}) {
  const eurNegative = findFirstNegative(fullProjection, 'EUR', fxRate)
  const usdNegative = findFirstNegative(fullProjection, 'USD', fxRate)
  const endLabel = fullProjection[fullProjection.length - 1]?.label ?? ''
  const rows = (['EUR', 'USD'] as const).map(currency => ({
    currency,
    symbol: currency === 'EUR' ? '€' : '$',
    negative: currency === 'EUR' ? eurNegative : usdNegative,
  }))

  const hasWarning = rows.some(row => row.negative)

  return (
    <div className={`mb-2 rounded-lg border px-3 py-2 ${
      hasWarning
        ? 'border-amber-200 bg-amber-50/60 dark:border-amber-900/50 dark:bg-amber-950/15'
        : 'border-emerald-200 bg-emerald-50/50 dark:border-emerald-900/50 dark:bg-emerald-950/10'
    }`}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        {rows.map(row => (
          <div key={row.currency} className="flex min-w-0 items-center gap-1.5 text-[11px]">
            <NativeCurrencyBadge currency={row.currency} />
            {row.negative ? (
              <span className="text-amber-700 dark:text-amber-300">
                Negative in <StatusBadge variant="amber">{row.negative.label}</StatusBadge>, top up{' '}
                <StatusBadge variant="amber">{fmtNative(row.negative.shortage, row.symbol)}</StatusBadge>
              </span>
            ) : (
              <span className="text-emerald-700 dark:text-emerald-300">
                Through <StatusBadge variant="emerald">{endLabel}</StatusBadge>
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function AccountsGrouped({ accounts, fxRate, baseCurrency }: {
  accounts: Account[]
  fxRate: number
  baseCurrency: Currency
}) {
  const makeGroup = (title: string, types: AccountType[]) => ({
    title,
    accounts: accounts
      .filter(account => types.includes(account.type))
      .sort((a, b) => Math.abs(accountBaseValue(b, baseCurrency, fxRate)) - Math.abs(accountBaseValue(a, baseCurrency, fxRate))),
  })
  const columns = [
    [makeGroup('Investments & retirement', ['investment', 'retirement']), makeGroup('Others', ['real_estate', 'loan', 'other'])],
    [makeGroup('Cash', ['cash'])],
    [makeGroup('Credit', ['credit'])],
  ].map(column => column.filter(group => group.accounts.length > 0))

  const AccountRow = ({ account }: { account: Account }) => {
    const issue = accountHasDataIssue(account)
    return (
      <div className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 ${
        issue ? 'border-amber-200 dark:border-amber-900/50 bg-amber-50/50 dark:bg-amber-950/10' : 'border-gray-100 dark:border-gray-800'
      }`}>
        <AccountLogo account={account} size="xs" />
        <span className="min-w-0 flex-1 truncate text-[12px] text-gray-700 dark:text-gray-200">{account.name}</span>
        {issue && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-medium text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">Issue</span>}
        <span className={`tabular-nums text-[14px] leading-none font-semibold ${accountNativeBalance(account) < 0 ? 'text-red-500' : 'text-gray-800 dark:text-gray-100'}`}>
          {formatCompact(accountNativeBalance(account), account.currency)}
        </span>
        <NativeCurrencyBadge currency={account.currency} />
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      {columns.map((column, index) => (
        <div key={index} className="space-y-4">
          {column.map(group => (
            <div key={group.title}>
              <div className="mb-2 text-[10.5px] font-semibold uppercase tracking-wide text-gray-400">{group.title}</div>
              <div className="space-y-2">
                {group.accounts.map(account => <AccountRow key={account.id} account={account} />)}
              </div>
            </div>
          ))}
          {column.length === 0 && <div className="hidden lg:block" />}
        </div>
      ))}
      {columns.every(column => column.length === 0) && (
        <div className="lg:col-span-3 py-8 text-center text-[12px] text-gray-400">No accounts configured yet.</div>
      )}
    </div>
  )
}

export default function Overview() {
  const {
    accounts, expenses, medicalCoverages, medicalExpenses, pensions, profile,
    realEstateEvents, windfalls, taxConfig, transfers, dividendHistory,
    liveEurUsdRate, portfolioSnapshot,
    tiingoApiKey, lmProxyUrl,
  } = useAppStore()
  const {
    result: simulationResult,
    simulationRunning,
    simulationPending,
    simulationError,
    freshness: lifetimeFreshness,
    runSimulation,
  } = useHistoricalSimulation()
  const [overviewTodayReturn, setOverviewTodayReturn] = useState<{ amount: number | null; pct: number | null } | null>(null)
  const [selectedDeterministicSeries] = usePersistedState<string[]>(
    'dinner-money:deterministic-projection-series',
    ['liquidNW', 'realEstateNW'],
  )

  const planningAccounts = useMemo(() => currentPlanningAccounts({
    accounts,
    expenses,
    medicalCoverages: medicalCoverages ?? [],
    medicalExpenses: medicalExpenses ?? [],
    pensions,
    realEstateEvents,
    transfers: transfers ?? [],
    windfalls,
  }), [accounts, expenses, medicalCoverages, medicalExpenses, pensions, realEstateEvents, transfers, windfalls])

  const currency = profile.baseCurrency
  const netWorth = totalAccountValue(planningAccounts, currency, liveEurUsdRate)
  const liquidNetWorth = liquidAccountValue(planningAccounts, currency, liveEurUsdRate)
  const invested = investmentAccountValue(planningAccounts, currency, liveEurUsdRate)
  const todayAmt = portfolioSnapshot?.todayAmt ?? null
  const navHistory = aggregateNavHistory(planningAccounts)
  const portfolioPoints = portfolioSnapshot?.points?.length ? portfolioSnapshot.points : navHistory ?? []
  const currentInvestmentValue = portfolioSnapshot?.invested ?? invested

  const annualDivEUR = useMemo(
    () => computeAnnualDividendsEUR(planningAccounts, dividendHistory, liveEurUsdRate),
    [planningAccounts, dividendHistory, liveEurUsdRate],
  )
  const projection3 = useMemo(() => buildCashProjection({
    accounts,
    expenses,
    medicalCoverages: medicalCoverages ?? [],
    medicalExpenses: medicalExpenses ?? [],
    pensions,
    realEstateEvents,
    windfalls,
    transfers: transfers ?? [],
    taxConfig,
    profile,
    months: 3,
    annualDivEUR,
  }), [accounts, expenses, medicalCoverages, medicalExpenses, pensions, realEstateEvents, windfalls, transfers, taxConfig, profile, annualDivEUR])
  const projection24 = useMemo(() => buildCashProjection({
    accounts,
    expenses,
    medicalCoverages: medicalCoverages ?? [],
    medicalExpenses: medicalExpenses ?? [],
    pensions,
    realEstateEvents,
    windfalls,
    transfers: transfers ?? [],
    taxConfig,
    profile,
    months: 24,
    annualDivEUR,
  }), [accounts, expenses, medicalCoverages, medicalExpenses, pensions, realEstateEvents, windfalls, transfers, taxConfig, profile, annualDivEUR])

  const returns: ReturnRow[] = [
    { label: 'Today', amount: overviewTodayReturn?.amount ?? todayAmt, pct: overviewTodayReturn?.pct ?? portfolioSnapshot?.todayPct ?? null },
    { label: 'Week', ...navReturn(portfolioPoints, dateDaysAgo(8), currentInvestmentValue) },
    { label: 'Month', ...navReturn(navHistory, monthStart(), currentInvestmentValue) },
    { label: 'YTD', ...navReturn(navHistory, ytdStart(), currentInvestmentValue) },
  ]

  const finalIndex = simulationResult ? simulationResult.years.length - 1 : -1
  const finalYear = simulationResult && finalIndex >= 0 ? simulationResult.years[finalIndex] : null
  const finalLiquid = simulationResult && finalIndex >= 0
    ? convertToBase(
      Math.max(0, (simulationResult.medianNetWorth[finalIndex] ?? 0) - (simulationResult.realEstateNetWorth[finalIndex] ?? 0)),
      'EUR',
      currency,
      liveEurUsdRate,
    )
    : null
  const deterministicRows = simulationResult?.years.map((year, index) => {
    const realEstateNW = Math.round(convertToBase(simulationResult.realEstateNetWorth[index] ?? 0, 'EUR', currency, liveEurUsdRate))
    const median = Math.max(0, Math.round(convertToBase(simulationResult.medianNetWorth[index] ?? 0, 'EUR', currency, liveEurUsdRate)))
    const liquidNW = Math.max(0, median - realEstateNW)
    return {
      label: String(year),
      median,
      liquidNW,
      realEstateNW,
      income: null,
      expense: null,
      tax: null,
      netCashFlow: null,
      portfolioGrowth: null,
      withdrawal: null,
    }
  }) ?? []
  const deterministicTicks = simulationResult
    ? [simulationResult.years[0], ...simulationResult.years.filter(year => year % 5 === 0 && year !== simulationResult.years[0])].map(String)
    : []
  const safeMonthlySpend = simulationResult
    ? convertToBase(simulationResult.safeMonthlySpend, 'EUR', currency, liveEurUsdRate)
    : null
  const successClass = simulationResult && simulationResult.successRate >= 85
    ? 'text-green-600 dark:text-green-400'
    : 'text-amber-500 dark:text-amber-400'
  const spendMarginClass = safeMonthlySpend == null
    ? 'text-gray-800 dark:text-gray-100'
    : safeMonthlySpend >= 0
      ? 'text-green-600 dark:text-green-400'
      : 'text-red-500 dark:text-red-400'
  const lifetimeRefreshing = simulationRunning || simulationPending
  const lifetimeStaleMessage = lifetimeFreshness === 'input-stale'
    ? 'Inputs changed. Refreshing projection…'
    : lifetimeFreshness === 'ttl-stale'
      ? 'Projection is over 24h old. Refreshing…'
      : null

  return (
    <div>
      <PageHeader title="Overview" />

      <div className="p-4 space-y-4">
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
          <NetWorthBar
            accounts={planningAccounts}
            currency={currency}
            fxRate={liveEurUsdRate}
            liquidNetWorth={liquidNetWorth}
            netWorth={netWorth}
          />
          <PortfolioCard
            value={currentInvestmentValue}
            points={portfolioPoints}
            currency={currency}
            accounts={planningAccounts}
            baseCurrency={currency}
            fxRate={liveEurUsdRate}
            tiingoApiKey={tiingoApiKey}
            lmProxyUrl={lmProxyUrl}
            onTodayReturn={setOverviewTodayReturn}
          />
          <Card className="min-h-[190px]">
            <SectionTitle to="/investments" title="Returns" tooltip="Same return periods as the Investments snapshot." />
            <ReturnsBars rows={returns} currency={currency} />
          </Card>
          <FxCard liveRate={liveEurUsdRate} />
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <Card className="min-h-[250px] flex flex-col">
            <SectionTitle
              to="/lifetime"
              title="Lifetime projection"
              tooltip="Median liquid net worth path and historical stress result from the Lifetime page."
              right={simulationResult && (
                <button
                  type="button"
                  onClick={() => void runSimulation()}
                  disabled={lifetimeRefreshing}
                  aria-label="Refresh Lifetime projection"
                  className="h-6 w-6 rounded-[5px] flex items-center justify-center text-gray-400 hover:text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:hover:text-gray-200 dark:hover:bg-gray-800"
                >
                  <RefreshCw size={13} className={lifetimeRefreshing ? 'animate-spin' : ''} />
                </button>
              )}
            />
            {simulationResult ? (
              <div className="flex flex-1 flex-col min-h-0">
                {lifetimeStaleMessage && (
                  <div className="mb-2 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/25 dark:text-amber-300">
                    {lifetimeStaleMessage}
                  </div>
                )}
                {simulationError && (
                  <div className="mb-2 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/25 dark:text-amber-300">
                    Refresh failed: {simulationError}
                  </div>
                )}
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <div className="rounded-md border border-gray-100 dark:border-gray-800 px-2.5 py-1.5">
                    <div className="text-[9.5px] font-semibold uppercase tracking-wide text-gray-400">Success probability</div>
                    <div className={`text-[13px] font-semibold tabular-nums ${successClass}`}>{simulationResult.successRate.toFixed(0)}%</div>
                  </div>
                  <div className="rounded-md border border-gray-100 dark:border-gray-800 px-2.5 py-1.5">
                    <div className="text-[9.5px] font-semibold uppercase tracking-wide text-gray-400">Liquid NW in {finalYear ?? 'last year'}</div>
                    <div className="text-[13px] font-semibold tabular-nums text-gray-800 dark:text-gray-100">{finalLiquid != null ? formatCompact(finalLiquid, currency) : '-'}</div>
                  </div>
                  <div className="rounded-md border border-gray-100 dark:border-gray-800 px-2.5 py-1.5">
                    <div className="text-[9.5px] font-semibold uppercase tracking-wide text-gray-400">Monthly spend margin</div>
                    <div className={`text-[13px] font-semibold tabular-nums ${spendMarginClass}`}>{safeMonthlySpend != null ? formatCurrency(safeMonthlySpend, currency) : '-'}</div>
                  </div>
                </div>
                <div className="min-h-[150px] flex-1">
                  <DeterministicProjectionChart
                    data={deterministicRows}
                    ticks={deterministicTicks}
                    selectedSeries={selectedDeterministicSeries}
                    currency={currency}
                    height="100%"
                  />
                </div>
              </div>
            ) : (
              <div className="h-[160px] flex items-center justify-center text-[12px] text-gray-400">
                {lifetimeRefreshing ? 'Running the Lifetime projection…' : 'Lifetime projection will run automatically.'}
              </div>
            )}
          </Card>
          <Card className="min-h-[250px]">
            <SectionTitle to="/cash" title="Cash flow · next 3 months" tooltip="Horizontal balance projection for the current month and next two months." />
            <CashTopUpWarnings fullProjection={projection24} fxRate={liveEurUsdRate} />
            <HorizontalCashFlowMini projection={projection3} accounts={accounts} fxRate={liveEurUsdRate} />
          </Card>
        </div>

        <Card>
          <SectionTitle to="/config/accounts" title="Accounts" tooltip="Included accounts grouped by type, with native balances and currency badges." />
          <AccountsGrouped accounts={planningAccounts} fxRate={liveEurUsdRate} baseCurrency={currency} />
        </Card>
      </div>
    </div>
  )
}
