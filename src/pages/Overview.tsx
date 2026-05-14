import { useEffect, useMemo, useRef, useState } from 'react'
import { Settings2, CheckCircle2 } from 'lucide-react'
import { useAppStore } from '../store/useAppStore'
import { MetricCard } from '../components/ui/MetricCard'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { PageHeader } from '../components/ui/PageHeader'
import { Banner } from '../components/ui/Banner'
import { InfoTooltip } from '../components/ui/InfoTooltip'
import { RecurringIcon, OneTimeIcon } from '../components/ui/FrequencyDisplay'
import { formatCompact, formatCurrency } from '../lib/format'
import { DEFAULT_EUR_USD_RATE, convertToBase } from '../lib/currency'
import { projectedAnnualDividendsEUR } from '../lib/dividends'
import { projectedAccountsBy } from '../lib/accountLifecycle'
import { estimateAnnualIncomeTaxes } from '../lib/tax'
import { fetchFredMonthlySeries } from '../lib/fred'
import { fetchMonthlyAdjustedReturns, TiingoRateLimitError } from '../lib/tiingo'
import {
  ComposedChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine,
  LineChart, Line, CartesianGrid
} from 'recharts'
import type { SimulationResult, Expense, PensionEstimate, Windfall, UserProfile, MedicalCoverage, MedicalExpense, Account, MonteCarloConfig, RealEstateEvent, HistoricalMarketData, Transfer, TaxConfig } from '../types'

// ─── Life event data ──────────────────────────────────────────────────────────

interface LifeEvent {
  year: number
  label: string
  color: string
  emoji: string
  amount?: number
  currency?: string
  frequency?: string
  endDate?: string | null
}

function useLifeEvents(): LifeEvent[] {
  const { realEstateEvents, windfalls, pensions, profile } = useAppStore()
  const events: LifeEvent[] = []
  const now = new Date().getFullYear()

  for (const re of realEstateEvents) {
    const y = parseInt(re.date.split('-')[0])
    const emoji = re.eventType === 'sell' ? '🏠' : re.eventType === 'buy' ? '🏡' : '🔑'
    const label = re.eventType === 'sell' ? 'Sell home' : re.eventType === 'buy' ? 'Buy home' : 'Rent'
    events.push({
      year: y, label, color: '#16a34a', emoji,
      amount: re.amount, currency: re.currency,
      frequency: re.isRecurring ? 'monthly' : 'one_time',
      endDate: re.endDate,
    })
  }
  for (const w of windfalls) {
    events.push({
      year: parseInt(w.date.split('-')[0]), label: w.name, color: '#854F0B', emoji: '★',
      amount: w.amount, currency: w.currency,
      frequency: w.frequency ?? 'one_time',
      endDate: w.endDate ?? null,
    })
  }
  for (const p of pensions) {
    const startYear = parseInt(p.startDate.split('-')[0])
    if (startYear > now) {
      const personLabel = p.person === 'self' ? 'You' : 'Spouse'
      events.push({
        year: startYear, label: `${p.label} (${personLabel})`, color: '#0F6E56',
        emoji: p.currency === 'EUR' ? '€' : '$',
        amount: p.amount, currency: p.currency,
        frequency: p.frequency,
        endDate: p.endDate,
      })
    }
  }
  events.push({ year: profile.birthYear + 73, label: 'RMDs start', color: '#7F77DD', emoji: 'R' })
  return events
}

// ─── Expense helpers ──────────────────────────────────────────────────────────

type ExpLike = { id: string; name: string; amount: number; frequency: string; currency: string; startDate: string; endDate: string | null; installments?: Array<{ date: string; amount: number }> }

function allExpensesOf(
  expenses: Expense[],
  medicalCoverages: MedicalCoverage[],
  medicalExpenses: MedicalExpense[],
): ExpLike[] {
  return [...expenses, ...(medicalCoverages ?? []), ...(medicalExpenses ?? [])]
}

function resultIndex(result: SimulationResult | null): number {
  return result ? Math.max(0, result.years.length - 1) : -1
}

const SIMULATION_CACHE_VERSION = 8
const SIMULATION_LATEST_CACHE_KEY = 'dinner-money:historical-simulation:latest'
const simulationMemoryCache = new Map<string, SimulationResult>()

interface SimulationProgress {
  phase: string
  completed: number
  total: number
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, val]) => `${JSON.stringify(key)}:${stableStringify(val)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

function simulationCacheKey(input: unknown): string {
  let hash = 2166136261
  const text = stableStringify({ version: SIMULATION_CACHE_VERSION, input })
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return `dinner-money:historical-simulation:${(hash >>> 0).toString(16)}`
}

function accountSignature(account: Account) {
  return {
    id: account.id,
    name: account.name,
    balance: account.balance,
    currency: account.currency,
    type: account.type,
    allocation: account.allocation,
    interestRate: account.interestRate ?? null,
    includedInPlanning: account.includedInPlanning !== false,
    fxSplitEUR: account.fxSplitEUR ?? null,
    holdings: (account.holdings ?? []).map(holding => ({
      ticker: holding.ticker,
      value: holding.institutionValue,
      currency: holding.currency,
      quantity: holding.quantity,
    })).sort((a, b) => `${a.ticker ?? ''}:${a.currency}`.localeCompare(`${b.ticker ?? ''}:${b.currency}`)),
  }
}

function simulationTickers(accounts: Account[]): string[] {
  const tickers = new Set<string>()
  for (const account of accounts) {
    for (const holding of account.holdings ?? []) {
      const ticker = holding.ticker?.toUpperCase()
      if (!ticker || ticker.startsWith('CUR:')) continue
      tickers.add(ticker)
    }
  }
  return [...tickers].slice(0, 20)
}

async function loadHistoricalMarketData(
  accounts: Account[],
  tiingoApiKey: string | null,
  fredApiKey: string | null,
  proxyUrl: string | null,
): Promise<HistoricalMarketData> {
  const monthly = new Map<string, HistoricalMarketData['monthly'][number]>()
  const dataSources: string[] = []
  const warnings: string[] = []

  const ensureMonth = (month: string) => {
    const existing = monthly.get(month)
    if (existing) return existing
    const point: HistoricalMarketData['monthly'][number] = { month }
    monthly.set(month, point)
    return point
  }

  const tickers = simulationTickers(accounts)
  if (tiingoApiKey && tickers.length > 0) {
    const settled: Array<PromiseSettledResult<Awaited<ReturnType<typeof fetchMonthlyAdjustedReturns>>>> = []
    for (let i = 0; i < tickers.length; i += 3) {
      const batch = tickers.slice(i, i + 3)
      settled.push(...await Promise.allSettled(batch.map(ticker => fetchMonthlyAdjustedReturns(tiingoApiKey, ticker, '1990-01-01', proxyUrl))))
    }
    let fetched = 0
    const failedTickers: string[] = []
    const rateLimitedTickers: string[] = []
    settled.forEach((result, index) => {
      const ticker = tickers[index]
      if (result.status === 'fulfilled') {
        fetched++
        for (const point of result.value) {
          const row = ensureMonth(point.month)
          row.etfReturns = { ...(row.etfReturns ?? {}), [ticker]: point.return }
        }
      } else {
        if (result.reason instanceof TiingoRateLimitError) rateLimitedTickers.push(ticker)
        else failedTickers.push(ticker)
      }
    })
    if (fetched > 0) dataSources.push(`Tiingo adjusted returns for ${fetched}/${tickers.length} holding tickers`)
    if (rateLimitedTickers.length > 0) {
      warnings.push(`Tiingo rate limit reached for ${rateLimitedTickers.length} ticker${rateLimitedTickers.length === 1 ? '' : 's'}; those tickers fall back to Shiller equity returns until the cache refreshes.`)
    }
    if (failedTickers.length > 0 && fetched > 0) {
      warnings.push(`Tiingo covered ${fetched}/${tickers.length} holding tickers; uncovered tickers fall back to Shiller equity returns.`)
    } else if (failedTickers.length > 0 || (rateLimitedTickers.length > 0 && fetched === 0)) {
      warnings.push('Tiingo holding returns could not be loaded; equity returns use Shiller S&P total-return proxy.')
    }
  } else if (!tiingoApiKey) {
    warnings.push('No Tiingo API key saved; equity returns use Shiller S&P total-return proxy.')
  } else {
    warnings.push('No Plaid holding tickers found; equity returns use Shiller S&P total-return proxy.')
  }

  if (fredApiKey) {
    const [dgs10, dexuseu, usCpi, frCpi] = await Promise.allSettled([
      fetchFredMonthlySeries(fredApiKey, 'DGS10', '1990-01-01', proxyUrl),
      fetchFredMonthlySeries(fredApiKey, 'EXUSEU', '1999-01-01', proxyUrl),
      fetchFredMonthlySeries(fredApiKey, 'CPIAUCSL', '1947-01-01', proxyUrl),
      fetchFredMonthlySeries(fredApiKey, 'FRACPALTT01IXOBSAM', '1990-01-01', proxyUrl),
    ])
    if (dgs10.status === 'fulfilled') {
      for (const point of dgs10.value) ensureMonth(point.month).treasuryYieldAnnual = point.value
      dataSources.push('FRED DGS10')
    } else {
      warnings.push('FRED DGS10 could not be loaded; Treasury yields use Shiller GS10.')
    }
    if (dexuseu.status === 'fulfilled') {
      for (const point of dexuseu.value) ensureMonth(point.month).usdPerEur = point.value
      dataSources.push('FRED EXUSEU')
    } else {
      warnings.push('FRED EXUSEU could not be loaded; FX uses fallback USD/EUR spot plus configured drift.')
    }
    if (usCpi.status === 'fulfilled') {
      for (const point of usCpi.value) {
        const row = ensureMonth(point.month)
        row.cpiByCountry = { ...(row.cpiByCountry ?? {}), US: point.value }
      }
      dataSources.push('FRED CPIAUCSL')
    } else {
      warnings.push('FRED US CPI could not be loaded; US-residency inflation uses Shiller CPI.')
    }
    if (frCpi.status === 'fulfilled') {
      for (const point of frCpi.value) {
        const row = ensureMonth(point.month)
        row.cpiByCountry = { ...(row.cpiByCountry ?? {}), FR: point.value }
      }
      dataSources.push('FRED FRACPALTT01IXOBSAM')
    } else {
      warnings.push('FRED France CPI could not be loaded; France-residency inflation uses Shiller CPI.')
    }
  } else {
    warnings.push('No FRED API key saved; Treasury yields use Shiller GS10 and FX uses fallback settings.')
  }

  return {
    monthly: [...monthly.values()].sort((a, b) => a.month.localeCompare(b.month)),
    dataSources,
    warnings,
  }
}

// ─── Simulation settings panel ────────────────────────────────────────────────

const SIM_SETTINGS_DEFAULTS = {
  inflationEUR: 2.5,
  eurUsdDrift: 0,
  successThreshold: 90,
  frenchTaxRate: 17.2,
  taxableWithdrawalShare: 60,
  annualTaxAllowanceEUR: 0,
  cashYieldMultiplier: 75,
  fallbackUsdEurRate: DEFAULT_EUR_USD_RATE,
}

const SIM_SLIDERS: Array<{
  label: string
  key: keyof MonteCarloConfig
  min: number
  max: number
  step: number
  unit?: string
  tooltip: string
}> = [
  { label: 'French tax rate', key: 'frenchTaxRate', min: 0, max: 45, step: 0.5, tooltip: 'Simple effective French tax/social charge rate applied to taxable portfolio withdrawals.' },
  { label: 'Taxable withdrawal share', key: 'taxableWithdrawalShare', min: 0, max: 100, step: 5, tooltip: 'Rough share of portfolio withdrawals considered taxable in the simplified model.' },
  { label: 'Annual tax allowance', key: 'annualTaxAllowanceEUR', min: 0, max: 50000, step: 500, unit: '€', tooltip: 'Annual EUR withdrawal amount ignored by the simplified French tax model before applying the effective rate.' },
  { label: 'Cash yield capture', key: 'cashYieldMultiplier', min: 0, max: 100, step: 5, tooltip: 'How much of each month’s historical Treasury yield is credited to cash-like balances. 0% means cash earns nothing; 100% means cash earns the full Treasury-yield proxy.' },
  { label: 'Safe-spend target', key: 'successThreshold', min: 50, max: 99, step: 1, tooltip: 'Used only for the Safe monthly spend metric. 90% means the extra monthly spend is set so at least 90% of historical cohorts avoid depletion.' },
]

function SimulationSettingsPanel({ config, onApply, onCancel, running }: {
  config: MonteCarloConfig
  onApply: (config: MonteCarloConfig) => void
  onCancel: () => void
  running: boolean
}) {
  const [local, setLocal] = useState({ ...SIM_SETTINGS_DEFAULTS, ...config })
  return (
    <div className="mb-4 pb-4 border-b border-gray-100 dark:border-gray-700">
      <div className="mb-3 text-[11px] text-gray-500 dark:text-gray-400">
        Historical cohorts use Shiller CPI, S&amp;P total-return index, and GS10 Treasury yields month by month. Tiingo/FRED normalized ETF and FX series can replace these proxies when added.
      </div>
      <div className="grid grid-cols-2 gap-x-8 gap-y-[7px]">
        {SIM_SLIDERS.map(({ label, key, min, max, step, unit = '%', tooltip }) => (
          <div key={key} className="flex items-center gap-2 text-[11px]">
            <span className="text-gray-500 dark:text-gray-400 min-w-[140px] inline-flex items-center gap-1">
              {label}
              <InfoTooltip text={tooltip} />
            </span>
            <input type="range" min={min} max={max} step={step}
              value={local[key] as number}
              onChange={e => setLocal({...local, [key]: parseFloat(e.target.value) })}
              className="flex-1 h-[3px] accent-blue-500" />
            <span className="text-gray-700 dark:text-gray-300 min-w-[44px] text-right font-medium">
              {(local[key] as number).toFixed(step < 1 ? (step < 0.1 ? 2 : 2) : 0)}{unit}
            </span>
          </div>
        ))}
      </div>
      <div className="mt-3 text-[11px] leading-[1.45] text-gray-500 dark:text-gray-400">
        Each cohort starts from today’s liquid balance and walks through one historical month at a time. Success means liquid assets stay above zero for the full projection. The safe-spend target only controls the extra Safe monthly spend estimate. Cash yield capture controls the return credited to cash-like balances from the Treasury-yield proxy. The French tax knobs are a simplified withdrawal-tax model today; income-based treaty-aware taxation is not modeled yet.
      </div>
      <div className="flex justify-end gap-2 mt-4">
        <button onClick={onCancel} className="px-3 py-1.5 text-[11px] font-medium text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200">Cancel</button>
        <Button variant="default" onClick={() => onApply(local)} disabled={running}>
          {running ? 'Running…' : 'Apply'}
        </Button>
      </div>
    </div>
  )
}

// ─── Lifetime chart ───────────────────────────────────────────────────────────

interface AnnualItem { label: string; amount: number; currency: string }

interface ProjectedAccount {
  id: number
  name: string
  type: Account['type']
  currency: string
  amountBase: number
  amountNative: number
}

interface ProjectionAssumptions {
  equityReturn: number
  bondReturn: number
  cashReturn: number
  realEstateReturn: number
  otherReturn: number
  loanReturn: number
  eurUsdDrift: number
}

interface LifetimePoint {
  label: string
  median: number
  liquidNW: number     // P50 liquid
  liquidP10: number    // P10 liquid (bottom 10%)
  liquidP90: number    // P75 liquid (top 25%)
  realEstateNW: number
  bandBase: number     // = liquidP10 (bottom of band)
  bandSize: number     // = liquidP90 - liquidP10 (full band width)
  medianBandSize: number
  upperBandSize: number
  events: LifeEvent[]
  income: number | null
  expense: number | null
  tax: number | null
  netCashFlow: number | null
  transfersEvents: number | null
  portfolioGrowth: number | null
  incomeItems: AnnualItem[]
  expenseItems: AnnualItem[]
  taxItems: AnnualItem[]
  portfolioGrowthItems: AnnualItem[]
  accounts: ProjectedAccount[]
}

interface EventYearMarker {
  year: number
  events: LifeEvent[]
}

function EventMarkerLabel({ viewBox, events }: { viewBox?: { x?: number; y?: number }, events: LifeEvent[] }) {
  if (!viewBox || viewBox.x == null || viewBox.y == null) return null
  const deduped = events.filter((event, index, arr) => arr.findIndex(other => other.emoji === event.emoji && other.color === event.color) === index)
  const x = Math.max(12, viewBox.x)
  return (
    <g transform={`translate(${x + 10}, 18)`}>
      {deduped.map((event, index) => (
        <g key={`${event.emoji}-${event.color}-${index}`} transform={`translate(0, ${index * 19})`}>
          <circle r="7.5" fill={event.color} />
          <text y="3.6" textAnchor="middle" fontSize="9.5" fill="#fff">{event.emoji}</text>
        </g>
      ))}
    </g>
  )
}

function SourceTooltip({ sources }: { sources: string[] }) {
  const linkFor = (source: string): string | null => {
    if (source.includes('Tiingo')) return 'https://www.tiingo.com/documentation/end-of-day'
    if (source.includes('DGS10')) return 'https://fred.stlouisfed.org/series/DGS10'
    if (source.includes('EXUSEU')) return 'https://fred.stlouisfed.org/series/EXUSEU'
    if (source.includes('Shiller')) return 'https://shillerdata.com/'
    return null
  }

  return (
    <ul className="list-disc pl-4 space-y-1">
      {[...(sources.length > 0 ? sources : ['Historical source details are unavailable.'])].sort().map(source => {
        const href = linkFor(source)
        return (
          <li key={source}>
            {href ? <a href={href} target="_blank" rel="noreferrer" className="underline text-blue-200">{source}</a> : source}
          </li>
        )
      })}
    </ul>
  )
}

function AssumptionsTooltip({ assumptions }: { assumptions: string[] }) {
  return (
    <ul className="list-disc pl-4 space-y-1">
      {[...(assumptions.length > 0 ? assumptions : ['No fallback assumptions are currently active.'])].sort().map(item => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  )
}

const DETAIL_ASSUMPTION_SLIDERS: Array<{
  label: string
  key: keyof ProjectionAssumptions
  min: number
  max: number
  step: number
}> = [
  { label: 'Equity return', key: 'equityReturn', min: 0, max: 12, step: 0.5 },
  { label: 'Bond return', key: 'bondReturn', min: -2, max: 6, step: 0.25 },
  { label: 'Cash return', key: 'cashReturn', min: 0, max: 6, step: 0.25 },
  { label: 'Real estate growth', key: 'realEstateReturn', min: -2, max: 8, step: 0.25 },
  { label: 'Loan balance growth', key: 'loanReturn', min: -6, max: 6, step: 0.25 },
  { label: 'Other return', key: 'otherReturn', min: -2, max: 8, step: 0.25 },
  { label: 'EUR/USD drift', key: 'eurUsdDrift', min: -3, max: 3, step: 0.25 },
]

function SimulationProgressState({ message, progressPct }: { message: string; progressPct: number | null }) {
  const pct = progressPct == null ? 8 : Math.max(3, Math.min(100, progressPct))
  return (
    <Card>
      <div className="h-[360px] flex items-center justify-center">
        <div className="w-full max-w-[360px] text-center">
          <div className="mx-auto mb-4 h-11 w-11 rounded-full border-[3px] border-blue-100 dark:border-blue-900/50 border-t-blue-500 animate-spin" />
          <div className="text-[13px] font-medium text-gray-700 dark:text-gray-200">{message}</div>
          <div className="mt-4 h-2 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
            <div
              className="h-full rounded-full bg-blue-500 transition-[width] duration-300"
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="mt-2 text-[11px] tabular-nums text-gray-400">
            {progressPct == null ? 'Preparing…' : `${progressPct}%`}
          </div>
        </div>
      </div>
    </Card>
  )
}

function assumptionsFromConfig(config: MonteCarloConfig): ProjectionAssumptions {
  return {
    equityReturn: config.equityMeanReturn,
    bondReturn: config.bondMeanReturn,
    cashReturn: 0,
    realEstateReturn: config.inflationEUR,
    otherReturn: 0,
    loanReturn: 0,
    eurUsdDrift: config.eurUsdDrift,
  }
}

function ProjectionAssumptionsPanel({ assumptions, onApply, onCancel }: {
  assumptions: ProjectionAssumptions
  onApply: (assumptions: ProjectionAssumptions) => void
  onCancel: () => void
}) {
  const [local, setLocal] = useState(assumptions)

  return (
    <div className="mb-4 pb-4 border-b border-gray-100 dark:border-gray-700">
      <div className="grid grid-cols-2 gap-x-8 gap-y-[7px]">
        {DETAIL_ASSUMPTION_SLIDERS.map(({ label, key, min, max, step }) => (
          <div key={key} className="flex items-center gap-2 text-[11px]">
            <span className="text-gray-500 dark:text-gray-400 min-w-[140px]">{label}</span>
            <input
              type="range"
              min={min}
              max={max}
              step={step}
              value={local[key]}
              onChange={e => setLocal({ ...local, [key]: parseFloat(e.target.value) })}
              className="flex-1 h-[3px] accent-blue-500"
            />
            <span className="text-gray-700 dark:text-gray-300 min-w-[44px] text-right font-medium">
              {local[key].toFixed(2)}%
            </span>
          </div>
        ))}
      </div>
      <div className="flex justify-end gap-2 mt-4">
        <button onClick={onCancel} className="px-3 py-1.5 text-[11px] font-medium text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200">Cancel</button>
        <Button variant="default" onClick={() => onApply(local)}>Apply</Button>
      </div>
    </div>
  )
}

function FreqIcon({ frequency }: { frequency?: string }) {
  if (frequency === 'monthly') return <RecurringIcon letter="m" />
  if (frequency === 'yearly') return <RecurringIcon letter="y" />
  if (frequency === 'one_time') return <OneTimeIcon />
  return null
}

function eventSignedAmount(ev: LifeEvent): number | null {
  if (ev.amount == null) return null
  const lower = ev.label.toLowerCase()
  if (lower.includes('rent') || lower.includes('buy')) return -Math.abs(ev.amount)
  return Math.abs(ev.amount)
}

function LifetimeTooltip({ active, payload, label, currency = 'EUR' }: {
  active?: boolean
  payload?: Array<{ payload: LifetimePoint }>
  label?: string
  currency?: string
}) {
  if (!active || !payload?.length) return null
  const pt = payload[0]?.payload
  if (!pt) return null
  const evts = pt.events ?? []
  return (
    <div className="bg-gray-900 text-white text-[11px] px-3 py-2 rounded-lg shadow-lg border border-gray-700 max-w-[250px]">
      <div className="font-semibold mb-1 pb-1 border-b border-gray-700">{label} — Liquid NW</div>
      <div className="space-y-0.5 py-0.5">
        <div className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0"></span>
          <span className="text-gray-300">Top 25%</span>
          <span className="ml-auto font-medium text-green-400">{formatCompact(pt.liquidP90, currency)}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0"></span>
          <span className="text-gray-300">Median</span>
          <span className="ml-auto font-medium text-blue-400">{formatCompact(pt.liquidNW, currency)}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0"></span>
          <span className="text-gray-300">Bottom 10%</span>
          <span className="ml-auto font-medium text-red-400">{formatCompact(pt.liquidP10, currency)}</span>
        </div>
      </div>
      {evts.length > 0 && (
        <div className="mt-1 pt-1 border-t border-gray-700 space-y-1">
          {evts.map((ev, i) => (
            <div key={i} className="flex items-start gap-1.5">
              {ev.frequency && (
                <span className="shrink-0 h-3.5 inline-flex items-center justify-center mt-[2px]">
                  <FreqIcon frequency={ev.frequency} />
                </span>
              )}
              <span className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full text-white text-[8px] shrink-0 mt-0.5"
                style={{ background: ev.color }}>{ev.emoji}</span>
              <div className="flex-1 min-w-0">
                <div className="text-gray-300 truncate">{ev.label}</div>
                {eventSignedAmount(ev) != null && (
                  <div className="text-gray-400 text-[10px] flex items-center gap-1">
                    {(() => {
                      const signed = eventSignedAmount(ev) ?? 0
                      const cls = signed >= 0 ? 'text-green-400' : 'text-red-400'
                      const sign = signed >= 0 ? '+' : '−'
                      return <span className={cls}>{sign}{formatCompact(Math.abs(signed), ev.currency ?? 'EUR')}</span>
                    })()}
                    {ev.endDate && <span className="text-gray-500">→ {ev.endDate}</span>}
                  </div>
                )}
                {ev.amount == null && ev.endDate && (
                  <div className="text-gray-500 text-[10px]">→ {ev.endDate}</div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function IncomeExpenseTooltip({ items, type, minTx, year }: { items: AnnualItem[], type: 'Income' | 'Expenses' | 'Taxes', minTx: number, year?: string }) {
  const filtered = items
    .filter(it => Math.abs(it.amount) >= minTx)
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
  const title = year ? `${type} — ${year}` : `${type} details`
  return (
    <div className="bg-gray-900 text-white text-[11px] px-3 py-2 rounded-lg shadow-lg border border-gray-700 w-[320px] max-w-[min(320px,calc(100vw-32px))] space-y-1 whitespace-normal">
      <div className="font-semibold pb-1 border-b border-gray-700 text-[12px]">{title}</div>
      {filtered.length > 0 ? filtered.map((it, i) => (
        <div key={i} className="flex items-start gap-2">
          <span className="text-gray-300 flex-1 min-w-0 whitespace-normal leading-snug">{it.label}</span>
          <span className="text-white shrink-0 font-medium flex items-center gap-1">
             <span className="tabular-nums">{it.amount < 0 ? formatSignedCurrency(it.amount, it.currency) : formatCurrency(it.amount, it.currency)}</span>
          </span>
        </div>
      )) : (
        <div className="text-gray-400">No items above threshold</div>
      )}
    </div>
  )
}

function NWDetailsTooltip({ title, accounts, total, currency = 'EUR' }: {
  title: string
  accounts: ProjectedAccount[]
  total: number
  currency?: string
}) {
  const sortedAccounts = [...accounts].sort((a, b) => b.amountBase - a.amountBase)

  return (
    <div className="bg-gray-900 text-white text-[11px] px-3 py-2 rounded-lg shadow-lg border border-gray-700 max-w-[220px] space-y-1 whitespace-normal">
      <div className="font-semibold pb-1 border-b border-gray-700 text-[12px]">
        {title}: {formatCurrency(total, currency)}
      </div>
      {sortedAccounts.length > 0 ? sortedAccounts.map(acc => (
        <div key={acc.id} className="flex items-start gap-2">
          <span className="text-gray-300 flex-1 min-w-0 truncate">{acc.name}</span>
          <span className="text-white shrink-0 font-medium">
            <span className="tabular-nums">{formatCurrency(acc.amountNative, acc.currency)}</span>
          </span>
        </div>
      )) : (
        <div className="text-gray-400">No accounts</div>
      )}
    </div>
  )
}

function formatSignedCurrency(amount: number | null | undefined, currency: string): string {
  if (amount == null || !isFinite(amount)) return '—'
  if (amount === 0) return formatCurrency(0, currency)
  const sign = amount > 0 ? '+' : '−'
  return `${sign}${formatCurrency(Math.abs(amount), currency)}`
}

function PortfolioGrowthTooltip({
  row,
  currency,
  minTx,
}: {
  row: LifetimePoint
  currency: string
  minTx: number
}) {
  const items = row.portfolioGrowthItems
    .filter(item => Math.abs(item.amount) >= minTx)
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
  const isYtd = row.label === 'YTD'
  return (
    <div className="bg-gray-900 text-white text-[11px] px-3 py-2 rounded-lg shadow-lg border border-gray-700 w-[360px] max-w-[min(360px,calc(100vw-32px))] space-y-1.5 whitespace-normal">
      <div className="font-semibold pb-1 border-b border-gray-700 text-[12px]">
        Portfolio growth — {row.label}: {formatSignedCurrency(row.portfolioGrowth, currency)}
      </div>
      <div className="text-gray-300 leading-snug">
        {isYtd
          ? 'YTD is not projected, so no market growth is estimated here. It only exposes flows already elapsed this year.'
          : 'Estimated price/interest growth on prior liquid account balances. Dividends are excluded here and appear under Income.'}
      </div>
      {!isYtd && (
        <div className="pt-1 space-y-1">
          {items.length > 0 ? items.map((item, index) => (
            <div key={`${item.label}-${index}`} className="flex items-start gap-2">
              <span className="text-gray-300 flex-1 min-w-0 whitespace-normal leading-snug">{item.label}</span>
              <span className={`shrink-0 font-medium tabular-nums ${signedClass(item.amount)}`}>
                {formatSignedCurrency(item.amount, item.currency)}
              </span>
            </div>
          )) : (
            <div className="text-gray-400">No liquid account growth above threshold</div>
          )}
        </div>
      )}
    </div>
  )
}

function NetTooltip({ row, currency }: { row: LifetimePoint; currency: string }) {
  const income = row.income ?? 0
  const portfolioGrowth = row.portfolioGrowth ?? 0
  const expense = row.expense ?? 0
  const tax = row.tax ?? 0
  const net = row.netCashFlow ?? 0
  const rows = [
    { label: 'Income', value: income, className: 'text-green-400', format: formatSignedCurrency(income, currency) },
    { label: 'Portfolio growth', value: portfolioGrowth, className: signedClass(portfolioGrowth), format: formatSignedCurrency(portfolioGrowth, currency) },
    { label: 'Expenses', value: -expense, className: 'text-red-400', format: `−${formatCurrency(expense, currency)}` },
    { label: 'Tax', value: -tax, className: 'text-red-400', format: `−${formatCurrency(tax, currency)}` },
  ]
  return (
    <div className="bg-gray-900 text-white text-[11px] px-3 py-2 rounded-lg shadow-lg border border-gray-700 w-[300px] max-w-[min(300px,calc(100vw-32px))] space-y-1 whitespace-normal">
      <div className="font-semibold pb-1 border-b border-gray-700 text-[12px]">
        Net — {row.label}: {formatSignedCurrency(net, currency)}
      </div>
      <div className="text-gray-300 leading-snug">
        Income + portfolio growth − expenses − tax.
      </div>
      <div className="pt-1 space-y-1">
        {rows.map(item => (
          <div key={item.label} className="flex items-center justify-between gap-3">
            <span className="text-gray-300">{item.label}</span>
            <span className={`font-medium tabular-nums ${item.value === 0 ? 'text-gray-400' : item.className}`}>{item.format}</span>
          </div>
        ))}
        <div className="flex items-center justify-between gap-3 border-t border-gray-700 pt-1 mt-1">
          <span className="text-gray-100 font-semibold">Net</span>
          <span className={`font-semibold tabular-nums ${signedClass(net)}`}>{formatSignedCurrency(net, currency)}</span>
        </div>
      </div>
    </div>
  )
}

function accountListForTooltip(accounts: ProjectedAccount[], minAmountEUR: number): ProjectedAccount[] {
  return accounts.filter(acc => Math.abs(acc.amountBase) >= minAmountEUR)
}

const SERIES_DEF = [
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
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: pt.color }}></span>
          <span className="text-gray-300 flex-1">{pt.name}</span>
          <span className="font-medium">{formatCurrency(pt.value, currency)}</span>
        </div>
      ))}
    </div>
  )
}

function CohortInputsTooltip({ active, payload, label, currency = 'EUR' }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-gray-900 text-white text-[11px] px-3 py-2 rounded-lg shadow-lg border border-gray-700">
      <div className="font-semibold mb-1 pb-1 border-b border-gray-700">{label}</div>
      {payload.map((pt: any, i: number) => {
        const value = Number(pt.value)
        const labelText = pt.dataKey === 'liquidNetWorth' || pt.dataKey === 'netFlowEUR'
          ? formatCurrency(value, currency)
          : `${value.toFixed(2)}%`
        return (
          <div key={i} className="flex items-center gap-2 mb-0.5">
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: pt.color }}></span>
            <span className="text-gray-300 flex-1">{pt.name}</span>
            <span className="font-medium tabular-nums">{labelText}</span>
          </div>
        )
      })}
    </div>
  )
}

function CohortDetailsModal({
  cohort,
  cohorts,
  onSelect,
  onClose,
  currency,
  fxRate = DEFAULT_EUR_USD_RATE,
}: {
  cohort: NonNullable<SimulationResult['cohortSummaries']>[number]
  cohorts: NonNullable<SimulationResult['cohortSummaries']>
  onSelect: (startMonth: string) => void
  onClose: () => void
  currency: 'EUR' | 'USD'
  fxRate?: number
}) {
  const [selectedSeries, setSelectedSeries] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('dinner-money:cohort-input-series')
      const parsed = saved ? JSON.parse(saved) : null
      return Array.isArray(parsed) && parsed.length > 0 ? parsed : ['liquidNetWorth', 'netFlowEUR', 'portfolioReturnPct', 'equityReturnPct']
    } catch {
      return ['liquidNetWorth', 'netFlowEUR', 'portfolioReturnPct', 'equityReturnPct']
    }
  })
  const [successFilter, setSuccessFilter] = useState<'all' | 'successful' | 'failed'>('all')
  const [percentileMin, setPercentileMin] = useState(0)
  const [percentileMax, setPercentileMax] = useState(100)
  const rankedCohorts = [...cohorts]
    .sort((a, b) => a.endingNetWorth - b.endingNetWorth)
    .map((item, index, arr) => ({
      ...item,
      percentile: arr.length <= 1 ? 100 : index / (arr.length - 1) * 100,
    }))
  const successFiltered = rankedCohorts.filter(item =>
    successFilter === 'all' ||
    (successFilter === 'successful' ? item.survived : !item.survived)
  )
  const filteredCohorts = successFiltered.filter(item => item.percentile >= percentileMin && item.percentile <= percentileMax)
    .sort((a, b) => a.startMonth.localeCompare(b.startMonth))
  const selectedRanked = rankedCohorts.find(item => item.startMonth === cohort.startMonth) ?? rankedCohorts[0]
  const visibleCohort = filteredCohorts.some(item => item.startMonth === selectedRanked?.startMonth)
    ? selectedRanked
    : (filteredCohorts[0] ?? selectedRanked)
  const rows = visibleCohort?.yearlyInputs ?? []
  const chartRows = rows.map(row => ({
    ...row,
    liquidNetWorth: convertToBase(row.liquidNetWorth, 'EUR', currency, fxRate),
    netFlowEUR: convertToBase(row.netFlowEUR, 'EUR', currency, fxRate),
  }))
  const yearTicks = rows
    .map(point => point.cohortYear)
    .filter((year, index) => index === 0 || year % 5 === 0)

  const cohortSeries = [
    { key: 'liquidNetWorth', label: 'Liquid NW', color: '#3b82f6', axis: 'money' },
    { key: 'netFlowEUR', label: 'Net flows', color: '#f59e0b', axis: 'money' },
    { key: 'inflationPct', label: 'Inflation', color: '#9333ea', axis: 'pct' },
    { key: 'equityReturnPct', label: 'Equity return', color: '#2563eb', axis: 'pct' },
    { key: 'portfolioReturnPct', label: 'Portfolio return', color: '#14b8a6', axis: 'pct' },
    { key: 'treasuryYieldAnnual', label: 'Treasury yield', color: '#0f766e', axis: 'pct' },
  ]

  function toggleSeries(key: string) {
    setSelectedSeries(current => {
      const next = current.includes(key) ? current.filter(k => k !== key) : [...current, key]
      try { localStorage.setItem('dinner-money:cohort-input-series', JSON.stringify(next)) } catch {}
      return next
    })
  }

  function valueClass(seriesKey: string, value: number): string {
    if (seriesKey === 'liquidNetWorth') return ''
    if (value > 0) return 'text-green-600 dark:text-green-400'
    if (value < 0) return 'text-red-500 dark:text-red-400'
    return 'text-gray-500 dark:text-gray-400'
  }

  function formatCohortValue(seriesKey: string, value: number): string {
    if (seriesKey === 'liquidNetWorth' || seriesKey === 'netFlowEUR') return formatCurrency(convertToBase(value, 'EUR', currency, fxRate), currency)
    return `${value.toFixed(2)}%`
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 px-4 py-8" onMouseDown={onClose}>
      <div className="w-full max-w-4xl max-h-full overflow-hidden rounded-[8px] bg-white dark:bg-gray-900 shadow-2xl border border-gray-200 dark:border-gray-700" onMouseDown={event => event.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-gray-100 dark:border-gray-800">
          <div>
            <div className="text-[13px] font-semibold text-gray-800 dark:text-gray-100">Cohort inputs</div>
            <div className="text-[10.5px] text-gray-500 dark:text-gray-400">
              Historical macro and market inputs for the selected cohort.
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="h-[28px] px-2 rounded-[5px] text-[11px] font-medium text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
            >
              Close
            </button>
          </div>
        </div>
        <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-800 grid grid-cols-[auto_auto_1fr] gap-3 items-center text-[11px]">
          <div className="inline-flex rounded-[5px] border border-gray-200 dark:border-gray-700 overflow-hidden">
            {([
              ['all', 'All'],
              ['successful', 'Successful'],
              ['failed', 'Failed'],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setSuccessFilter(value)}
                className={`px-2.5 py-1 ${successFilter === value ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-300' : 'text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800'}`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400">
            <span>Percentile</span>
            <div className="flex items-center gap-1">
              <input
                type="number"
                min={0}
                max={percentileMax}
                value={percentileMin}
                onChange={event => setPercentileMin(Math.min(Number(event.target.value), percentileMax))}
                className="w-12 h-[26px] rounded-[4px] border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-1 text-right text-[10.5px]"
              />
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={percentileMax - percentileMin}
                onChange={event => setPercentileMax(Math.min(100, percentileMin + Number(event.target.value)))}
                className="w-28 h-[3px] accent-blue-500"
              />
              <input
                type="number"
                min={percentileMin}
                max={100}
                value={percentileMax}
                onChange={event => setPercentileMax(Math.max(Number(event.target.value), percentileMin))}
                className="w-12 h-[26px] rounded-[4px] border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-1 text-right text-[10.5px]"
              />
            </div>
            <span className="w-16 text-right font-medium text-gray-700 dark:text-gray-200">P{percentileMin}-P{percentileMax}</span>
          </div>
          <div className="relative">
            <select
              value={visibleCohort?.startMonth ?? ''}
              onChange={event => onSelect(event.target.value)}
              className={`h-[32px] w-full rounded-[5px] border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 text-[11px] font-medium ${visibleCohort?.survived ? 'text-green-700 dark:text-green-300' : 'text-red-600 dark:text-red-300'}`}
            >
              {filteredCohorts.map(item => (
                <option key={item.startMonth} value={item.startMonth}>
                  {item.survived ? '●' : '◆'} | {item.startMonth} | {formatCompact(convertToBase(item.endingNetWorth, 'EUR', currency, fxRate), currency)} | P{item.percentile.toFixed(0)}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="p-4 overflow-auto max-h-[calc(100vh-140px)]">
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={chartRows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#374151" opacity={0.18} />
              <XAxis
                dataKey="cohortYear"
                tick={{ fontSize: 10 }}
                tickLine={false}
                axisLine={false}
                ticks={yearTicks}
              />
              <YAxis yAxisId="pct" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} width={44} tickFormatter={(v) => `${v}%`} />
              <YAxis yAxisId="money" orientation="right" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} width={54} tickFormatter={(v) => formatCompact(v, currency)} />
              <Tooltip content={<CohortInputsTooltip currency={currency} />} />
              {cohortSeries.filter(series => selectedSeries.includes(series.key)).map(series => (
                <Line key={series.key} yAxisId={series.axis} type="monotone" dataKey={series.key} name={series.label} stroke={series.color} dot={false} strokeWidth={1.5} />
              ))}
            </LineChart>
          </ResponsiveContainer>
          <div className="max-h-[300px] overflow-auto mt-3 border border-gray-100 dark:border-gray-800 rounded-[6px]">
            <table className="w-full text-[10.5px]">
              <thead className="sticky top-0 bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400">
                <tr>
                  <th className="text-left font-medium px-2 py-1.5">Cohort year</th>
                  <th className="text-left font-medium px-2 py-1.5">Projection year</th>
                  {cohortSeries.map(series => (
                    <th key={series.key} className="text-right font-medium px-2 py-1.5 cursor-pointer select-none" onClick={() => toggleSeries(series.key)}>
                      <div className="flex items-center justify-end gap-1.5">
                        <ToggleDot color={series.color} selected={selectedSeries.includes(series.key)} />
                        {series.label}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(point => (
                  <tr key={point.year} className="border-t border-gray-50 dark:border-gray-800">
                    <td className="px-2 py-1.5">{point.cohortYear}</td>
                    <td className="px-2 py-1.5">{point.year}</td>
                    {cohortSeries.map(series => {
                      const value = Number((point as any)[series.key] ?? 0)
                      return (
                        <td key={series.key} className={`px-2 py-1.5 text-right tabular-nums ${valueClass(series.key, value)}`}>
                          {formatCohortValue(series.key, value)}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}

// Show tooltip below for first few rows to avoid top-clipping
function tooltipPos(rowIndex: number): string {
  return rowIndex < 3 ? 'top-full mt-1' : 'bottom-full mb-1'
}

function ToggleDot({ seriesKey, color, selected }: { seriesKey?: string; color?: string; selected: boolean }) {
  const s = seriesKey ? SERIES_DEF.find(d => d.key === seriesKey) : null
  const dotColor = color ?? s?.color
  if (!dotColor) return null
  return (
    <span
      className="w-2.5 h-2.5 rounded-full shrink-0 inline-block border transition-colors"
      style={{
        backgroundColor: selected ? dotColor : 'transparent',
        borderColor: dotColor,
      }}
    />
  )
}

function projectedAccountsForYear(
  accounts: Account[],
  realEstateEvents: RealEstateEvent[],
  transfers: Transfer[],
  expenses: Expense[],
  medicalCoverages: MedicalCoverage[],
  medicalExpenses: MedicalExpense[],
  pensions: PensionEstimate[],
  windfalls: Windfall[],
  taxConfig: TaxConfig,
  year: number,
  currentYear: number,
  assumptions: ProjectionAssumptions,
  fxRate: number = DEFAULT_EUR_USD_RATE,
): ProjectedAccount[] {
  const activeAccounts = projectedAccountsBy(`${year}-12`, {
    accounts,
    realEstateEvents,
    transfers,
    expenses,
    medicalCoverages,
    medicalExpenses,
    pensions,
    windfalls,
    taxSettlements: taxConfig.settlements ?? [],
  })

  return activeAccounts
    .filter(acc => acc.type !== 'credit')
    .map(acc => {
      const accountYear = parseInt(String(acc.syncedAt ?? '').split('-')[0])
      const startYear = Number.isFinite(accountYear) ? Math.max(currentYear, accountYear) : currentYear
      const yearsElapsed = Math.max(0, year - startYear)
      const annualReturn = accountAnnualReturn(acc, assumptions)
      const amountNative = acc.balance * Math.pow(1 + annualReturn / 100, yearsElapsed)
      const eurUsdRate = fxRate * Math.pow(1 + assumptions.eurUsdDrift / 100, yearsElapsed)
      const amountBase = convertToBase(amountNative, acc.currency, 'EUR', eurUsdRate)

      return {
        id: acc.id,
        name: acc.name,
        type: acc.type,
        currency: acc.currency,
        amountBase,
        amountNative,
      }
    })
}

function accountAnnualReturn(account: Account, assumptions: ProjectionAssumptions): number {
  if (account.type === 'real_estate') return assumptions.realEstateReturn
  if (account.type === 'cash') return account.interestRate ?? assumptions.cashReturn
  if (account.type === 'loan') return assumptions.loanReturn
  if (account.type === 'investment' || account.type === 'retirement') {
    return (
      (account.allocation.equity / 100) * assumptions.equityReturn +
      (account.allocation.bonds / 100) * assumptions.bondReturn +
      (account.allocation.cash / 100) * assumptions.cashReturn
    )
  }
  return assumptions.otherReturn
}

function isLiquidType(type: Account['type'] | undefined): boolean {
  return type === 'cash' || type === 'investment' || type === 'retirement'
}

function monthsInYearWindow(
  startDate: string,
  endDate: string | null | undefined,
  year: number,
  fromMonth: number,
  throughMonth: number,
  frequency: string,
): number {
  const start = startDate.slice(0, 7)
  const end = endDate?.slice(0, 7) ?? '9999-12'
  let count = 0
  for (let month = fromMonth; month <= throughMonth; month++) {
    const ym = `${year}-${String(month).padStart(2, '0')}`
    if (ym < start || ym > end) continue
    if (frequency === 'monthly') count++
    else if (frequency === 'yearly' && ym.slice(5, 7) === start.slice(5, 7)) count++
    else if ((frequency === 'once' || frequency === 'one_time') && ym === start) count++
  }
  return count
}

function quarterDueYear(year: number, quarter: 1 | 2 | 3 | 4): number {
  return quarter === 4 ? year + 1 : year
}

function quarterDueMonth(quarter: 1 | 2 | 3 | 4): number {
  if (quarter === 4) return 1
  return ({ 1: 4, 2: 6, 3: 9 } as const)[quarter]
}

function annualQuarterlyTaxPaymentItems(taxConfig: TaxConfig, year: number): AnnualItem[] {
  const paymentGroups = [
    { source: 'IRS', payments: taxConfig.quarterlyPayments ?? [] },
    { source: 'California', payments: taxConfig.stateQuarterlyPayments ?? [] },
  ]
  const items: AnnualItem[] = []

  for (const group of paymentGroups) {
    for (const payment of group.payments) {
      if (payment.status === 'none') continue
      if (quarterDueYear(payment.year, payment.quarter) !== year) continue

      const amount = payment.estimatedDue ?? payment.amountPaid ?? 0

      if (amount <= 0) continue
      items.push({
        label: `${group.source} quarterly tax Q${payment.quarter} ${payment.year}`,
        amount,
        currency: 'USD',
      })
    }
  }

  return items
}

function ytdQuarterlyTaxPaymentItems(taxConfig: TaxConfig, year: number, throughMonth: number): AnnualItem[] {
  const allItems = annualQuarterlyTaxPaymentItems(taxConfig, year)
  const dueByLabel = (label: string) => {
    const match = label.match(/Q([1-4])\s+(\d{4})$/)
    if (!match) return 12
    return quarterDueMonth(Number(match[1]) as 1 | 2 | 3 | 4)
  }
  return allItems.filter(item => dueByLabel(item.label) <= throughMonth)
}

function taxSettlementItemsForYear(taxConfig: TaxConfig, year: number, throughMonth = 12): AnnualItem[] {
  const jurisdictionLabel = (jurisdiction: TaxConfig['settlements'][number]['jurisdiction']) => {
    if (jurisdiction === 'state') return 'State'
    if (jurisdiction === 'france') return 'France'
    return 'Federal'
  }
  return (taxConfig.settlements ?? [])
    .filter(item => item.date.slice(0, 4) === String(year))
    .filter(item => Number(item.date.slice(5, 7)) <= throughMonth)
    .map(item => ({
      label: `${jurisdictionLabel(item.jurisdiction)} ${item.kind === 'refund' ? 'tax refund' : 'tax paid'} for ${item.taxYear}`,
      amount: item.kind === 'refund' ? -item.amount : item.amount,
      currency: item.currency,
    }))
}

function elapsedMonthsInYear(startDate: string, endDate: string | null | undefined, year: number, throughMonth: number, frequency: string): number {
  const start = startDate.slice(0, 7)
  const end = endDate?.slice(0, 7) ?? '9999-12'
  let count = 0
  for (let month = 1; month <= throughMonth; month++) {
    const ym = `${year}-${String(month).padStart(2, '0')}`
    if (ym < start || ym > end) continue
    if (frequency === 'monthly') count++
    else if (frequency === 'yearly' && ym.slice(5, 7) === start.slice(5, 7)) count++
    else if ((frequency === 'once' || frequency === 'one_time') && ym === start) count++
  }
  return count
}

function annualTransferFlowItems(
  year: number,
  accounts: Account[],
  transfers: Transfer[],
  fromMonth = 1,
  throughMonth = 12,
): { incomeItems: AnnualItem[]; expenseItems: AnnualItem[] } {
  const accountById = new Map(accounts.map(account => [account.id, account]))
  const incomeItems: AnnualItem[] = []
  const expenseItems: AnnualItem[] = []

  for (const transfer of transfers) {
    const count = monthsInYearWindow(transfer.startDate, transfer.endDate, year, fromMonth, throughMonth, transfer.frequency)
    if (count === 0) continue
    const from = accountById.get(transfer.fromAccountId)
    const to = accountById.get(transfer.toAccountId)
    const fromLiquid = isLiquidType(from?.type)
    const toLiquid = isLiquidType(to?.type)
    if (fromLiquid === toLiquid) continue
    const item = {
      label: transfer.name || `${from?.name ?? 'External'} → ${to?.name ?? 'External'}`,
      amount: transfer.amount * count,
      currency: transfer.currency,
    }
    if (toLiquid) incomeItems.push(item)
    else expenseItems.push(item)
  }

  return { incomeItems, expenseItems }
}

function ytdTransferFlowItems(
  year: number,
  throughMonth: number,
  accounts: Account[],
  transfers: Transfer[],
): { incomeItems: AnnualItem[]; expenseItems: AnnualItem[] } {
  const accountById = new Map(accounts.map(account => [account.id, account]))
  const incomeItems: AnnualItem[] = []
  const expenseItems: AnnualItem[] = []

  for (const transfer of transfers) {
    const count = elapsedMonthsInYear(transfer.startDate, transfer.endDate, year, throughMonth, transfer.frequency)
    if (count === 0) continue
    const from = accountById.get(transfer.fromAccountId)
    const to = accountById.get(transfer.toAccountId)
    const fromLiquid = isLiquidType(from?.type)
    const toLiquid = isLiquidType(to?.type)
    if (fromLiquid === toLiquid) continue
    const item = {
      label: transfer.name || `${from?.name ?? 'External'} → ${to?.name ?? 'External'}`,
      amount: transfer.amount * count,
      currency: transfer.currency,
    }
    if (toLiquid) incomeItems.push(item)
    else expenseItems.push(item)
  }

  return { incomeItems, expenseItems }
}

function portfolioGrowthBreakdown(
  priorLiquidAccounts: ProjectedAccount[],
  sourceAccounts: Account[],
  assumptions: ProjectionAssumptions,
  currency: string,
): AnnualItem[] {
  const sourceById = new Map(sourceAccounts.map(account => [account.id, account]))
  return priorLiquidAccounts
    .filter(account => isLiquidType(account.type))
    .map(account => {
      const source = sourceById.get(account.id)
      if (!source) return null
      const rate = accountAnnualReturn(source, assumptions)
      const amount = Math.round(account.amountBase * (rate / 100))
      return {
        label: `${account.name} (${rate.toFixed(2)}% of ${formatCurrency(account.amountBase, currency)})`,
        amount,
        currency,
      }
    })
    .filter((item): item is AnnualItem => item != null)
}

function reconcileProjectedAccountGroup(
  projectedAccounts: ProjectedAccount[],
  predicate: (account: ProjectedAccount) => boolean,
  targetTotal: number,
): ProjectedAccount[] {
  const currentTotal = projectedAccounts
    .filter(predicate)
    .reduce((sum, account) => sum + account.amountBase, 0)

  if (currentTotal === 0 || !isFinite(currentTotal)) return projectedAccounts
  const ratio = targetTotal / currentTotal

  return projectedAccounts.map(account => predicate(account)
    ? {
        ...account,
        amountBase: account.amountBase * ratio,
        amountNative: account.amountNative * ratio,
      }
    : account)
}

function reconcileProjectedAccounts(
  projectedAccounts: ProjectedAccount[],
  liquidNW: number,
  realEstateNW: number,
): ProjectedAccount[] {
  const withLiquid = reconcileProjectedAccountGroup(
    projectedAccounts,
    account => isLiquidType(account.type),
    liquidNW,
  )
  return reconcileProjectedAccountGroup(
    withLiquid,
    account => account.type === 'real_estate',
    realEstateNW,
  )
}

function signedClass(amount: number | null | undefined): string {
  if (amount == null || amount === 0) return 'text-gray-400 dark:text-gray-500'
  return amount > 0 ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400'
}

function ProjectionViews({
  result, expenses, medicalCoverages, medicalExpenses, pensions, windfalls, realEstateEvents, accounts, profile,
  config, taxConfig, onApplySettings, running, minTransactionEUR, transfers, openCohortsRequest, fxRate
}: {
  result: SimulationResult
  expenses: Expense[]
  medicalCoverages: MedicalCoverage[]
  medicalExpenses: MedicalExpense[]
  pensions: PensionEstimate[]
  windfalls: Windfall[]
  realEstateEvents: RealEstateEvent[]
  accounts: Account[]
  profile: UserProfile
  config: MonteCarloConfig
  taxConfig: TaxConfig
  onApplySettings: (config: MonteCarloConfig) => void
  running: boolean
  minTransactionEUR: number
  transfers: Transfer[]
  openCohortsRequest: number
  fxRate: number
}) {
  const [showSimSettings, setShowSimSettings] = useState(false)
  const [showProjectionSettings, setShowProjectionSettings] = useState(false)
  const [showCohorts, setShowCohorts] = useState(false)
  const [selectedCohortStart, setSelectedCohortStart] = useState<string | null>(null)
  const [projectionAssumptions, setProjectionAssumptions] = useState(() => assumptionsFromConfig(config))
  const [selectedSeries, setSelectedSeries] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('dinner-money:deterministic-projection-series')
      if (saved) {
        const parsed = JSON.parse(saved)
        if (Array.isArray(parsed) && parsed.every(item => typeof item === 'string')) return parsed
      }
    } catch {}
    return ['liquidNW', 'realEstateNW']
  })
  const events = useLifeEvents()
  const allExp = allExpensesOf(expenses, medicalCoverages, medicalExpenses)
  const currentYear = new Date().getFullYear()
  const currentMonthNumber = new Date().getMonth() + 1
  const annualProjectedDiv = Math.round(projectedAnnualDividendsEUR(accounts, fxRate))
  const displayCurrency = profile.baseCurrency
  const displayFromEUR = (amount: number) => convertToBase(amount, 'EUR', displayCurrency, fxRate)

  const eventsByYear = events.reduce<Record<number, LifeEvent[]>>((acc, ev) => {
    if (!acc[ev.year]) acc[ev.year] = []
    acc[ev.year].push(ev)
    return acc
  }, {})
  const eventMarkers: EventYearMarker[] = Object.entries(eventsByYear)
    .map(([year, yearEvents]) => ({ year: Number(year), events: yearEvents }))
    .filter(marker => marker.year >= result.years[0] && marker.year <= result.years[result.years.length - 1])

  const simulationData: LifetimePoint[] = result.years.map((y, i) => {
    const p10 = Math.max(0, Math.round(displayFromEUR(result.p10NetWorth[i])))
    const p90 = Math.max(0, Math.round(displayFromEUR(result.p90NetWorth[i])))
    const reNW = displayFromEUR(result.realEstateNetWorth[i] || 0)
    const median = Math.max(0, Math.round(displayFromEUR(result.medianNetWorth[i])))
    const liquidNW = Math.max(0, Math.round(median - reNW))
    const liquidP10 = Math.max(0, Math.round(p10 - reNW))
    const liquidP90 = Math.max(0, Math.round(p90 - reNW))

    return {
      label: String(y),
      median,
      liquidNW,
      liquidP10,
      liquidP90,
      realEstateNW: Math.round(reNW),
      bandBase: liquidP10,
      bandSize: Math.max(0, liquidP90 - liquidP10),
      medianBandSize: Math.max(0, liquidNW - liquidP10),
      upperBandSize: Math.max(0, liquidP90 - liquidNW),
      events: eventsByYear[y] ?? [],
      income: null,
      expense: null,
      tax: null,
      netCashFlow: null,
      transfersEvents: null,
      portfolioGrowth: null,
      incomeItems: [],
      expenseItems: [],
      taxItems: [],
      portfolioGrowthItems: [],
      accounts: [],
    }
  })

  const detailData: LifetimePoint[] = result.years.map((y) => {
    const flowFromMonth = 1
    const flowThroughMonth = 12
    const projectedAccountsEUR = projectedAccountsForYear(
      accounts,
      realEstateEvents,
      transfers,
      expenses,
      medicalCoverages,
      medicalExpenses,
      pensions,
      windfalls,
      taxConfig,
      y,
      currentYear,
      projectionAssumptions,
      fxRate,
    )
    const projectedAccounts = projectedAccountsEUR.map(account => ({
      ...account,
      amountBase: displayFromEUR(account.amountBase),
    }))
    const liquidAccounts = projectedAccounts.filter(a => ['cash', 'investment', 'retirement'].includes(a.type))
    const realEstateAccounts = projectedAccounts.filter(a => a.type === 'real_estate')
    const median = Math.round(projectedAccounts.reduce((sum, acc) => sum + acc.amountBase, 0))
    const liquidNW = Math.round(liquidAccounts.reduce((sum, acc) => sum + acc.amountBase, 0))
    const realEstateNW = Math.round(realEstateAccounts.reduce((sum, acc) => sum + acc.amountBase, 0))

    const incomeItems: AnnualItem[] = []
    const expenseItems: AnnualItem[] = []
    const taxItems: AnnualItem[] = []

    for (const p of pensions) {
      const count = monthsInYearWindow(p.startDate, p.endDate, y, flowFromMonth, flowThroughMonth, p.frequency)
      if (count > 0) incomeItems.push({ label: p.label, amount: p.amount * count, currency: p.currency })
    }
    for (const w of windfalls) {
      const count = monthsInYearWindow(w.date, w.endDate, y, flowFromMonth, flowThroughMonth, w.frequency ?? 'one_time')
      if (count > 0) incomeItems.push({ label: w.name, amount: w.amount * count, currency: w.currency })
    }
    for (const event of realEstateEvents) {
      const label = event.notes?.trim()
        || (event.eventType === 'sell' ? 'Property sale' : event.eventType === 'buy' ? 'Property purchase' : 'Real estate')
      if (event.isRecurring) {
        const count = monthsInYearWindow(event.date, event.endDate, y, flowFromMonth, flowThroughMonth, 'monthly')
        if (count > 0) expenseItems.push({ label, amount: event.amount * count, currency: event.currency })
        continue
      }
      const count = monthsInYearWindow(event.date, null, y, flowFromMonth, flowThroughMonth, 'one_time')
      if (count > 0 && event.eventType === 'sell') {
        incomeItems.push({ label, amount: event.amount, currency: event.currency })
      } else if (count > 0 && event.eventType === 'buy') {
        expenseItems.push({ label, amount: event.amount, currency: event.currency })
      }
    }
    if (y >= currentYear && annualProjectedDiv > 0) {
      const monthCount = Math.max(0, flowThroughMonth - flowFromMonth + 1)
      const dividendEstimate = y === currentYear ? annualProjectedDiv * monthCount / 12 : annualProjectedDiv
      if (dividendEstimate > 0) incomeItems.push({ label: 'Dividends (est.)', amount: dividendEstimate, currency: 'EUR' })
    }
    const activeAccounts = projectedAccountsBy(`${y}-12`, {
      accounts,
      realEstateEvents,
      transfers,
      expenses,
      medicalCoverages,
      medicalExpenses,
      pensions,
      windfalls,
      taxSettlements: taxConfig.settlements ?? [],
    })
    for (const acc of activeAccounts) {
      if (acc.interestRate && acc.interestRate > 0 && acc.balance > 0) {
        incomeItems.push({ label: `${acc.name} interest`, amount: acc.balance * acc.interestRate / 100, currency: acc.currency })
      }
      if (acc.dividends) {
        const annual = acc.dividends.filter(d => parseInt(d.date.split('-')[0]) === y).reduce((s, d) => s + d.amount, 0)
        if (annual > 0) incomeItems.push({ label: `${acc.name} dividends`, amount: annual, currency: acc.dividends[0]?.currency ?? acc.currency })
      }
    }
    for (const exp of allExp) {
      if (exp.frequency === 'custom' && exp.installments) {
        const amount = exp.installments
          .filter(inst => inst.date.slice(0, 4) === String(y))
          .filter(inst => {
            const month = Number(inst.date.slice(5, 7))
            return month >= flowFromMonth && month <= flowThroughMonth
          })
          .reduce((sum, inst) => sum + inst.amount, 0)
        if (amount > 0) expenseItems.push({ label: exp.name, amount, currency: exp.currency })
        continue
      }
      const count = monthsInYearWindow(exp.startDate, exp.endDate, y, flowFromMonth, flowThroughMonth, exp.frequency)
      if (count > 0) expenseItems.push({ label: exp.name, amount: exp.amount * count, currency: exp.currency })
    }
    const transferItems = annualTransferFlowItems(y, accounts, transfers, flowFromMonth, flowThroughMonth)
    incomeItems.push(...transferItems.incomeItems)
    expenseItems.push(...transferItems.expenseItems)

    const income = Math.round(incomeItems.reduce((s, it) => s + convertToBase(it.amount, it.currency, displayCurrency, fxRate), 0))
    const expense = Math.round(expenseItems.reduce((s, it) => s + convertToBase(it.amount, it.currency, displayCurrency, fxRate), 0))
    const taxEstimate = estimateAnnualIncomeTaxes({
      year: y - 1,
      profile,
      taxConfig,
      pensions,
      windfalls,
      accounts: activeAccounts,
    })
    const modeledTaxItems = taxEstimate.items.map(item => ({
      ...item,
      label: `${item.label} (${y - 1})`,
    }))
    const scheduledTaxItems = annualQuarterlyTaxPaymentItems(taxConfig, y)
    const settlementTaxItems = taxSettlementItemsForYear(taxConfig, y)
    const modeledTax = Math.round(displayFromEUR(taxEstimate.totalEUR))
    const scheduledTax = Math.round(scheduledTaxItems.reduce(
      (s, it) => s + convertToBase(it.amount, it.currency, displayCurrency, fxRate),
      0,
    ))
    const baseTaxItems = scheduledTax > modeledTax ? scheduledTaxItems : modeledTaxItems
    taxItems.push(...baseTaxItems, ...settlementTaxItems)
    const settlementTax = Math.round(settlementTaxItems.reduce(
      (s, it) => s + convertToBase(it.amount, it.currency, displayCurrency, fxRate),
      0,
    ))
    const tax = Math.max(modeledTax, scheduledTax) + settlementTax
    const netCashFlow = Math.round(income - expense - tax)

    return {
      label: String(y),
      median,
      liquidNW,
      liquidP10: liquidNW,
      liquidP90: liquidNW,
      realEstateNW,
      bandBase: liquidNW,
      bandSize: 0,
      medianBandSize: 0,
      upperBandSize: 0,
      events: eventsByYear[y] ?? [],
      income, expense, tax,
      netCashFlow,
      transfersEvents: null,
      portfolioGrowth: null,
      incomeItems, expenseItems, taxItems,
      portfolioGrowthItems: [],
      accounts: projectedAccounts,
    }
  })

  const startingProjectedAccounts: ProjectedAccount[] = accounts
    .filter(account => account.type !== 'credit')
    .map(account => ({
      id: account.id,
      name: account.name,
      type: account.type,
      currency: account.currency,
      amountBase: convertToBase(account.balance, account.currency, displayCurrency, fxRate),
      amountNative: account.balance,
    }))
  const ytdIncomeItems: AnnualItem[] = []
  const ytdExpenseItems: AnnualItem[] = []
  const ytdTaxItems: AnnualItem[] = []
  for (const p of pensions) {
    const count = elapsedMonthsInYear(p.startDate, p.endDate, currentYear, currentMonthNumber, p.frequency)
    if (count > 0) ytdIncomeItems.push({ label: p.label, amount: p.amount * count, currency: p.currency })
  }
  for (const w of windfalls) {
    const count = elapsedMonthsInYear(w.date, w.endDate, currentYear, currentMonthNumber, w.frequency ?? 'one_time')
    if (count > 0) ytdIncomeItems.push({ label: w.name, amount: w.amount * count, currency: w.currency })
  }
  for (const event of realEstateEvents) {
    const label = event.notes?.trim()
      || (event.eventType === 'sell' ? 'Property sale' : event.eventType === 'buy' ? 'Property purchase' : 'Real estate')
    if (event.isRecurring) {
      const count = elapsedMonthsInYear(event.date, event.endDate, currentYear, currentMonthNumber, 'monthly')
      if (count > 0) ytdExpenseItems.push({ label, amount: event.amount * count, currency: event.currency })
    } else {
      const count = elapsedMonthsInYear(event.date, null, currentYear, currentMonthNumber, 'one_time')
      if (count > 0 && event.eventType === 'sell') ytdIncomeItems.push({ label, amount: event.amount, currency: event.currency })
      else if (count > 0 && event.eventType === 'buy') ytdExpenseItems.push({ label, amount: event.amount, currency: event.currency })
    }
  }
  for (const exp of allExp) {
    if (exp.frequency === 'custom' && exp.installments) {
      const amount = exp.installments
        .filter(inst => inst.date.slice(0, 4) === String(currentYear) && Number(inst.date.slice(5, 7)) <= currentMonthNumber)
        .reduce((sum, inst) => sum + inst.amount, 0)
      if (amount > 0) ytdExpenseItems.push({ label: exp.name, amount, currency: exp.currency })
      continue
    }
    const count = elapsedMonthsInYear(exp.startDate, exp.endDate, currentYear, currentMonthNumber, exp.frequency)
    if (count > 0) ytdExpenseItems.push({ label: exp.name, amount: exp.amount * count, currency: exp.currency })
  }
  for (const acc of accounts) {
    if (acc.interestRate && acc.interestRate > 0 && acc.balance > 0) {
      ytdIncomeItems.push({ label: `${acc.name} interest`, amount: acc.balance * acc.interestRate / 100 * (currentMonthNumber / 12), currency: acc.currency })
    }
    if (acc.dividends) {
      const dividends = acc.dividends.filter(d => (
        d.date.slice(0, 4) === String(currentYear) &&
        Number(d.date.slice(5, 7)) <= currentMonthNumber
      ))
      const annual = dividends.reduce((s, d) => s + d.amount, 0)
      if (annual > 0) ytdIncomeItems.push({ label: `${acc.name} dividends`, amount: annual, currency: dividends[0]?.currency ?? acc.currency })
    }
  }
  const ytdTransferItems = ytdTransferFlowItems(currentYear, currentMonthNumber, accounts, transfers)
  ytdIncomeItems.push(...ytdTransferItems.incomeItems)
  ytdExpenseItems.push(...ytdTransferItems.expenseItems)
  ytdTaxItems.push(...ytdQuarterlyTaxPaymentItems(taxConfig, currentYear, currentMonthNumber))
  ytdTaxItems.push(...taxSettlementItemsForYear(taxConfig, currentYear, currentMonthNumber))
  const ytdIncome = Math.round(ytdIncomeItems.reduce((s, it) => s + convertToBase(it.amount, it.currency, displayCurrency, fxRate), 0))
  const ytdExpense = Math.round(ytdExpenseItems.reduce((s, it) => s + convertToBase(it.amount, it.currency, displayCurrency, fxRate), 0))
  const ytdTax = Math.round(ytdTaxItems.reduce((s, it) => s + convertToBase(it.amount, it.currency, displayCurrency, fxRate), 0))
  const ytdLiquidNW = Math.round(startingProjectedAccounts.filter(account => isLiquidType(account.type)).reduce((sum, account) => sum + account.amountBase, 0))
  const ytdRealEstateNW = Math.round(startingProjectedAccounts.filter(account => account.type === 'real_estate').reduce((sum, account) => sum + account.amountBase, 0))
  const ytdRow: LifetimePoint & { withdrawal: number } = {
    label: 'YTD',
    median: ytdLiquidNW + ytdRealEstateNW,
    liquidNW: ytdLiquidNW,
    liquidP10: ytdLiquidNW,
    liquidP90: ytdLiquidNW,
    realEstateNW: ytdRealEstateNW,
    bandBase: ytdLiquidNW,
    bandSize: 0,
    medianBandSize: 0,
    upperBandSize: 0,
    events: eventsByYear[currentYear] ?? [],
    income: ytdIncome,
    expense: ytdExpense,
    tax: ytdTax,
    netCashFlow: ytdIncome - ytdExpense - ytdTax,
    transfersEvents: null,
    portfolioGrowth: 0,
    withdrawal: ytdExpense + ytdTax - ytdIncome,
    incomeItems: ytdIncomeItems,
    expenseItems: ytdExpenseItems,
    taxItems: ytdTaxItems,
    portfolioGrowthItems: [],
    accounts: startingProjectedAccounts,
  }
  const currentLiquidNW = Math.round(startingProjectedAccounts
    .filter(account => isLiquidType(account.type))
    .reduce((sum, account) => sum + account.amountBase, 0))
  const startOfYearLiquidNW = Math.max(0, Math.round(currentLiquidNW - (ytdRow.netCashFlow ?? 0)))
  let runningLiquidNW = startOfYearLiquidNW
  let runningAccounts = reconcileProjectedAccounts(startingProjectedAccounts, startOfYearLiquidNW, ytdRealEstateNW)
  const extendedData = detailData.map((pt) => {
    const withdrawal = (pt.expense ?? 0) + (pt.tax ?? 0) - (pt.income ?? 0)
    const portfolioGrowthItems = portfolioGrowthBreakdown(runningAccounts, accounts, projectionAssumptions, displayCurrency)
    const portfolioGrowth = Math.round(portfolioGrowthItems.reduce((sum, item) => sum + item.amount, 0))
    const netCashFlow = Math.round((pt.netCashFlow ?? 0) + portfolioGrowth)
    const liquidNW = Math.round(runningLiquidNW + netCashFlow)
    const median = Math.round(liquidNW + pt.realEstateNW)
    const reconciledAccounts = reconcileProjectedAccounts(pt.accounts, liquidNW, pt.realEstateNW)
    const row = {
      ...pt,
      median,
      liquidNW,
      liquidP10: liquidNW,
      liquidP90: liquidNW,
      bandBase: liquidNW,
      withdrawal,
      portfolioGrowth,
      portfolioGrowthItems,
      netCashFlow,
      accounts: reconciledAccounts,
    }
    runningLiquidNW = liquidNW
    runningAccounts = reconciledAccounts
    return row
  })
  const deterministicTableData = [ytdRow, ...extendedData]

  const firstYear = result.years[0]
  const ticks = [firstYear, ...result.years.filter(y => y % 5 === 0 && y !== firstYear)].map(String)
  const cohortSummaries = result.cohortSummaries ?? []
  const selectedCohort = cohortSummaries.find(cohort => cohort.startMonth === selectedCohortStart) ?? cohortSummaries[0]

  useEffect(() => {
    if (openCohortsRequest > 0) setShowCohorts(true)
  }, [openCohortsRequest])

  function toggleSeries(key: string) {
    setSelectedSeries(current => {
      const next = current.includes(key) ? current.filter(k => k !== key) : [...current, key]
      try { localStorage.setItem('dinner-money:deterministic-projection-series', JSON.stringify(next)) } catch {}
      return next
    })
  }

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex justify-between items-center mb-4">
          <div className="flex items-center gap-1.5">
            <span className="text-[12.5px] font-semibold text-gray-700 dark:text-gray-200">Historical projection</span>
            <InfoTooltip interactive text={
              <div className="space-y-2">
                <div>Liquid net worth projection via historical sequential backtesting. Each cohort follows actual month-by-month historical returns, CPI, yields, and FX inputs where available.</div>
                <div className="font-semibold">Sources</div>
                <SourceTooltip sources={result.dataSources ?? []} />
              </div>
            } />
          </div>
          <button
            onClick={() => setShowSimSettings(v => !v)}
            aria-label="Simulation settings"
            className={`p-[5px] rounded-[4px] transition-colors ${showSimSettings ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400' : 'text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-600 dark:hover:text-gray-300'}`}
          >
            <Settings2 size={14} />
          </button>
        </div>

        {showSimSettings && (
          <SimulationSettingsPanel config={config} onApply={(c) => { onApplySettings(c); setShowSimSettings(false) }} onCancel={() => setShowSimSettings(false)} running={running} />
        )}

        <ResponsiveContainer width="100%" height={260}>
          <ComposedChart data={simulationData} margin={{ top: 4, right: 0, left: 14, bottom: 0 }}>
            <defs>
              <linearGradient id="lowerBandGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#ef4444" stopOpacity={0.3} />
                <stop offset="100%" stopColor="#ef4444" stopOpacity={0.12} />
              </linearGradient>
              <linearGradient id="medianBandGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.16} />
                <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.05} />
              </linearGradient>
              <linearGradient id="upperBandGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#22c55e" stopOpacity={0.18} />
                <stop offset="100%" stopColor="#22c55e" stopOpacity={0.05} />
              </linearGradient>
            </defs>
            <XAxis dataKey="label" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} ticks={ticks} padding={{ left: 28, right: 8 }} />
            <YAxis domain={[0, (dataMax: number) => dataMax]} tickFormatter={(v) => formatCompact(v, displayCurrency)} tick={{ fontSize: 10 }} tickLine={false} axisLine={false} width={48} />
            <Tooltip content={<LifetimeTooltip currency={displayCurrency} />} wrapperStyle={{ zIndex: 70 }} />
            {eventMarkers.map(marker => (
              <ReferenceLine
                key={marker.year}
                x={String(marker.year)}
                stroke={marker.events[0]?.color ?? '#64748b'}
                strokeDasharray="3 3"
                strokeWidth={1.5}
                label={<EventMarkerLabel events={marker.events} />}
              />
            ))}
            <Area type="monotone" dataKey="liquidP10" stackId="band" stroke="none" fill="url(#lowerBandGrad)" legendType="none" />
            <Area type="monotone" dataKey="medianBandSize" stackId="band" stroke="none" fill="url(#medianBandGrad)" legendType="none" />
            <Area type="monotone" dataKey="upperBandSize" stackId="band" stroke="none" fill="url(#upperBandGrad)" legendType="none" />
            <Line type="monotone" dataKey="liquidP90" stroke="#16a34a" strokeWidth={1.5} dot={false} legendType="none" />
            <Line type="monotone" dataKey="liquidNW" stroke="#3b82f6" strokeWidth={2} dot={false} legendType="none" />
            <Line type="monotone" dataKey="liquidP10" stroke="#dc2626" strokeWidth={1.5} dot={false} legendType="none" />
          </ComposedChart>
        </ResponsiveContainer>
        <div className="relative z-0 mt-2 flex flex-wrap items-center justify-end gap-x-4 gap-y-1 text-[10.5px] text-gray-500 dark:text-gray-400">
          {(result.warnings ?? []).length > 0 && (
            <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
              <span>{result.warnings?.length} warnings</span>
              <InfoTooltip text={<AssumptionsTooltip assumptions={result.warnings ?? []} />} position="left" />
            </span>
          )}
        </div>
        {showCohorts && selectedCohort && (
          <CohortDetailsModal
            cohort={selectedCohort}
            cohorts={cohortSummaries}
            onSelect={setSelectedCohortStart}
            onClose={() => setShowCohorts(false)}
            currency={displayCurrency}
            fxRate={fxRate}
          />
        )}
      </Card>

      <Card>
        <div className="flex justify-between items-center mb-4">
          <div className="flex items-center gap-1.5">
            <span className="text-[12.5px] font-semibold text-gray-700 dark:text-gray-200">Deterministic projection</span>
            <InfoTooltip text="Year-by-year deterministic projection from current account balances and the assumptions in this panel. Click column headers to toggle chart series." />
          </div>
          <button
            onClick={() => setShowProjectionSettings(v => !v)}
            aria-label="Projection detail assumptions"
            className={`p-[5px] rounded-[4px] transition-colors ${showProjectionSettings ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400' : 'text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-600 dark:hover:text-gray-300'}`}
          >
            <Settings2 size={14} />
          </button>
        </div>

        {showProjectionSettings && (
          <ProjectionAssumptionsPanel
            assumptions={projectionAssumptions}
            onApply={(next) => { setProjectionAssumptions(next); setShowProjectionSettings(false) }}
            onCancel={() => setShowProjectionSettings(false)}
          />
        )}

        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={extendedData} margin={{ top: 10, right: 0, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#374151" opacity={0.2} />
            <XAxis dataKey="label" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} ticks={ticks} />
            <YAxis tickFormatter={(v) => formatCompact(v, displayCurrency)} tick={{ fontSize: 10 }} tickLine={false} axisLine={false} width={48} />
            <Tooltip content={<ProjectionDetailsTooltip currency={displayCurrency} />} />
            {SERIES_DEF.filter(s => selectedSeries.includes(s.key)).map(s => (
              <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={s.color} strokeWidth={2} dot={false} />
            ))}
          </LineChart>
        </ResponsiveContainer>

        <div className="overflow-x-auto mt-6">
          <table className="w-full text-[11px] text-left">
             <thead>
               <tr className="border-b border-gray-100 dark:border-gray-800 text-gray-500 dark:text-gray-400">
                 <th className="py-2 px-2 font-medium">Year</th>
                 <th className="py-2 px-2 font-medium">Your age</th>
                 <th className="py-2 px-2 font-medium">Spouse age</th>
                 <th className="py-2 px-2 font-medium cursor-pointer select-none hover:text-gray-700 dark:hover:text-gray-200"
                     onClick={() => toggleSeries('median')}>
                   <div className="flex items-center justify-end gap-1.5">
                     <ToggleDot seriesKey="median" selected={selectedSeries.includes('median')} />
                     Total NW
                   </div>
                 </th>
                 <th className="py-2 px-2 font-medium cursor-pointer select-none hover:text-gray-700 dark:hover:text-gray-200"
                     onClick={() => toggleSeries('liquidNW')}>
                   <div className="flex items-center justify-end gap-1.5">
                     <ToggleDot seriesKey="liquidNW" selected={selectedSeries.includes('liquidNW')} />
                     Liquid NW
                   </div>
                 </th>
                 <th className="py-2 px-2 font-medium cursor-pointer select-none hover:text-gray-700 dark:hover:text-gray-200"
                     onClick={() => toggleSeries('realEstateNW')}>
                   <div className="flex items-center justify-end gap-1.5">
                     <ToggleDot seriesKey="realEstateNW" selected={selectedSeries.includes('realEstateNW')} />
                     Real Estate NW
                   </div>
                 </th>
                 <th className="py-2 px-2 font-medium cursor-pointer select-none hover:text-gray-700 dark:hover:text-gray-200"
                     onClick={() => toggleSeries('income')}>
                   <div className="flex items-center justify-end gap-1.5">
                     <ToggleDot seriesKey="income" selected={selectedSeries.includes('income')} />
                     Income
                   </div>
                 </th>
                 <th className="py-2 px-2 font-medium cursor-pointer select-none hover:text-gray-700 dark:hover:text-gray-200"
                     onClick={() => toggleSeries('portfolioGrowth')}>
                   <div className="flex items-center justify-end gap-1.5">
                     <ToggleDot seriesKey="portfolioGrowth" selected={selectedSeries.includes('portfolioGrowth')} />
                     Portfolio growth
                   </div>
                 </th>
                 <th className="py-2 px-2 font-medium cursor-pointer select-none hover:text-gray-700 dark:hover:text-gray-200"
                     onClick={() => toggleSeries('expense')}>
                   <div className="flex items-center justify-end gap-1.5">
                     <ToggleDot seriesKey="expense" selected={selectedSeries.includes('expense')} />
                     Expenses
                   </div>
                 </th>
                 <th className="py-2 px-2 font-medium cursor-pointer select-none hover:text-gray-700 dark:hover:text-gray-200"
                     onClick={() => toggleSeries('tax')}>
                   <div className="flex items-center justify-end gap-1.5">
                     <ToggleDot seriesKey="tax" selected={selectedSeries.includes('tax')} />
                     Tax
                   </div>
                 </th>
                 <th className="py-2 px-2 font-medium cursor-pointer select-none hover:text-gray-700 dark:hover:text-gray-200"
                     onClick={() => toggleSeries('netCashFlow')}>
                   <div className="flex items-center justify-end gap-1.5">
                     <ToggleDot seriesKey="netCashFlow" selected={selectedSeries.includes('netCashFlow')} />
                     Net
                   </div>
                 </th>
                 <th className="py-2 px-2 font-medium cursor-pointer select-none hover:text-gray-700 dark:hover:text-gray-200"
                     onClick={() => toggleSeries('withdrawal')}>
                   <div className="flex items-center justify-end gap-1.5">
                     <ToggleDot seriesKey="withdrawal" selected={selectedSeries.includes('withdrawal')} />
                     Withdrawal
                   </div>
                 </th>
               </tr>
             </thead>
             <tbody>
               {deterministicTableData.map((row, i) => {
                 const isYtd = row.label === 'YTD'
                 const rowYear = isYtd ? currentYear : parseInt(row.label)
                 const yourAge = rowYear - profile.birthYear
                 const spouseAge = rowYear - profile.spouseBirthYear
                 const isPositiveYear = row.withdrawal < 0
                 return (
                   <tr key={`${row.label}-${i}`} className={`border-b border-gray-50 dark:border-gray-800/50 hover:bg-gray-50 dark:hover:bg-gray-800/50 ${isYtd ? 'bg-blue-50/40 dark:bg-blue-950/10' : ''}`}>
                     <td className="py-1.5 px-2">{row.label}</td>
                     <td className="py-1.5 px-2">{yourAge}</td>
                     <td className="py-1.5 px-2">{spouseAge}</td>
                     {/* Total NW */}
                     <td className="py-1.5 px-2 text-right font-medium group relative cursor-help whitespace-nowrap">
                       {formatCurrency(row.median, displayCurrency)}
                       <div className={`absolute ${tooltipPos(i)} right-0 hidden group-hover:block z-20`}>
                         <NWDetailsTooltip
                           title={`Total NW - ${row.label}`}
                           accounts={accountListForTooltip(row.accounts, minTransactionEUR)}
                           total={row.median}
                           currency={displayCurrency}
                         />
                       </div>
                     </td>
                     {/* Liquid NW */}
                     <td className="py-1.5 px-2 text-right group relative cursor-help whitespace-nowrap">
                       {formatCurrency(row.liquidNW, displayCurrency)}
                       <div className={`absolute ${tooltipPos(i)} right-0 hidden group-hover:block z-20`}>
                         <NWDetailsTooltip
                           title={`Liquid NW - ${row.label}`}
                           accounts={accountListForTooltip(
                             row.accounts.filter(a => ['cash', 'investment', 'retirement'].includes(a.type)),
                             minTransactionEUR,
                           )}
                           total={row.liquidNW}
                           currency={displayCurrency}
                         />
                       </div>
                     </td>
                     {/* Real Estate NW */}
                     <td className="py-1.5 px-2 text-right group relative cursor-help whitespace-nowrap">
                       {formatCurrency(row.realEstateNW, displayCurrency)}
                       <div className={`absolute ${tooltipPos(i)} right-0 hidden group-hover:block z-20`}>
                         <NWDetailsTooltip
                           title={`Real Estate NW - ${row.label}`}
                           accounts={accountListForTooltip(
                             row.accounts.filter(a => a.type === 'real_estate'),
                             minTransactionEUR,
                           )}
                           total={row.realEstateNW}
                           currency={displayCurrency}
                         />
                       </div>
                     </td>
                     {/* Income */}
                     <td className="py-1.5 px-2 text-right group relative cursor-help text-green-600 dark:text-green-400 whitespace-nowrap">
                        {row.income ? formatCurrency(row.income, displayCurrency) : '—'}
                        {row.incomeItems.length > 0 && (
                          <div className={`absolute ${tooltipPos(i)} right-0 hidden group-hover:block z-20`}>
                            <IncomeExpenseTooltip items={row.incomeItems} type="Income" minTx={minTransactionEUR} year={row.label} />
                          </div>
                        )}
                     </td>
                     <td className={`py-1.5 px-2 text-right tabular-nums group relative cursor-help whitespace-nowrap ${signedClass(row.portfolioGrowth)}`}>
                       {formatSignedCurrency(row.portfolioGrowth, displayCurrency)}
                       <div className={`absolute ${tooltipPos(i)} right-0 hidden group-hover:block z-20`}>
                         <PortfolioGrowthTooltip row={row} currency={displayCurrency} minTx={minTransactionEUR} />
                       </div>
                     </td>
                     {/* Expenses */}
                     <td className="py-1.5 px-2 text-right group relative cursor-help text-red-500 dark:text-red-400 whitespace-nowrap">
                        {row.expense ? formatCurrency(row.expense, displayCurrency) : '—'}
                        {row.expenseItems.length > 0 && (
                          <div className={`absolute ${tooltipPos(i)} right-0 hidden group-hover:block z-20`}>
                            <IncomeExpenseTooltip items={row.expenseItems} type="Expenses" minTx={minTransactionEUR} year={row.label} />
                          </div>
                        )}
                     </td>
                     {/* Tax */}
                     <td className="py-1.5 px-2 text-right group relative cursor-help text-red-500 dark:text-red-400 whitespace-nowrap">
                        {row.tax ? formatCurrency(row.tax, displayCurrency) : '—'}
                        {row.taxItems.length > 0 && (
                          <div className={`absolute ${tooltipPos(i)} right-0 hidden group-hover:block z-20`}>
                            <IncomeExpenseTooltip items={row.taxItems} type="Taxes" minTx={minTransactionEUR} year={row.label} />
                          </div>
                        )}
                     </td>
                     <td className={`py-1.5 px-2 text-right tabular-nums group relative cursor-help whitespace-nowrap ${signedClass(row.netCashFlow)}`}>
                       {formatSignedCurrency(row.netCashFlow, displayCurrency)}
                       <div className={`absolute ${tooltipPos(i)} right-0 hidden group-hover:block z-20`}>
                         <NetTooltip row={row} currency={displayCurrency} />
                       </div>
                     </td>
                     {/* Withdrawal */}
                     <td className="py-1.5 px-2 text-right text-blue-600 dark:text-blue-400">
                       {isPositiveYear ? (
                         <span className="relative group inline-flex items-center justify-end gap-1 text-green-500 dark:text-green-400 cursor-help">
                           <CheckCircle2 size={13} />
                           <span className="absolute bottom-full right-0 mb-1.5 w-64 bg-gray-900 dark:bg-gray-700 text-white text-[10px] leading-[1.4] px-2.5 py-2 rounded-lg shadow-xl opacity-0 group-hover:opacity-100 pointer-events-none z-30 whitespace-normal text-left font-normal transition-opacity duration-100">
                             Income exceeds expenses for this year, so no portfolio withdrawal is needed.
                           </span>
                         </span>
                       ) : (
                         row.withdrawal ? formatCurrency(row.withdrawal, displayCurrency) : '—'
                       )}
                     </td>
                   </tr>
                 )
               })}
             </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function Overview() {
  const {
    accounts, simulationResult, simulationRunning, setSimulationRunning, setSimulationResult,
    profile, expenses, medicalCoverages, medicalExpenses, pensions, windfalls, realEstateEvents,
    monteCarloConfig, taxConfig, setMonteCarloConfig, minTransactionEUR, tiingoApiKey, fredApiKey, lmProxyUrl, transfers,
    liveEurUsdRate,
  } = useAppStore()
  const [simulationError, setSimulationError] = useState<string | null>(null)
  const [simulationProgress, setSimulationProgress] = useState<SimulationProgress | null>(null)
  const [displayProgressPct, setDisplayProgressPct] = useState<number | null>(null)
  const [simulationPending, setSimulationPending] = useState(false)
  const [openCohortsRequest, setOpenCohortsRequest] = useState(0)
  const didMountRef = useRef(false)
  const runStartedAtRef = useRef<number | null>(null)

  const today = new Date()
  const currentMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`
  const includedAccounts = useMemo(() => projectedAccountsBy(currentMonth, {
    accounts,
    realEstateEvents,
    transfers,
    expenses,
    medicalCoverages: medicalCoverages ?? [],
    medicalExpenses: medicalExpenses ?? [],
    pensions,
    windfalls,
    taxSettlements: taxConfig.settlements ?? [],
  }), [accounts, currentMonth, expenses, medicalCoverages, medicalExpenses, pensions, realEstateEvents, taxConfig.settlements, transfers, windfalls])
  const simulationCacheInput = useMemo(() => ({
    config: monteCarloConfig,
    taxConfig,
    profile,
    accounts: includedAccounts.map(accountSignature).sort((a, b) => a.id - b.id),
    expenses,
    medicalCoverages,
    medicalExpenses,
    pensions,
    windfalls,
    realEstateEvents,
    transfers,
    currentMonth,
  }), [
    currentMonth,
    expenses,
    includedAccounts,
    medicalCoverages,
    medicalExpenses,
    monteCarloConfig,
    taxConfig,
    pensions,
    profile,
    realEstateEvents,
    transfers,
    windfalls,
  ])
  const currentSimulationCacheKey = useMemo(() => simulationCacheKey(simulationCacheInput), [simulationCacheInput])

  const netWorth = includedAccounts.reduce((sum, acc) => {
    return sum + convertToBase(acc.balance, acc.currency, profile.baseCurrency, liveEurUsdRate)
  }, 0)
  const liquidNetWorth = includedAccounts
    .filter(acc => ['cash', 'investment', 'retirement'].includes(acc.type))
    .reduce((sum, acc) => sum + convertToBase(acc.balance, acc.currency, profile.baseCurrency, liveEurUsdRate), 0)
  const lastResultIndex = resultIndex(simulationResult)
  const resultSpread = simulationResult && lastResultIndex >= 0
    ? {
      p75: convertToBase(Math.max(0, (simulationResult.p90NetWorth[lastResultIndex] ?? 0) - (simulationResult.realEstateNetWorth[lastResultIndex] ?? 0)), 'EUR', profile.baseCurrency, liveEurUsdRate),
      median: convertToBase(Math.max(0, (simulationResult.medianNetWorth[lastResultIndex] ?? 0) - (simulationResult.realEstateNetWorth[lastResultIndex] ?? 0)), 'EUR', profile.baseCurrency, liveEurUsdRate),
      p10: convertToBase(Math.max(0, (simulationResult.p10NetWorth[lastResultIndex] ?? 0) - (simulationResult.realEstateNetWorth[lastResultIndex] ?? 0)), 'EUR', profile.baseCurrency, liveEurUsdRate),
    }
    : null
  const safeMonthlySpendBase = simulationResult
    ? convertToBase(simulationResult.safeMonthlySpend, 'EUR', profile.baseCurrency, liveEurUsdRate)
    : null

  async function runSimulation(overrideConfig?: MonteCarloConfig) {
    const configToUse = overrideConfig || monteCarloConfig
    if (overrideConfig) {
      setMonteCarloConfig(overrideConfig)
    }
    const cacheInput = overrideConfig
      ? { ...simulationCacheInput, config: configToUse }
      : simulationCacheInput
    const cacheKey = simulationCacheKey(cacheInput)
    const memoryCached = simulationMemoryCache.get(cacheKey)
    if (memoryCached) {
      setSimulationResult(memoryCached)
      setSimulationRunning(false)
      runStartedAtRef.current = null
      setSimulationPending(false)
      setSimulationProgress(null)
      setDisplayProgressPct(null)
      return
    }
    try {
      const cached = localStorage.getItem(cacheKey)
      if (cached) {
        const parsed = JSON.parse(cached) as SimulationResult
        simulationMemoryCache.set(cacheKey, parsed)
        setSimulationResult(parsed)
        setSimulationRunning(false)
        runStartedAtRef.current = null
        setSimulationPending(false)
        setSimulationProgress(null)
        setDisplayProgressPct(null)
        return
      }
    } catch {
      // Cache is best effort.
    }
    setSimulationRunning(true)
    runStartedAtRef.current = Date.now()
    setSimulationError(null)
    setSimulationPending(false)
    setDisplayProgressPct(0)
    setSimulationProgress({ phase: 'loading historical data', completed: 0, total: 100 })
    let worker: Worker | null = null
    try {
      const historicalMarketData = await loadHistoricalMarketData(includedAccounts, tiingoApiKey, fredApiKey, lmProxyUrl)
      worker = new Worker(new URL('../workers/montecarlo.worker.ts', import.meta.url), { type: 'module' })
      worker.postMessage({
        config: configToUse,
        taxConfig,
        profile,
        accounts: includedAccounts,
        expenses: [...expenses, ...(medicalCoverages ?? []), ...(medicalExpenses ?? [])],
        pensions,
        windfalls,
        realEstateEvents,
        transfers,
        eurUsdSpot: liveEurUsdRate,
        historicalMarketData,
      })
      worker.onmessage = (e) => {
        if (e.data.progress) {
          const progress = e.data.progress as SimulationProgress
          setSimulationProgress(progress)
          setDisplayProgressPct(current => Math.max(current ?? 0, Math.round(progress.completed / Math.max(1, progress.total) * 100)))
          return
        }
        if (e.data.ok) {
          const result = e.data.result as SimulationResult
          simulationMemoryCache.set(cacheKey, result)
          setSimulationResult(result)
          setSimulationPending(false)
          setSimulationProgress(null)
          setDisplayProgressPct(null)
          try {
            localStorage.setItem(cacheKey, JSON.stringify(result))
            localStorage.setItem(SIMULATION_LATEST_CACHE_KEY, JSON.stringify({ key: cacheKey }))
          } catch {}
        } else {
          console.warn('[Overview] Historical simulation failed:', e.data.error)
          setSimulationError(String(e.data.error ?? 'Historical simulation failed.'))
          setSimulationPending(false)
          setSimulationProgress(null)
          setDisplayProgressPct(null)
        }
        setSimulationRunning(false)
        runStartedAtRef.current = null
        worker?.terminate()
      }
      worker.onerror = (err) => {
        console.warn('[Overview] Historical simulation worker error:', err.message)
        setSimulationError(err.message || 'Historical simulation worker failed.')
        setSimulationPending(false)
        setSimulationProgress(null)
        setDisplayProgressPct(null)
        setSimulationRunning(false)
        runStartedAtRef.current = null
        worker?.terminate()
      }
    } catch (err) {
      console.warn('[Overview] Historical data load failed:', err)
      setSimulationError(err instanceof Error ? err.message : String(err))
      setSimulationPending(false)
      setSimulationProgress(null)
      setDisplayProgressPct(null)
      setSimulationRunning(false)
      runStartedAtRef.current = null
      worker?.terminate()
    }
  }

  useEffect(() => {
    if (accounts.length === 0 || simulationResult) return
    try {
      const memoryCached = simulationMemoryCache.get(currentSimulationCacheKey)
      if (memoryCached) {
        setSimulationResult(memoryCached)
        setSimulationRunning(false)
        runStartedAtRef.current = null
        setSimulationPending(false)
        setSimulationProgress(null)
        setDisplayProgressPct(null)
        return
      }
      const latest = JSON.parse(localStorage.getItem(SIMULATION_LATEST_CACHE_KEY) ?? '{}') as { key?: string }
      const cached = latest.key === currentSimulationCacheKey
        ? localStorage.getItem(currentSimulationCacheKey)
        : localStorage.getItem(currentSimulationCacheKey)
      if (cached) {
        const parsed = JSON.parse(cached) as SimulationResult
        simulationMemoryCache.set(currentSimulationCacheKey, parsed)
        setSimulationResult(parsed)
        setSimulationRunning(false)
        runStartedAtRef.current = null
        setSimulationPending(false)
        setSimulationProgress(null)
        setDisplayProgressPct(null)
        return
      }
    } catch {
      // Cache is best effort.
    }
    const staleRunning = simulationRunning && runStartedAtRef.current == null
    if (!simulationRunning || simulationPending || staleRunning) {
      if (staleRunning) setSimulationRunning(false)
      runSimulation()
    }
  }, [accounts.length, currentSimulationCacheKey, simulationPending, simulationRunning, simulationResult]) // eslint-disable-line

  useEffect(() => {
    if (!didMountRef.current) {
      didMountRef.current = true
      return
    }
    setSimulationPending(true)
    setSimulationError(null)
    setDisplayProgressPct(null)
    setSimulationResult(null)
  }, [
    profile.birthYear,
    profile.spouseBirthYear,
    profile.projectionEndAge,
    profile.spouseProjectionEndAge,
    monteCarloConfig.successThreshold,
    monteCarloConfig.frenchTaxRate,
    monteCarloConfig.taxableWithdrawalShare,
    monteCarloConfig.annualTaxAllowanceEUR,
    monteCarloConfig.cashYieldMultiplier,
    taxConfig.taxProfile,
    taxConfig.quarterlyPayments,
    taxConfig.stateQuarterlyPayments,
    transfers,
    realEstateEvents,
  ])

  const result = simulationResult
  const progressPct = displayProgressPct
  const rerunMessage = progressPct != null && simulationProgress
    ? `Re-running historical projection: ${simulationProgress.phase}`
    : 'Re-running the historical projection because an input changed…'
  const historicalCohortSub = result?.cohortCount
    ? (
      <span className="inline-flex items-center gap-1">
        <span>based on</span>
        <button
          type="button"
          onClick={() => setOpenCohortsRequest(count => count + 1)}
          className="text-blue-600 dark:text-blue-400 hover:underline"
          aria-label="Show cohort inputs"
        >
          {result.cohortCount.toLocaleString()}
        </button>
        <span>historical cohorts from {result.historicalStartMonth?.slice(0, 4) ?? '—'} to {result.historicalEndMonth?.slice(0, 4) ?? '—'}</span>
      </span>
    )
    : 'Historical cohorts'

  return (
    <div>
      <PageHeader title="Lifetime projection" />

      <div className="p-4 space-y-4">
        {simulationError && (
          <Banner variant="warning">
            Historical projection could not run: {simulationError}
          </Banner>
        )}
        {!simulationError && accounts.length > 0 && (simulationRunning || simulationPending) && !result ? (
          <SimulationProgressState message={rerunMessage} progressPct={progressPct} />
        ) : !simulationError && accounts.length > 0 && !simulationRunning && !simulationPending && !result ? (
          <Card>
            <div className="h-[200px] flex items-center justify-center text-[13px] text-gray-400">
              Historical projection unavailable
            </div>
          </Card>
        ) : result ? (
          <>
            <div className="grid grid-cols-4 gap-[9px]">
              <MetricCard
                label="Success probability"
                value={`${result.successRate.toFixed(0)}%`}
                sub={historicalCohortSub}
                valueClass={result.successRate >= 85 ? 'text-green-600' : 'text-amber-500'}
                tooltip="Share of historical starting-month cohorts that completed the full retirement duration without depleting liquid portfolio assets."
              />
              <MetricCard
                label="Liquid NW today"
                value={liquidNetWorth > 0 ? formatCompact(liquidNetWorth, profile.baseCurrency) : '—'}
                sub={`Total ${netWorth > 0 ? formatCompact(netWorth, profile.baseCurrency) : '—'}`}
                tooltip="Current planning net worth from included accounts, converted to the base currency at the app spot rate."
              />
              <MetricCard
                label={`Liquid NW in ${result.years[result.years.length - 1] ?? 'last year'}`}
                value={resultSpread ? `${formatCompact(resultSpread.p10, profile.baseCurrency)} / ${formatCompact(resultSpread.median, profile.baseCurrency)} / ${formatCompact(resultSpread.p75, profile.baseCurrency)}` : '—'}
                sub="P10 / Median / P75"
                tooltip="Ending liquid net worth across historical cohorts, matching the final bottom 10%, median, and top 25% points of the historical projection."
              />
              <MetricCard
                label="Monthly spend margin"
                value={safeMonthlySpendBase != null ? formatCurrency(safeMonthlySpendBase, profile.baseCurrency) : '—'}
                sub={`at ${monteCarloConfig.successThreshold}% success rate`}
                tooltip="Extra monthly spending, in addition to already-defined expenses, that still meets the selected cohort success target."
              />
            </div>

            <ProjectionViews
              result={result}
              expenses={expenses}
              medicalCoverages={medicalCoverages ?? []}
              medicalExpenses={medicalExpenses ?? []}
              pensions={pensions}
              windfalls={windfalls}
              realEstateEvents={realEstateEvents}
              accounts={includedAccounts}
              profile={profile}
              config={monteCarloConfig}
              taxConfig={taxConfig}
              onApplySettings={runSimulation}
              running={simulationRunning}
              minTransactionEUR={minTransactionEUR}
              transfers={transfers}
              openCohortsRequest={openCohortsRequest}
              fxRate={liveEurUsdRate}
            />
          </>
        ) : (
          <Card>
            <div className="h-[200px] flex items-center justify-center text-[13px] text-gray-400">
              {accounts.length > 0 ? 'Historical projection unavailable' : 'Add accounts to see projections — simulation runs automatically'}
            </div>
          </Card>
        )}
      </div>
    </div>
  )
}
