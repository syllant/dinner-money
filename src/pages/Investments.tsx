import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import { ResponsiveContainer, Treemap, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RCTooltip, ReferenceLine } from 'recharts'
import { RefreshCw } from 'lucide-react'
import { useAppStore } from '../store/useAppStore'
import { PageHeader } from '../components/ui/PageHeader'
import { MetricCard } from '../components/ui/MetricCard'
import { InfoTooltip } from '../components/ui/InfoTooltip'
import { Card } from '../components/ui/Card'
import { formatCompact, formatCurrency } from '../lib/format'
import { convertToBase, DEFAULT_EUR_USD_RATE } from '../lib/currency'
import { projectedAnnualDividendsEUR } from '../lib/dividends'
import { projectedAccountsBy } from '../lib/accountLifecycle'
import { fetchTickerDividends, projectDividends, fetchMonthlyAdjustedReturns, fetchRecentDailyReturns } from '../lib/tiingo'
import type { MonthlyTickerReturn, DailyTickerReturn } from '../lib/tiingo'
import { syncIbkrFlexAccounts } from '../lib/ibkrFlex'
import { syncPlaidInvestmentAccount } from '../lib/investmentSync'
import type { Currency } from '../types'

// ─── Types ─────────────────────────────────────────────────────────────────────

type HistRangeKey = '1d' | '1w' | '1m' | '3M' | '1Y' | '2Y' | '3Y' | '5Y' | 'All'
const HIST_RANGES: HistRangeKey[] = ['1d', '1w', '1m', '3M', '1Y', '2Y', '3Y', '5Y', 'All']

type TreemapView = 'positions' | 'allocation' | 'currency' | 'gains'

type PositionFilter =
  | { type: 'allocation'; category: string }
  | { type: 'currency'; currency: string }
  | { type: 'gains'; gainType: 'LT' | 'ST' | 'loss' }

type DrilldownFrame =
  | { view: 'positions'; filter: PositionFilter; label: string }
  | { view: 'lots'; ticker: string; label: string }

interface TreemapCell {
  name: string
  fullName: string
  size: number
  gain: number | null
  isPseudo: boolean
  categoryColor?: string
  showGainInCell?: boolean   // false = suppress gain text/color coding in cell
  positions?: Array<{ label: string; value: number | string }>
  nativeCurrency: string
  nativeValue: number
  nativeGains: number | null
}

// ─── Category helpers ───────────────────────────────────────────────────────────

const FOREIGN_EQUITY_TICKERS = new Set([
  'VXUS', 'VEA', 'VWO', 'EFA', 'EEM', 'IEFA', 'IXUS', 'ACWX', 'SCZ',
  'SCHF', 'SCHI', 'FNDF', 'FNDX', 'GWL', 'DFAX', 'AVDE', 'AVEM',
])
const FOREIGN_BOND_TICKERS = new Set(['BNDX', 'IAGG', 'BWX', 'EMB', 'PICB', 'IGBH'])

function isForeignEquity(ticker: string | null, name: string): boolean {
  if (ticker && FOREIGN_EQUITY_TICKERS.has(ticker)) return true
  const n = name.toLowerCase()
  return (
    n.includes('international') || n.includes('foreign') || n.includes('emerging') ||
    n.includes('europe') || n.includes('pacific') || n.includes('asia') ||
    n.includes('ex-u.s') || n.includes('ex us') || n.includes('world ex') ||
    (n.includes('global') && !n.includes('u.s.') && !n.includes('domestic'))
  )
}

function isTreasuryBill(ticker: string | null, securityType: string, name: string): boolean {
  if (ticker?.startsWith('T-Bill')) return true
  const t = (securityType ?? '').toLowerCase()
  if (t === 'us treasury' || t.includes('bill') || t.includes('treasury')) return true
  if (ticker !== null) return false
  const n = name.toLowerCase()
  return n.includes('treasury') || n.includes('t-bill')
}

function empowerCategory(securityType: string, ticker: string | null, name: string): string {
  if (ticker === 'CUR:EUR') return 'EUR'
  if (ticker?.startsWith('CUR:')) return 'USD'
  const t = (securityType ?? '').toLowerCase()
  const n = (name ?? '').toLowerCase()
  if (isTreasuryBill(ticker, securityType, name)) return 'US Bonds'
  if (t === 'fixed income' || t === 'bond') {
    if (ticker && FOREIGN_BOND_TICKERS.has(ticker)) return 'Foreign Bonds'
    if (n.includes('international') || n.includes('emerging') || n.includes('foreign')) return 'Foreign Bonds'
    return 'US Bonds'
  }
  if (
    ['equity', 'etf', 'mutual fund', 'mutual_fund', 'stk', 'fund', 'mf'].includes(t) ||
    t.startsWith('mutual') || t.includes('fund')
  ) {
    return isForeignEquity(ticker, name) ? 'Foreign Stocks' : 'US Stocks'
  }
  if (['cash', 'money market'].includes(t)) return 'USD'
  return 'Other'
}

const ALLOC_COLORS: Record<string, string> = {
  'US Stocks':      '#22c55e',
  'Foreign Stocks': '#f97316',
  'US Bonds':       '#378ADD',
  'Foreign Bonds':  '#93c5fd',
  'USD':            '#94a3b8',
  'EUR':            '#94a3b8',
  'Real Estate':    '#f59e0b',
  'Other':          '#6b7280',
}

const CURRENCY_PALETTE = ['#378ADD', '#22c55e', '#f59e0b', '#a78bfa', '#34d399', '#94a3b8']
function currencyColor(cur: string, idx: number): string {
  const explicit: Record<string, string> = { USD: '#378ADD', EUR: '#22c55e', GBP: '#f59e0b' }
  return explicit[cur] ?? CURRENCY_PALETTE[idx % CURRENCY_PALETTE.length]
}

// ─── Performance helpers ────────────────────────────────────────────────────────

function compoundReturns(monthly: MonthlyTickerReturn[], fromMonth: string, toMonth: string): number {
  const relevant = monthly.filter(r => r.month >= fromMonth && r.month <= toMonth)
  return relevant.reduce((acc, r) => acc * (1 + r.return), 1) - 1
}

function weightedPortfolioReturn(
  holdings: Array<{ ticker: string; value: number }>,
  returnsMap: Map<string, MonthlyTickerReturn[]>,
  fromMonth: string,
  toMonth: string,
): number | null {
  let totalValue = 0
  let weightedSum = 0
  for (const { ticker, value } of holdings) {
    const monthly = returnsMap.get(ticker.toUpperCase())
    if (!monthly || monthly.length === 0) continue
    const ret = compoundReturns(monthly, fromMonth, toMonth)
    weightedSum += ret * value
    totalValue += value
  }
  if (totalValue <= 0) return null
  return weightedSum / totalValue
}

function fmtReturn(r: number | null): string {
  if (r == null) return '—'
  return `${r >= 0 ? '+' : ''}${(r * 100).toFixed(1)}%`
}

function returnClass(r: number | null): string {
  if (r == null) return ''
  return r >= 0 ? 'text-green-600' : 'text-red-500'
}

function fmtChartDate(dateStr: string): string {
  if (dateStr.length === 7) {
    const [year, mo] = dateStr.split('-')
    const abbr = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
    return `${abbr[Number(mo) - 1]} '${year.slice(2)}`
  }
  const d = new Date(dateStr + 'T12:00:00')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function histStartMonthFor(range: HistRangeKey, today: Date): string {
  if (range === 'All') return '2000-01'
  const d = new Date(today)
  const mo: Record<HistRangeKey, number> = { '1d': 0, '1w': 0, '1m': 0, '3M': 3, '1Y': 12, '2Y': 24, '3Y': 36, '5Y': 60, 'All': 0 }
  d.setMonth(d.getMonth() - mo[range])
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function gainColor(gainPct: number | null): string {
  if (gainPct == null) return '#6b7280'
  if (gainPct >= 0.20) return '#15803d'
  if (gainPct >= 0.10) return '#16a34a'
  if (gainPct >= 0.02) return '#22c55e'
  if (gainPct >= 0)    return '#4ade80'
  if (gainPct >= -0.05) return '#fca5a5'
  if (gainPct >= -0.15) return '#ef4444'
  return '#b91c1c'
}

// ─── Small UI helpers ──────────────────────────────────────────────────────────

function ViewToggle({ showTable, onToggle }: { showTable: boolean; onToggle: () => void }) {
  return (
    <button onClick={onToggle}
      className="text-[10px] px-2 py-[3px] rounded border border-gray-200 dark:border-gray-700 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors">
      {showTable ? '⬡ Chart' : '⊞ Table'}
    </button>
  )
}

function ProviderDot({ healthy }: { healthy: boolean }) {
  return <span className={`h-1.5 w-1.5 rounded-full ${healthy ? 'bg-green-500' : 'bg-red-500'}`} />
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function Investments() {
  const {
    accounts, profile, tiingoApiKey, lmProxyUrl,
    ibkrFlexToken, ibkrFlexQueryId,
    dividendHistory, dividendSyncedAt,
    setTickerDividends, setDividendSyncedAt,
    setAccounts, upsertAccount,
    expenses, medicalCoverages, medicalExpenses,
    pensions, realEstateEvents, transfers, windfalls,
    setPortfolioSnapshot,
  } = useAppStore()

  const [treemapView, setTreemapView] = useState<TreemapView>('positions')
  const [drilldownStack, setDrilldownStack] = useState<DrilldownFrame[]>([])
  const drilldown = drilldownStack[drilldownStack.length - 1] ?? null
  const drillInto = (frame: DrilldownFrame) => setDrilldownStack(s => [...s, frame])
  const goBack = () => setDrilldownStack(s => s.slice(0, -1))

  const [divSyncing, setDivSyncing] = useState(false)
  const [portfolioSyncing, setPortfolioSyncing] = useState(false)
  const [portfolioSyncMsg, setPortfolioSyncMsg] = useState<string | null>(null)
  const [showTableView, setShowTableView] = useState(false)
  const [dailyReturnsMap, setDailyReturnsMap] = useState<Map<string, DailyTickerReturn[]>>(new Map())
  const [historyRange, setHistoryRange] = useState<HistRangeKey>('2Y')
  const [selectedAccountIds, setSelectedAccountIds] = useState<Set<number> | null>(null)
  const [chartMode, setChartMode] = useState<'$' | '%'>('$')
  const [hoveredHolding, setHoveredHolding] = useState<{
    ticker: string; fullName: string; value: number; gains: number | null
    nativeCurrency: string; nativeValue: number; nativeGains: number | null
    positions?: Array<{ label: string; value: number | string }>
  } | null>(null)
  const [treemapPos, setTreemapPos] = useState({ x: 0, y: 0 })
  const [perfReturnsMap, setPerfReturnsMap] = useState<Map<string, MonthlyTickerReturn[]>>(new Map())

  // ── Included accounts ──

  const today = new Date()
  const thisMonthStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`
  const includedAccounts = projectedAccountsBy(thisMonthStr, {
    accounts, expenses,
    medicalCoverages: medicalCoverages ?? [],
    medicalExpenses: medicalExpenses ?? [],
    pensions, realEstateEvents, transfers, windfalls,
  })

  // ── Core value helpers ──

  const getAccountBaseValue = (a: typeof accounts[0]) => {
    if (a.holdings && a.holdings.length > 0) {
      return a.holdings.reduce((sum, h) => sum + convertToBase(h.institutionValue, h.currency as Currency, profile.baseCurrency, DEFAULT_EUR_USD_RATE), 0)
    }
    return convertToBase(a.balance, a.currency, profile.baseCurrency, DEFAULT_EUR_USD_RATE)
  }

  const invested = includedAccounts
    .filter(a => a.type === 'investment' || a.type === 'retirement')
    .reduce((s, a) => s + getAccountBaseValue(a), 0)

  // ── Holdings + gains ──

  let ltGainsPos = 0, stGainsPos = 0, lossesTotal = 0, totalCostBase = 0

  const allHoldings: Array<{
    ticker: string; name: string; value: number; gains: number | null
    isShortTerm: boolean | null; quantity: number; isPseudo: boolean
    nativeCurrency: string; nativeValue: number; nativeGains: number | null
    acquiredDate?: string; category: string
  }> = []

  const perAccountGains = new Map<number, { lt: number; st: number }>()

  for (const a of includedAccounts) {
    if (a.holdings && a.holdings.length > 0) {
      let accLt = 0, accSt = 0
      for (const h of a.holdings) {
        const valBase = convertToBase(h.institutionValue, h.currency as Currency, profile.baseCurrency, DEFAULT_EUR_USD_RATE)
        let gainBase: number | null = null
        let isShortTerm: boolean | null = null

        if (h.costBasis != null && h.costBasis > 0) {
          const costBase = convertToBase(h.costBasis, h.currency as Currency, profile.baseCurrency, DEFAULT_EUR_USD_RATE)
          const gain = valBase - costBase
          gainBase = gain
          totalCostBase += costBase
          const days = h.purchaseDate
            ? (today.getTime() - new Date(h.purchaseDate).getTime()) / 86400000
            : null
          isShortTerm = days != null ? days < 365 : null
          if (gain > 0) {
            if (isShortTerm === true) { stGainsPos += gain; accSt += gain }
            else { ltGainsPos += gain; accLt += gain }
          } else {
            lossesTotal += gain
            if (isShortTerm === true) accSt += gain
            else accLt += gain
          }
        }

        if (!a.ibkrAccountId && h.ticker === 'CUR:USD' && a.fxSplitEUR && a.fxSplitEUR > 0) {
          const eurInUSD = a.fxSplitEUR * DEFAULT_EUR_USD_RATE
          const remainUSD = Math.max(0, h.institutionValue - eurInUSD)
          const eurBase = convertToBase(a.fxSplitEUR, 'EUR', profile.baseCurrency, DEFAULT_EUR_USD_RATE)
          const existEUR = allHoldings.find(x => x.ticker === 'CUR:EUR')
          if (existEUR) { existEUR.value += eurBase; existEUR.nativeValue += a.fxSplitEUR }
          else allHoldings.push({ ticker: 'CUR:EUR', name: 'EUR Cash', value: eurBase, gains: null, isShortTerm: null, quantity: 0, isPseudo: false, nativeCurrency: 'EUR', nativeValue: a.fxSplitEUR, nativeGains: null, category: 'EUR' })
          if (remainUSD > 0) {
            const remBase = convertToBase(remainUSD, 'USD', profile.baseCurrency, DEFAULT_EUR_USD_RATE)
            const existUSD = allHoldings.find(x => x.ticker === 'CUR:USD')
            if (existUSD) { existUSD.value += remBase; existUSD.nativeValue += remainUSD }
            else allHoldings.push({ ticker: 'CUR:USD', name: 'USD Cash', value: remBase, gains: null, isShortTerm: null, quantity: 0, isPseudo: false, nativeCurrency: 'USD', nativeValue: remainUSD, nativeGains: null, category: 'USD' })
          }
          continue
        }

        const tBill = isTreasuryBill(h.ticker, h.securityType, h.name)
        const holdingTicker = h.ticker ?? (tBill ? h.name : '')
        const cat = empowerCategory(h.securityType, h.ticker, h.name)
        const nativeGain = (h.costBasis != null && h.costBasis > 0) ? h.institutionValue - h.costBasis : null
        const existing = holdingTicker ? allHoldings.find(x => x.ticker === holdingTicker) : null
        if (existing) {
          existing.value += valBase
          existing.nativeValue += h.institutionValue
          existing.quantity += h.quantity
          if (gainBase !== null) existing.gains = (existing.gains ?? 0) + gainBase
          if (nativeGain !== null) existing.nativeGains = (existing.nativeGains ?? 0) + nativeGain
          if (isShortTerm !== null) existing.isShortTerm = isShortTerm
          if (h.purchaseDate && (!existing.acquiredDate || h.purchaseDate < existing.acquiredDate)) existing.acquiredDate = h.purchaseDate
        } else {
          allHoldings.push({
            ticker: holdingTicker, name: h.name, value: valBase, gains: gainBase, isShortTerm,
            quantity: h.quantity, isPseudo: false,
            nativeCurrency: h.currency.toUpperCase(), nativeValue: h.institutionValue,
            nativeGains: nativeGain, acquiredDate: h.purchaseDate, category: cat,
          })
        }
      }
      if (accLt !== 0 || accSt !== 0) perAccountGains.set(a.id, { lt: accLt, st: accSt })
    }
  }

  for (const a of includedAccounts.filter(a => a.type === 'investment' || a.type === 'retirement')) {
    if (!a.holdings || a.holdings.length === 0) {
      const val = convertToBase(a.balance, a.currency, profile.baseCurrency, DEFAULT_EUR_USD_RATE)
      if (val !== 0) {
        allHoldings.push({ ticker: '', name: a.name, value: val, gains: null, isShortTerm: null, quantity: 0, isPseudo: true, nativeCurrency: a.currency.toUpperCase(), nativeValue: Math.abs(a.balance), nativeGains: null, category: 'Other' })
      }
    }
  }

  allHoldings.sort((a, b) => b.value - a.value)

  const totalNetGains = ltGainsPos + stGainsPos + lossesTotal
  const totalReturnPct = totalCostBase > 0 ? totalNetGains / totalCostBase : null

  // ── All tax lots ──

  const allTaxLots = includedAccounts
    .filter(a => a.type === 'investment' || a.type === 'retirement')
    .flatMap(a => (a.taxLots ?? []).map(lot => ({ ...lot, accountName: a.name })))

  // ── Currency exposure ──

  const byCurrency: Record<string, number> = {}
  const byCurrencyPositions: Record<string, Array<{ label: string; value: number }>> = {}

  function addCurrencyPosition(cur: string, label: string, value: number) {
    byCurrency[cur] = (byCurrency[cur] ?? 0) + value
    if (!byCurrencyPositions[cur]) byCurrencyPositions[cur] = []
    const existing = byCurrencyPositions[cur].find(p => p.label === label)
    if (existing) existing.value += value
    else byCurrencyPositions[cur].push({ label, value })
  }

  for (const a of includedAccounts.filter(a => a.type === 'investment' || a.type === 'retirement')) {
    const baseVal = getAccountBaseValue(a)
    if (a.fxSplitEUR && a.fxSplitEUR > 0 && a.currency.toUpperCase() !== 'EUR') {
      const eurBase = convertToBase(a.fxSplitEUR, 'EUR', profile.baseCurrency, DEFAULT_EUR_USD_RATE)
      const eurInAcc = convertToBase(a.fxSplitEUR, 'EUR', a.currency as 'EUR' | 'USD', DEFAULT_EUR_USD_RATE)
      addCurrencyPosition('EUR', a.name, eurBase)
      addCurrencyPosition(a.currency.toUpperCase(), a.name, convertToBase(Math.max(0, a.balance - eurInAcc), a.currency, profile.baseCurrency, DEFAULT_EUR_USD_RATE))
    } else if (a.holdings && a.holdings.length > 0) {
      for (const h of a.holdings) {
        const c = h.ticker?.match(/^CUR:([A-Z]{3})$/)?.[1] ?? h.currency.toUpperCase()
        addCurrencyPosition(c, a.name, convertToBase(h.institutionValue, h.currency as Currency, profile.baseCurrency, DEFAULT_EUR_USD_RATE))
      }
    } else {
      addCurrencyPosition(a.currency.toUpperCase(), a.name, baseVal)
    }
  }

  // ── Allocation by category ──

  const allocationByCategory: Record<string, number> = {}
  const allocationPositions: Record<string, Array<{ label: string; value: number }>> = {}

  function addToCategory(cat: string, val: number, label: string) {
    allocationByCategory[cat] = (allocationByCategory[cat] ?? 0) + val
    if (!allocationPositions[cat]) allocationPositions[cat] = []
    const existing = allocationPositions[cat].find(p => p.label === label)
    if (existing) existing.value += val
    else allocationPositions[cat].push({ label, value: val })
  }

  for (const a of includedAccounts.filter(a => a.type === 'investment' || a.type === 'retirement')) {
    const b = getAccountBaseValue(a)
    if (a.holdings && a.holdings.length > 0) {
      for (const h of a.holdings) {
        const tBill = isTreasuryBill(h.ticker, h.securityType, h.name)
        const cat = empowerCategory(h.securityType, h.ticker, h.name)
        const posLabel = h.ticker || (tBill ? h.name : h.name.slice(0, 20))
        if (!a.ibkrAccountId && h.ticker === 'CUR:USD' && a.fxSplitEUR && a.fxSplitEUR > 0) {
          const eurBase = convertToBase(a.fxSplitEUR, 'EUR', profile.baseCurrency, DEFAULT_EUR_USD_RATE)
          addToCategory('EUR', eurBase, `${a.name} (EUR)`)
          const eurAsUSD = a.fxSplitEUR * DEFAULT_EUR_USD_RATE
          const remainBase = convertToBase(Math.max(0, h.institutionValue - eurAsUSD), h.currency as Currency, profile.baseCurrency, DEFAULT_EUR_USD_RATE)
          if (remainBase > 0) addToCategory('USD', remainBase, posLabel)
        } else {
          const val = convertToBase(h.institutionValue, h.currency as Currency, profile.baseCurrency, DEFAULT_EUR_USD_RATE)
          addToCategory(cat, val, posLabel)
        }
      }
    } else if (!a.ibkrAccountId && a.fxSplitEUR && a.fxSplitEUR > 0 && a.currency.toUpperCase() !== 'EUR') {
      const eurBase = convertToBase(a.fxSplitEUR, 'EUR', profile.baseCurrency, DEFAULT_EUR_USD_RATE)
      addToCategory('EUR', eurBase, `${a.name} (EUR)`)
      const eurInAccCurrency = a.fxSplitEUR * DEFAULT_EUR_USD_RATE
      const remainB = convertToBase(Math.max(0, a.balance - eurInAccCurrency), a.currency, profile.baseCurrency, DEFAULT_EUR_USD_RATE)
      if (a.allocation.equity > 0) addToCategory('US Stocks', remainB * a.allocation.equity / 100, `${a.name} (equity)`)
      if (a.allocation.bonds > 0) addToCategory('US Bonds', remainB * a.allocation.bonds / 100, `${a.name} (bonds)`)
      if (a.allocation.cash > 0) addToCategory('USD', remainB * a.allocation.cash / 100, `${a.name} (cash)`)
    } else {
      if (a.allocation.equity > 0) addToCategory('US Stocks', b * a.allocation.equity / 100, `${a.name} (equity)`)
      if (a.allocation.bonds > 0) addToCategory('US Bonds', b * a.allocation.bonds / 100, `${a.name} (bonds)`)
      if (a.allocation.cash > 0) addToCategory('USD', b * a.allocation.cash / 100, `${a.name} (cash)`)
    }
  }

  // ── Dividends ──

  const todayStr = today.toISOString().slice(0, 10)
  const next12End = (() => { const d = new Date(today); d.setFullYear(d.getFullYear() + 1); return d.toISOString().slice(0, 10) })()

  const investableTickers = useMemo(() => [...new Set(
    includedAccounts.flatMap(a => a.holdings ?? [])
      .filter(h => h.ticker !== null && !isTreasuryBill(h.ticker, h.securityType, h.name))
      .map(h => h.ticker as string)
      .filter(t => !/^CUR:/.test(t) && !/^T-Bill\b/.test(t))
  )], [includedAccounts]) // eslint-disable-line react-hooks/exhaustive-deps

  const tickersWithHistory = investableTickers.filter(t => (dividendHistory[t]?.length ?? 0) > 0)

  const divByTicker: Array<{ ticker: string; annualBase: number }> = []
  const divAccountIds = new Set<number>()
  for (const a of includedAccounts) {
    for (const h of a.holdings ?? []) {
      if (!h.ticker || /^CUR:/.test(h.ticker)) continue
      const hist = dividendHistory[h.ticker]
      if (!hist?.length) continue
      const projected = projectDividends(h.ticker, hist, h.quantity, 20)
        .filter(d => d.paymentDate >= todayStr && d.paymentDate <= next12End)
      if (projected.length === 0) continue
      const annualBase = projected.reduce((s, d) =>
        s + convertToBase(d.totalAmount, h.currency as Currency, profile.baseCurrency, DEFAULT_EUR_USD_RATE), 0)
      const existing = divByTicker.find(x => x.ticker === h.ticker)
      if (existing) existing.annualBase += annualBase
      else divByTicker.push({ ticker: h.ticker, annualBase })
      divAccountIds.add(a.id)
    }
  }
  divByTicker.sort((a, b) => b.annualBase - a.annualBase)

  // Build per-account dividend breakdown for tooltip grouping
  const divByAccount = new Map<string, Array<{ ticker: string; annualBase: number }>>()
  for (const a of includedAccounts) {
    for (const h of a.holdings ?? []) {
      if (!h.ticker || /^CUR:/.test(h.ticker)) continue
      const hist = dividendHistory[h.ticker]
      if (!hist?.length) continue
      const projected = projectDividends(h.ticker, hist, h.quantity, 20)
        .filter(d => d.paymentDate >= todayStr && d.paymentDate <= next12End)
      if (projected.length === 0) continue
      const annualBase = projected.reduce((s, d) =>
        s + convertToBase(d.totalAmount, h.currency as Currency, profile.baseCurrency, DEFAULT_EUR_USD_RATE), 0)
      const items = divByAccount.get(a.name) ?? []
      const existing = items.find(x => x.ticker === h.ticker)
      if (existing) existing.annualBase += annualBase
      else items.push({ ticker: h.ticker, annualBase })
      divByAccount.set(a.name, items)
    }
  }

  const annualDivBase = divByTicker.length > 0
    ? divByTicker.reduce((s, d) => s + d.annualBase, 0)
    : convertToBase(projectedAnnualDividendsEUR(includedAccounts, DEFAULT_EUR_USD_RATE), 'EUR', profile.baseCurrency, DEFAULT_EUR_USD_RATE)

  // Number of accounts contributing to dividends
  const divAccountCount = divAccountIds.size || includedAccounts.filter(a => (a.holdings?.length ?? 0) > 0).length

  // ── Interest income (bonds, T-bills, cash) ──

  const interestByTicker: Array<{ ticker: string; annualBase: number }> = []
  const interestAccountIds = new Set<number>()

  for (const a of includedAccounts) {
    if (a.type !== 'investment' && a.type !== 'retirement') continue
    for (const h of a.holdings ?? []) {
      // Bond ETFs with dividend history (distributions are interest)
      if (h.ticker && !/^CUR:/.test(h.ticker) && !isTreasuryBill(h.ticker, h.securityType, h.name)) {
        const cat = empowerCategory(h.securityType, h.ticker, h.name)
        if (cat === 'US Bonds' || cat === 'Foreign Bonds') {
          const hist = dividendHistory[h.ticker]
          if (hist?.length) {
            const projected = projectDividends(h.ticker, hist, h.quantity, 20)
              .filter(d => d.paymentDate >= todayStr && d.paymentDate <= next12End)
            if (projected.length > 0) {
              const annualBase = projected.reduce((s, d) =>
                s + convertToBase(d.totalAmount, h.currency as Currency, profile.baseCurrency, DEFAULT_EUR_USD_RATE), 0)
              const existing = interestByTicker.find(x => x.ticker === h.ticker)
              if (existing) existing.annualBase += annualBase
              else interestByTicker.push({ ticker: h.ticker, annualBase })
              interestAccountIds.add(a.id)
            }
          }
        }
      }
      // T-bills: estimated 4.5% yield
      if (isTreasuryBill(h.ticker, h.securityType, h.name)) {
        const valBase = convertToBase(h.institutionValue, h.currency as Currency, profile.baseCurrency, DEFAULT_EUR_USD_RATE)
        if (valBase > 0) {
          const label = h.ticker || h.name.slice(0, 14) || 'T-Bill'
          const existing = interestByTicker.find(x => x.ticker === label)
          if (existing) existing.annualBase += valBase * 0.045
          else interestByTicker.push({ ticker: label, annualBase: valBase * 0.045 })
          interestAccountIds.add(a.id)
        }
      }
      // Cash tickers: estimated yield
      if (h.ticker?.startsWith('CUR:')) {
        const cur = h.ticker.slice(4)
        const rate = cur === 'EUR' ? 0.025 : 0.040
        const valBase = convertToBase(h.institutionValue, h.currency as Currency, profile.baseCurrency, DEFAULT_EUR_USD_RATE)
        if (valBase > 0) {
          const label = `${cur} Cash`
          const existing = interestByTicker.find(x => x.ticker === label)
          if (existing) existing.annualBase += valBase * rate
          else interestByTicker.push({ ticker: label, annualBase: valBase * rate })
          interestAccountIds.add(a.id)
        }
      }
    }
  }
  interestByTicker.sort((a, b) => b.annualBase - a.annualBase)

  // Build per-account interest breakdown for tooltip grouping
  const interestByAccount = new Map<string, Array<{ ticker: string; annualBase: number }>>()
  for (const a of includedAccounts) {
    if (a.type !== 'investment' && a.type !== 'retirement') continue
    for (const h of a.holdings ?? []) {
      const accItems: Array<{ ticker: string; annualBase: number }> = []
      // Bond ETFs
      if (h.ticker && !/^CUR:/.test(h.ticker) && !isTreasuryBill(h.ticker, h.securityType, h.name)) {
        const cat = empowerCategory(h.securityType, h.ticker, h.name)
        if (cat === 'US Bonds' || cat === 'Foreign Bonds') {
          const hist = dividendHistory[h.ticker]
          if (hist?.length) {
            const projected = projectDividends(h.ticker, hist, h.quantity, 20)
              .filter(d => d.paymentDate >= todayStr && d.paymentDate <= next12End)
            if (projected.length > 0) {
              const annualBase = projected.reduce((s, d) =>
                s + convertToBase(d.totalAmount, h.currency as Currency, profile.baseCurrency, DEFAULT_EUR_USD_RATE), 0)
              accItems.push({ ticker: h.ticker, annualBase })
            }
          }
        }
      }
      // T-bills
      if (isTreasuryBill(h.ticker, h.securityType, h.name)) {
        const valBase = convertToBase(h.institutionValue, h.currency as Currency, profile.baseCurrency, DEFAULT_EUR_USD_RATE)
        if (valBase > 0) accItems.push({ ticker: h.ticker || h.name.slice(0, 14) || 'T-Bill', annualBase: valBase * 0.045 })
      }
      // Cash
      if (h.ticker?.startsWith('CUR:')) {
        const cur = h.ticker.slice(4)
        const rate = cur === 'EUR' ? 0.025 : 0.040
        const valBase = convertToBase(h.institutionValue, h.currency as Currency, profile.baseCurrency, DEFAULT_EUR_USD_RATE)
        if (valBase > 0) accItems.push({ ticker: `${cur} Cash`, annualBase: valBase * rate })
      }
      if (accItems.length > 0) {
        const existing = interestByAccount.get(a.name) ?? []
        for (const item of accItems) {
          const found = existing.find(x => x.ticker === item.ticker)
          if (found) found.annualBase += item.annualBase
          else existing.push(item)
        }
        interestByAccount.set(a.name, existing)
      }
    }
  }

  const annualInterestBase = interestByTicker.reduce((s, d) => s + d.annualBase, 0)
  const interestAccountCount = interestAccountIds.size

  // ── USD exposure ──

  // totalInvestmentBase / usdExposurePct: reserved for risk panel
  // totalInvestmentBase = Object.values(byCurrency).reduce((s, v) => s + v, 0)
  // usdExposurePct = (byCurrency['USD'] ?? 0) / totalInvestmentBase * 100
  // usdValueClass: reserved for risk panel — 'text-green-600' | 'text-amber-500' | 'text-red-500'

  // ── Portfolio performance ──

  const currentMonth = today.toISOString().slice(0, 7)
  const ytdStartMonth = `${today.getFullYear()}-01`
  const year12StartMonth = `${today.getFullYear() - 1}-${String(today.getMonth() + 1).padStart(2, '0')}`

  // Earliest acquired date per ticker across all tax lots (YYYY-MM for chart cutoff)
  const tickerStartMonth = useMemo(() => {
    const map = new Map<string, string>()
    for (const a of includedAccounts) {
      for (const lot of a.taxLots ?? []) {
        if (!lot.ticker || !lot.acquiredDate) continue
        const month = lot.acquiredDate.slice(0, 7)
        const existing = map.get(lot.ticker.toUpperCase())
        if (!existing || month < existing) map.set(lot.ticker.toUpperCase(), month)
      }
    }
    return map
  }, [includedAccounts]) // eslint-disable-line react-hooks/exhaustive-deps

  const perfHoldings = useMemo(() =>
    allHoldings
      .filter(h => !h.isPseudo && h.ticker && !/^CUR:/.test(h.ticker) && !isTreasuryBill(h.ticker, '', h.name))
      .map(h => ({ ticker: h.ticker, value: h.value, startMonth: tickerStartMonth.get(h.ticker.toUpperCase()) })),
    [allHoldings, tickerStartMonth] // eslint-disable-line react-hooks/exhaustive-deps
  )

  const perAccountPerfHoldings = useMemo(() => {
    const map = new Map<number, Array<{ticker: string, value: number, startMonth?: string}>>()
    for (const a of includedAccounts) {
      if (a.type !== 'investment' && a.type !== 'retirement') continue
      if (!a.holdings || a.holdings.length === 0) continue
      const holdings: Array<{ticker: string, value: number, startMonth?: string}> = []
      for (const h of a.holdings) {
        if (!h.ticker || /^CUR:/.test(h.ticker) || isTreasuryBill(h.ticker, h.securityType, h.name)) continue
        const val = convertToBase(h.institutionValue, h.currency as Currency, profile.baseCurrency, DEFAULT_EUR_USD_RATE)
        const startMonth = tickerStartMonth.get(h.ticker.toUpperCase())
        const existing = holdings.find(x => x.ticker === h.ticker)
        if (existing) existing.value += val
        else holdings.push({ ticker: h.ticker, value: val, startMonth })
      }
      if (holdings.length > 0) map.set(a.id, holdings)
    }
    return map
  }, [includedAccounts, tickerStartMonth]) // eslint-disable-line react-hooks/exhaustive-deps

  const filteredPerfHoldings = useMemo(() => {
    if (selectedAccountIds === null) return perfHoldings
    const tickerMap = new Map<string, { value: number; startMonth?: string }>()
    for (const [id, holdings] of perAccountPerfHoldings) {
      if (!selectedAccountIds.has(id)) continue
      for (const h of holdings) {
        const existing = tickerMap.get(h.ticker)
        if (existing) {
          existing.value += h.value
          // Use earliest startMonth across selected accounts
          if (h.startMonth && (!existing.startMonth || h.startMonth < existing.startMonth))
            existing.startMonth = h.startMonth
        } else {
          tickerMap.set(h.ticker, { value: h.value, startMonth: h.startMonth })
        }
      }
    }
    return [...tickerMap.entries()].map(([ticker, { value, startMonth }]) => ({ ticker, value, startMonth }))
  }, [selectedAccountIds, perAccountPerfHoldings, perfHoldings])

  const portfolioYtd = weightedPortfolioReturn(filteredPerfHoldings, perfReturnsMap, ytdStartMonth, currentMonth)
  const portfolio12m = weightedPortfolioReturn(filteredPerfHoldings, perfReturnsMap, year12StartMonth, currentMonth)
  const spyReturns = perfReturnsMap.get('SPY') ?? []
  const spyYtd = spyReturns.length > 0 ? compoundReturns(spyReturns, ytdStartMonth, currentMonth) : null
  const spy12m = spyReturns.length > 0 ? compoundReturns(spyReturns, year12StartMonth, currentMonth) : null

  const todayData = useMemo(() => {
    if (dailyReturnsMap.size === 0) return { pct: null as number | null, spy: null as number | null, date: null as string | null }
    let latestDate: string | null = null
    for (const [, returns] of dailyReturnsMap) {
      const last = returns[returns.length - 1]
      if (last && (!latestDate || last.date > latestDate)) latestDate = last.date
    }
    if (!latestDate) return { pct: null, spy: null, date: null }
    const spyDaily = dailyReturnsMap.get('SPY') ?? []
    const spyToday = spyDaily.find(r => r.date === latestDate)?.return ?? null
    let totalValue = 0, weightedReturn = 0
    for (const { ticker, value } of filteredPerfHoldings) {
      const dayReturn = (dailyReturnsMap.get(ticker.toUpperCase()) ?? []).find(r => r.date === latestDate)
      if (!dayReturn) continue
      weightedReturn += dayReturn.return * value
      totalValue += value
    }
    return { pct: totalValue > 0 ? weightedReturn / totalValue : null, spy: spyToday, date: latestDate }
  }, [dailyReturnsMap, filteredPerfHoldings])

  const historyStartMonth = useMemo(() => histStartMonthFor(historyRange, today), [historyRange]) // eslint-disable-line react-hooks/exhaustive-deps
  const isDaily = historyRange === '1d' || historyRange === '1w' || historyRange === '1m'

  const historyChartData = useMemo(() => {
    type DataPoint = { date: string; portfolio: number; spy: number | null; portfolioValue: number; spyValue: number | null }

    if (isDaily) {
      // Daily mode: use dailyReturnsMap
      const cutoffDays = historyRange === '1d' ? 2 : historyRange === '1w' ? 8 : 33
      const cutoff = new Date(today)
      cutoff.setDate(cutoff.getDate() - cutoffDays)
      const cutoffStr = cutoff.toISOString().slice(0, 10)
      const spyDaily = dailyReturnsMap.get('SPY') ?? []
      const dates = [...new Set(spyDaily.filter(r => r.date >= cutoffStr).map(r => r.date))].sort()
      if (dates.length === 0 || filteredPerfHoldings.length === 0) return []
      const byDate = new Map<string, Map<string, number>>()
      for (const [ticker, returns] of dailyReturnsMap) {
        const dd = new Map<string, number>()
        for (const r of returns) dd.set(r.date, r.return)
        byDate.set(ticker, dd)
      }
      let portfolioCum = 1, spyCum = 1
      const raw: Array<DataPoint & { portfolioCum: number; spyCum: number }> = [
        { date: cutoffStr, portfolio: 0, spy: 0, portfolioValue: 0, spyValue: 0, portfolioCum: 1, spyCum: 1 },
      ]
      for (const date of dates) {
        let totalValue = 0, weightedReturn = 0
        for (const { ticker, value, startMonth } of filteredPerfHoldings) {
          // Respect acquired date — skip contribution before ticker was held
          if (startMonth && date.slice(0, 7) < startMonth) continue
          const r = byDate.get(ticker.toUpperCase())?.get(date)
          if (r == null) continue
          weightedReturn += r * value
          totalValue += value
        }
        portfolioCum *= (1 + (totalValue > 0 ? weightedReturn / totalValue : 0))
        const spyR = byDate.get('SPY')?.get(date)
        if (spyR != null) spyCum *= (1 + spyR)
        raw.push({ date, portfolio: parseFloat(((portfolioCum - 1) * 100).toFixed(2)), spy: parseFloat(((spyCum - 1) * 100).toFixed(2)), portfolioValue: 0, spyValue: 0, portfolioCum, spyCum })
      }
      const finalCum = raw[raw.length - 1]?.portfolioCum ?? 1
      // $ mode: normalise to the filtered portfolio value, not total invested
      const filteredInvested = filteredPerfHoldings.reduce((s, h) => s + h.value, 0)
      const startVal = finalCum > 0 ? filteredInvested / finalCum : filteredInvested
      return raw.map(p => ({ ...p, portfolioValue: Math.round(startVal * p.portfolioCum), spyValue: Math.round(startVal * p.spyCum) })) as DataPoint[]
    }

    // Monthly mode
    const spyReturns = perfReturnsMap.get('SPY') ?? []
    const months = spyReturns.map(r => r.month).filter(m => m > historyStartMonth && m <= currentMonth).sort()
    if (months.length === 0 || filteredPerfHoldings.length === 0) return []
    const byMonth = new Map<string, Map<string, number>>()
    for (const [ticker, returns] of perfReturnsMap) {
      const mm = new Map<string, number>()
      for (const r of returns) mm.set(r.month, r.return)
      byMonth.set(ticker, mm)
    }
    let portfolioCum = 1, spyCum = 1
    const raw: Array<DataPoint & { portfolioCum: number; spyCum: number }> = [
      { date: historyStartMonth, portfolio: 0, spy: 0, portfolioValue: 0, spyValue: 0, portfolioCum: 1, spyCum: 1 },
    ]
    for (const month of months) {
      let totalValue = 0, weightedReturn = 0
      for (const { ticker, value, startMonth } of filteredPerfHoldings) {
        // Respect acquired date — skip contribution before ticker was held
        if (startMonth && month < startMonth) continue
        const r = byMonth.get(ticker.toUpperCase())?.get(month)
        if (r == null) continue
        weightedReturn += r * value
        totalValue += value
      }
      portfolioCum *= (1 + (totalValue > 0 ? weightedReturn / totalValue : 0))
      const spyR = byMonth.get('SPY')?.get(month)
      if (spyR != null) spyCum *= (1 + spyR)
      raw.push({ date: month, portfolio: parseFloat(((portfolioCum - 1) * 100).toFixed(2)), spy: spyReturns.length > 0 ? parseFloat(((spyCum - 1) * 100).toFixed(2)) : null, portfolioValue: 0, spyValue: 0, portfolioCum, spyCum })
    }
    const finalCum = raw[raw.length - 1]?.portfolioCum ?? 1
    // $ mode: normalise to the filtered portfolio value, not total invested
    const filteredInvested = filteredPerfHoldings.reduce((s, h) => s + h.value, 0)
    const startVal = finalCum > 0 ? filteredInvested / finalCum : filteredInvested
    return raw.map(p => ({ ...p, portfolioValue: Math.round(startVal * p.portfolioCum), spyValue: p.spy != null ? Math.round(startVal * p.spyCum) : null })) as DataPoint[]
  }, [filteredPerfHoldings, perfReturnsMap, dailyReturnsMap, historyStartMonth, currentMonth, isDaily, invested]) // eslint-disable-line react-hooks/exhaustive-deps

  const perfStartDate = `${today.getFullYear() - 5}-01-01`
  const perfTickersKey = useMemo(() => ['SPY', ...investableTickers].sort().join(','), [investableTickers])

  useEffect(() => {
    if (!tiingoApiKey) return
    const tickers = ['SPY', ...investableTickers]
    let cancelled = false
    Promise.all(
      tickers.map(t =>
        fetchMonthlyAdjustedReturns(tiingoApiKey, t, perfStartDate, lmProxyUrl)
          .then(data => ({ ticker: t.toUpperCase(), data }))
          .catch(() => ({ ticker: t.toUpperCase(), data: [] as MonthlyTickerReturn[] }))
      )
    ).then(results => {
      if (cancelled) return
      const map = new Map<string, MonthlyTickerReturn[]>()
      results.forEach(({ ticker, data }) => map.set(ticker, data))
      setPerfReturnsMap(map)
    })
    return () => { cancelled = true }
  }, [tiingoApiKey, lmProxyUrl, perfTickersKey, perfStartDate]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!tiingoApiKey) return
    const tickers = ['SPY', ...investableTickers]
    let cancelled = false
    Promise.all(
      tickers.map(t =>
        fetchRecentDailyReturns(tiingoApiKey, t, 35, lmProxyUrl)
          .then(data => ({ ticker: t.toUpperCase(), data }))
          .catch(() => ({ ticker: t.toUpperCase(), data: [] as DailyTickerReturn[] }))
      )
    ).then(results => {
      if (cancelled) return
      const map = new Map<string, DailyTickerReturn[]>()
      results.forEach(({ ticker, data }) => map.set(ticker, data))
      setDailyReturnsMap(map)
    })
    return () => { cancelled = true }
  }, [tiingoApiKey, lmProxyUrl, perfTickersKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Publish portfolio snapshot to store (for sidebar widget) ──
  // Use refs for frequently-changing values so the effect only fires when
  // dailyReturnsMap changes (after Tiingo fetch), not on every render.
  const snapshotHoldingsRef = useRef(filteredPerfHoldings)
  snapshotHoldingsRef.current = filteredPerfHoldings
  const snapshotInvestedRef = useRef(invested)
  snapshotInvestedRef.current = invested
  const snapshotTodayRef = useRef(todayData)
  snapshotTodayRef.current = todayData

  useEffect(() => {
    if (dailyReturnsMap.size === 0) return
    const holdings = snapshotHoldingsRef.current
    const inv = snapshotInvestedRef.current
    const td = snapshotTodayRef.current
    if (holdings.length === 0) return
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - 8)
    const cutoffStr = cutoff.toISOString().slice(0, 10)
    const spyDaily = dailyReturnsMap.get('SPY') ?? []
    const dates = [...new Set(spyDaily.filter(r => r.date >= cutoffStr).map(r => r.date))].sort()
    const byDate = new Map<string, Map<string, number>>()
    for (const [ticker, returns] of dailyReturnsMap) {
      const dd = new Map<string, number>(); for (const r of returns) dd.set(r.date, r.return)
      byDate.set(ticker, dd)
    }
    let portfolioCum = 1
    const raw: Array<{ date: string; portfolioCum: number }> = [{ date: cutoffStr, portfolioCum: 1 }]
    for (const date of dates) {
      let totalValue = 0, weightedReturn = 0
      for (const { ticker, value, startMonth } of holdings) {
        if (startMonth && date.slice(0, 7) < startMonth) continue
        const r = byDate.get(ticker.toUpperCase())?.get(date)
        if (r == null) continue
        weightedReturn += r * value; totalValue += value
      }
      portfolioCum *= (1 + (totalValue > 0 ? weightedReturn / totalValue : 0))
      raw.push({ date, portfolioCum })
    }
    const finalCum = raw[raw.length - 1]?.portfolioCum ?? 1
    const startVal = finalCum > 0 ? inv / finalCum : inv
    setPortfolioSnapshot({
      invested: inv,
      todayPct: td.pct,
      todayAmt: td.pct != null ? td.pct * inv : null,
      points: raw.map(p => ({ date: p.date, value: Math.round(startVal * p.portfolioCum) })),
    })
  }, [dailyReturnsMap, setPortfolioSnapshot]) // stable deps — values read via refs

  // ── Tiingo dividend sync ──

  async function syncDividendHistory() {
    if (!tiingoApiKey || investableTickers.length === 0) return
    setDivSyncing(true)
    for (let i = 0; i < investableTickers.length; i++) {
      const ticker = investableTickers[i]
      try {
        setTickerDividends(ticker, await fetchTickerDividends(tiingoApiKey, ticker, lmProxyUrl))
      } catch { /* ignore individual failures */ }
      if (i < investableTickers.length - 1) await new Promise(r => setTimeout(r, 400))
    }
    setDividendSyncedAt(new Date().toISOString())
    setDivSyncing(false)
  }

  // ── Portfolio sync ──

  async function syncPortfolioAccounts() {
    if (portfolioSyncing || !lmProxyUrl) return
    setPortfolioSyncing(true)
    setPortfolioSyncMsg('Syncing positions…')
    try {
      if (ibkrFlexToken && ibkrFlexQueryId) {
        const synced = await syncIbkrFlexAccounts(accounts, lmProxyUrl, ibkrFlexToken, ibkrFlexQueryId)
        setAccounts(synced)
      }
      for (const a of portfolioAccounts.filter(acc => acc.plaidAccessToken && !acc.ibkrAccountId)) {
        upsertAccount(await syncPlaidInvestmentAccount(a, lmProxyUrl))
      }
      if (tiingoApiKey && investableTickers.length > 0) {
        setPortfolioSyncMsg('Syncing dividends…')
        await syncDividendHistory()
      }
      setPortfolioSyncMsg(null)
    } catch (err: any) {
      setPortfolioSyncMsg(`Sync error: ${err?.message ?? 'unknown'}`)
      setTimeout(() => setPortfolioSyncMsg(null), 4000)
    } finally {
      setPortfolioSyncing(false)
    }
  }

  // ── Treemap data builders ──

  function positionCell(h: typeof allHoldings[0]): TreemapCell {
    const cb = h.nativeValue - (h.nativeGains ?? 0)
    const gainPct = h.nativeGains != null && cb > 0 ? h.nativeGains / cb : null
    return {
      name: h.isPseudo ? `(${h.name.slice(0, 9)})` : (h.ticker || h.name),
      fullName: h.isPseudo ? `${h.name} — no Plaid` : h.name,
      size: Math.max(1, h.value),
      gain: h.gains,
      isPseudo: h.isPseudo,
      categoryColor: h.isPseudo ? '#6b7280' : gainColor(gainPct),
      showGainInCell: false,
      positions: undefined,
      nativeCurrency: h.nativeCurrency,
      nativeValue: h.nativeValue,
      nativeGains: h.nativeGains,
    }
  }

  const positionsTreemapData: TreemapCell[] = allHoldings.slice(0, 30).map(positionCell)

  const USD_ALLOC_CATS = new Set(['US Stocks', 'Foreign Stocks', 'US Bonds', 'Foreign Bonds', 'USD'])
  const allocTreemapData: TreemapCell[] = Object.entries(allocationByCategory)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([cat, val]) => {
      const showUSD = USD_ALLOC_CATS.has(cat) && profile.baseCurrency === 'EUR'
      return {
        name: cat, fullName: cat, size: val, gain: null, isPseudo: false,
        categoryColor: ALLOC_COLORS[cat] ?? '#6b7280',
        positions: (allocationPositions[cat] ?? [])
          .filter(p => p.value > 0)
          .sort((a, b) => b.value - a.value).slice(0, 12),
        nativeCurrency: showUSD ? 'USD' : profile.baseCurrency,
        nativeValue: showUSD ? val * DEFAULT_EUR_USD_RATE : val,
        nativeGains: null,
      }
    })

  const currencyTreemapData: TreemapCell[] = Object.entries(byCurrency)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([cur, val], i) => ({
      name: cur, fullName: cur, size: val, gain: null, isPseudo: false,
      categoryColor: currencyColor(cur, i),
      positions: (byCurrencyPositions[cur] ?? []).sort((a, b) => b.value - a.value),
      nativeCurrency: profile.baseCurrency, nativeValue: val, nativeGains: null,
    }))

  const gainsTreemapData: TreemapCell[] = [
    ...(ltGainsPos > 0 ? [{
      name: 'LT Gains', fullName: 'Long-term gains (held >1y)',
      size: ltGainsPos, gain: ltGainsPos, isPseudo: false, categoryColor: '#16a34a',
      nativeCurrency: profile.baseCurrency, nativeValue: ltGainsPos, nativeGains: ltGainsPos,
    }] : []),
    ...(stGainsPos > 0 ? [{
      name: 'ST Gains', fullName: 'Short-term gains (held <1y)',
      size: stGainsPos, gain: stGainsPos, isPseudo: false, categoryColor: '#f97316',
      nativeCurrency: profile.baseCurrency, nativeValue: stGainsPos, nativeGains: stGainsPos,
    }] : []),
    ...(lossesTotal < 0 ? [{
      name: 'Losses', fullName: 'Unrealized losses',
      size: Math.abs(lossesTotal), gain: lossesTotal, isPseudo: false, categoryColor: '#dc2626',
      nativeCurrency: profile.baseCurrency, nativeValue: Math.abs(lossesTotal), nativeGains: lossesTotal,
    }] : []),
  ]

  const filteredPositionsData: TreemapCell[] = drilldown?.view === 'positions'
    ? (() => {
        const f = drilldown.filter
        let filtered: typeof allHoldings
        if (f.type === 'allocation') filtered = allHoldings.filter(h => h.category === f.category)
        else if (f.type === 'currency') filtered = allHoldings.filter(h => h.nativeCurrency === f.currency || h.category === f.currency)
        else if (f.gainType === 'LT') filtered = allHoldings.filter(h => h.gains !== null && h.gains > 0 && h.isShortTerm === false)
        else if (f.gainType === 'ST') filtered = allHoldings.filter(h => h.gains !== null && h.gains > 0 && h.isShortTerm === true)
        else filtered = allHoldings.filter(h => h.gains !== null && h.gains < 0)
        return filtered.map(positionCell)
      })()
    : []

  const lotsTreemapData: TreemapCell[] = drilldown?.view === 'lots'
    ? allTaxLots
        .filter(lot => lot.ticker === drilldown.ticker)
        .map((lot, i) => {
          const gain = lot.costBasis != null ? lot.marketValue - lot.costBasis : null
          const gainBase = gain != null ? convertToBase(gain, lot.currency as Currency, profile.baseCurrency, DEFAULT_EUR_USD_RATE) : null
          const valBase = convertToBase(lot.marketValue, lot.currency as Currency, profile.baseCurrency, DEFAULT_EUR_USD_RATE)
          const isLT = lot.acquiredDate
            ? (today.getTime() - new Date(lot.acquiredDate).getTime()) / 86400000 >= 365
            : null
          return {
            name: lot.acquiredDate?.slice(0, 7) ?? `Lot ${i + 1}`,
            fullName: `${lot.name} · ${lot.accountName}`,
            size: Math.max(1, valBase),
            gain: gainBase,
            isPseudo: false,
            categoryColor: gain == null ? '#3b82f6' : gain >= 0 ? (isLT === false ? '#f97316' : '#16a34a') : '#dc2626',
            positions: [
              ...(lot.acquiredDate ? [{ label: 'Acquired', value: lot.acquiredDate }] : []),
              { label: 'Account', value: lot.accountName },
              { label: `${lot.quantity.toFixed(2)} sh`, value: lot.marketValue },
              ...(lot.costBasis != null ? [{ label: 'Cost basis', value: lot.costBasis }] : []),
            ] as Array<{ label: string; value: number | string }>,
            nativeCurrency: lot.currency.toUpperCase(),
            nativeValue: lot.marketValue,
            nativeGains: gain,
          }
        })
    : []

  const activeTreemapData: TreemapCell[] =
    drilldown?.view === 'lots' ? lotsTreemapData :
    drilldown?.view === 'positions' ? filteredPositionsData :
    treemapView === 'positions' ? positionsTreemapData :
    treemapView === 'allocation' ? allocTreemapData :
    treemapView === 'currency' ? currencyTreemapData :
    gainsTreemapData

  const activeTreemapTotal = activeTreemapData.reduce((s, d) => s + d.size, 0)

  // ── Drill-down click action ──

  const drilldownActionRef = useRef<(name: string) => void>(() => {})
  drilldownActionRef.current = (name: string) => {
    if (drilldown?.view === 'lots') return
    const isPositionsLevel = !drilldown && treemapView === 'positions'
    const isFilteredPositions = drilldown?.view === 'positions'
    if (isPositionsLevel || isFilteredPositions) {
      if (allTaxLots.some(l => l.ticker === name)) {
        drillInto({ view: 'lots', ticker: name, label: `${name} — lots` })
      }
    } else if (!drilldown && treemapView === 'allocation') {
      drillInto({ view: 'positions', filter: { type: 'allocation', category: name }, label: `${name} — positions` })
    } else if (!drilldown && treemapView === 'currency') {
      drillInto({ view: 'positions', filter: { type: 'currency', currency: name }, label: `${name} — positions` })
    } else if (!drilldown && treemapView === 'gains') {
      const gainType = name === 'LT Gains' ? 'LT' : name === 'ST Gains' ? 'ST' : 'loss'
      drillInto({ view: 'positions', filter: { type: 'gains', gainType }, label: `${name} — positions` })
    }
  }

  // ── Treemap cell renderer ──

  const treemapContent = useCallback((props: any) => {
    const { x, y, width, height, name, fullName, gain, size, categoryColor, showGainInCell, positions, nativeCurrency, nativeValue, nativeGains } = props
    if (size == null || width == null || width <= 0) return null
    const hasGain = gain != null
    const shouldShowGain = showGainInCell !== false
    const positive = (gain ?? 0) >= 0
    const fill = categoryColor ?? (hasGain && shouldShowGain ? (positive ? '#16a34a' : '#dc2626') : '#3b82f6')

    const clipId = `tm-${Math.round(x)}-${Math.round(y)}`
    const lineH = 13
    const showValue = width > 46 && height > 34
    const showGainLine = width > 56 && height > 50 && hasGain && shouldShowGain
    const lines = showGainLine ? 3 : showValue ? 2 : (width > 28 && height > 16) ? 1 : 0
    const startY = y + height / 2 - ((lines - 1) * lineH) / 2

    const nameFontSize = lines >= 1
      ? Math.min(12, Math.max(7, Math.min(width / 5, (width - 6) / (name.length * 0.58))))
      : 0

    let gainPctStr = ''
    if (hasGain && shouldShowGain) {
      const g = nativeGains ?? gain
      const v = nativeValue ?? size
      const cb = v - g
      const gPct = cb > 0 ? (g / cb) * 100 : 0
      gainPctStr = ` (${g >= 0 ? '+' : ''}${gPct.toFixed(1)}%)`
    }

    return (
      <g
        onClick={() => drilldownActionRef.current(name)}
        onMouseEnter={e => {
          setHoveredHolding({
            ticker: name, fullName: fullName ?? name, value: size,
            gains: gain ?? null, positions,
            nativeCurrency: nativeCurrency ?? profile.baseCurrency,
            nativeValue: nativeValue ?? size,
            nativeGains: nativeGains ?? null,
          })
          setTreemapPos({ x: e.clientX, y: e.clientY })
        }}
        onMouseMove={e => setTreemapPos({ x: e.clientX, y: e.clientY })}
        onMouseLeave={() => setHoveredHolding(null)}
        style={{ cursor: 'pointer' }}
      >
        <rect x={x} y={y} width={width} height={height} fill={fill} fillOpacity={0.75}
          stroke="white" strokeWidth={1.5} rx={2} />
        {lines >= 1 && (
          <>
            <clipPath id={clipId}>
              <rect x={x + 2} y={y + 2} width={Math.max(0, width - 4)} height={Math.max(0, height - 4)} />
            </clipPath>
            <g clipPath={`url(#${clipId})`}>
              <text x={x + width / 2} y={startY} textAnchor="middle" dominantBaseline="middle"
                fill="white" fontSize={nameFontSize} fontWeight={600}>{name}</text>
              {lines >= 2 && (
                <text x={x + width / 2} y={startY + lineH} textAnchor="middle" dominantBaseline="middle"
                  fill="white" fillOpacity={0.9} fontSize={10} fontWeight={500}>
                  {formatCompact(nativeValue ?? size, nativeCurrency ?? profile.baseCurrency)}
                </text>
              )}
              {lines >= 3 && hasGain && shouldShowGain && (
                <text x={x + width / 2} y={startY + 2 * lineH} textAnchor="middle" dominantBaseline="middle"
                  fill={positive ? '#86efac' : '#fca5a5'} fontSize={9}>
                  {gain >= 0 ? '+' : ''}{formatCompact(nativeGains ?? gain, nativeCurrency ?? profile.baseCurrency)}{gainPctStr}
                </text>
              )}
            </g>
          </>
        )}
      </g>
    )
  }, [profile.baseCurrency, activeTreemapTotal])

  // ── Account filter toggle ──

  function toggleAccount(id: number) {
    setSelectedAccountIds(prev => {
      const allIds = portfolioAccounts.map(a => a.id)
      const current = prev ?? new Set(allIds)
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      if (next.size === 0) return prev  // prevent deselecting all
      if (next.size === allIds.length) return null  // all selected = null
      return next
    })
  }

  // ── Derived ──

  const portfolioAccounts = useMemo(() =>
    includedAccounts
      .filter(a => a.type === 'investment' || a.type === 'retirement')
      .sort((a, b) => getAccountBaseValue(b) - getAccountBaseValue(a)),
    [includedAccounts] // eslint-disable-line react-hooks/exhaustive-deps
  )

  const mostRecentSyncedAt = useMemo(() => {
    const dates = portfolioAccounts.map(a => a.syncedAt).filter(Boolean).sort()
    return dates.length ? dates[dates.length - 1] : null
  }, [portfolioAccounts])

  // ── Portfolio events from broker data (dividends from Plaid accounts) ──
  const portfolioEventsByDate = useMemo(() => {
    type PEvent = { emoji: string; color: string; label: string }
    const map = new Map<string, PEvent[]>()
    const add = (dateKey: string, ev: PEvent) => {
      if (!map.has(dateKey)) map.set(dateKey, [])
      map.get(dateKey)!.push(ev)
    }
    for (const a of portfolioAccounts) {
      for (const d of a.dividends ?? []) {
        if (!d.date) continue
        const dateKey = isDaily ? d.date : d.date.slice(0, 7)
        const amtBase = convertToBase(d.amount, d.currency as Currency, profile.baseCurrency, DEFAULT_EUR_USD_RATE)
        if (amtBase < 5) continue  // skip tiny amounts
        add(dateKey, { emoji: '$', color: '#22c55e', label: `${d.securityName || d.ticker || 'Div'}: +${formatCompact(amtBase, profile.baseCurrency)}` })
      }
    }
    return map
  }, [portfolioAccounts, isDaily, profile.baseCurrency]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Tooltip content ──

  const divDetailTooltip = (
    <div>
      <div className="font-semibold mb-1.5">Dividends — next 12m</div>
      {divByAccount.size === 0
        ? <div className="text-gray-400 italic">Yield estimate (no Tiingo data)</div>
        : [...divByAccount.entries()].map(([accName, items], i) => (
            <div key={i} className={i > 0 ? 'mt-1.5 pt-1.5 border-t border-gray-700' : ''}>
              <div className="text-gray-300 text-[9px] font-semibold uppercase tracking-wide mb-0.5">{accName}</div>
              {items.sort((a, b) => b.annualBase - a.annualBase).map((d, j) => (
                <div key={j} className="flex justify-between gap-3 pl-1">
                  <span className="text-gray-400">{d.ticker}</span>
                  <span className="text-green-400">+{formatCompact(d.annualBase, profile.baseCurrency)}</span>
                </div>
              ))}
            </div>
          ))
      }
      {tickersWithHistory.length > 0 && (
        <div className="text-gray-400 text-[9px] mt-1.5 border-t border-gray-700 pt-1.5">
          {tickersWithHistory.length} tickers · {dividendSyncedAt ? `synced ${new Date(dividendSyncedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : 'not yet synced'}
        </div>
      )}
    </div>
  )

  const interestDetailTooltip = (
    <div>
      <div className="font-semibold mb-1.5">Interest income — annual est.</div>
      {interestByAccount.size === 0
        ? <div className="text-gray-400 italic">No fixed-income positions</div>
        : [...interestByAccount.entries()].map(([accName, items], i) => (
            <div key={i} className={i > 0 ? 'mt-1.5 pt-1.5 border-t border-gray-700' : ''}>
              <div className="text-gray-300 text-[9px] font-semibold uppercase tracking-wide mb-0.5">{accName}</div>
              {items.sort((a, b) => b.annualBase - a.annualBase).map((d, j) => (
                <div key={j} className="flex justify-between gap-3 pl-1">
                  <span className="text-gray-400">{d.ticker}</span>
                  <span className="text-green-400">+{formatCompact(d.annualBase, profile.baseCurrency)}</span>
                </div>
              ))}
            </div>
          ))
      }
      <div className="text-gray-400 text-[9px] mt-1.5 border-t border-gray-700 pt-1.5">
        T-bills @ 4.5% · USD cash @ 4.0% · EUR cash @ 2.5%
      </div>
    </div>
  )

  const divSub = (
    <span className="inline-flex items-center gap-0.5">
      From{' '}
      <InfoTooltip text={divDetailTooltip} trigger={
        <span className="border-b border-dotted border-gray-400 dark:border-gray-500 cursor-help mx-0.5">{divAccountCount}</span>
      } />
      {' '}account{divAccountCount !== 1 ? 's' : ''}
    </span>
  )

  const interestSub = (
    <span className="inline-flex items-center gap-0.5">
      From{' '}
      <InfoTooltip text={interestDetailTooltip} trigger={
        <span className="border-b border-dotted border-gray-400 dark:border-gray-500 cursor-help mx-0.5">{interestAccountCount}</span>
      } />
      {' '}account{interestAccountCount !== 1 ? 's' : ''}
    </span>
  )

  // usdTooltip: reserved for USD exposure detail — wire up to InfoTooltip when the risk panel is built

  const syncLabel = mostRecentSyncedAt
    ? `Last synced ${new Date(mostRecentSyncedAt).toLocaleString(undefined, { month: 'numeric', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}`
    : 'Never synced'

  // ── Table views ──

  function TableViewPositions() {
    return (
      <div className="space-y-px max-h-[240px] overflow-y-auto">
        {allHoldings.slice(0, 30).map((h, i) => (
          <div key={i} className="flex justify-between items-center py-[4px] border-b border-gray-100 dark:border-gray-700 last:border-0 text-[11px]">
            <div className="min-w-0 flex-1 pr-2">
              <div className="font-medium text-gray-900 dark:text-gray-100 truncate">
                {h.isPseudo ? `(${h.name})` : (h.ticker || h.name)}
              </div>
              <div className="text-[10px] text-gray-400 truncate">{h.name}</div>
            </div>
            <div className="text-right shrink-0">
              <div className="font-medium">{formatCurrency(h.nativeValue, h.nativeCurrency)}</div>
              <div className={`text-[10px] ${h.nativeGains != null && h.nativeGains >= 0 ? 'text-green-500' : h.nativeGains != null ? 'text-red-500' : 'text-gray-400'}`}>
                {h.nativeGains != null
                  ? `${h.nativeGains >= 0 ? '+' : ''}${formatCurrency(Math.abs(h.nativeGains), h.nativeCurrency)}${h.isShortTerm ? ' ST' : ''}${h.acquiredDate ? ` · ${h.acquiredDate}` : ''}`
                  : h.isPseudo ? 'no Plaid sync' : 'no cost basis'}
              </div>
            </div>
          </div>
        ))}
      </div>
    )
  }

  function TableViewAllocation() {
    const total = allocTreemapData.reduce((s, d) => s + d.size, 0)
    return (
      <div className="space-y-px max-h-[240px] overflow-y-auto">
        {allocTreemapData.map((d, i) => (
          <div key={i} className="flex items-center gap-2 py-[5px] border-b border-gray-100 dark:border-gray-700 last:border-0 text-[11px]">
            <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: d.categoryColor }} />
            <span className="flex-1 text-gray-800 dark:text-gray-200">{d.name}</span>
            <span className="font-medium">{formatCompact(d.nativeValue, d.nativeCurrency)}</span>
            <span className="text-gray-400 w-[36px] text-right">{total > 0 ? (d.size / total * 100).toFixed(1) : 0}%</span>
          </div>
        ))}
      </div>
    )
  }

  function TableViewCurrency() {
    const total = currencyTreemapData.reduce((s, d) => s + d.size, 0)
    return (
      <div className="space-y-px max-h-[240px] overflow-y-auto">
        {currencyTreemapData.map((d, i) => (
          <div key={i} className="flex items-center gap-2 py-[5px] border-b border-gray-100 dark:border-gray-700 last:border-0 text-[11px]">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: d.categoryColor }} />
            <span className="flex-1 text-gray-800 dark:text-gray-200 font-medium">{d.name}</span>
            <span className="font-medium">{formatCompact(d.nativeValue, d.nativeCurrency)}</span>
            <span className="text-gray-400 w-[36px] text-right">{total > 0 ? (d.size / total * 100).toFixed(1) : 0}%</span>
          </div>
        ))}
      </div>
    )
  }

  function TableViewGains() {
    const items = [
      ...(ltGainsPos > 0 ? [{ label: 'LT Gains (>1y)', value: ltGainsPos, color: '#16a34a', cls: 'text-green-600' }] : []),
      ...(stGainsPos > 0 ? [{ label: 'ST Gains (<1y)', value: stGainsPos, color: '#f97316', cls: 'text-amber-500' }] : []),
      ...(lossesTotal < 0 ? [{ label: 'Unrealized losses', value: lossesTotal, color: '#dc2626', cls: 'text-red-500' }] : []),
    ]
    return (
      <div className="space-y-px max-h-[240px] overflow-y-auto">
        {items.map((item, i) => (
          <div key={i} className="flex items-center gap-2 py-[5px] border-b border-gray-100 dark:border-gray-700 last:border-0 text-[11px]">
            <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: item.color }} />
            <span className="flex-1 text-gray-800 dark:text-gray-200">{item.label}</span>
            <span className={`font-medium ${item.cls}`}>
              {item.value >= 0 ? '+' : ''}{formatCompact(item.value, profile.baseCurrency)}
            </span>
          </div>
        ))}
        {items.length === 0 && (
          <div className="text-[11px] text-gray-400 py-4 text-center">No gains data</div>
        )}
      </div>
    )
  }

  return (
    <div>
      <PageHeader title="Investments">
        {divSyncing && (
          <span className="text-[10px] text-gray-400">Syncing dividends…</span>
        )}
      </PageHeader>

      <div className="p-4 space-y-4">

        {/* ── Metric cards ── */}
        <div className="grid grid-cols-5 gap-[9px]">
          <MetricCard
            label="Total invested"
            value={formatCompact(invested, profile.baseCurrency)}
            tooltip="Total value of investment and retirement accounts."
            sub="excl. cash & real estate"
          />

          {/* Returns card: vertical label / value pairs */}
          <div className="col-span-2 bg-gray-50 dark:bg-gray-800 rounded-lg px-[13px] py-[11px]">
            <div className="text-[11px] text-gray-500 dark:text-gray-400 mb-[7px] flex items-center gap-0.5">
              Returns
              <InfoTooltip text="Today: most recent trading day. YTD/12m: time-weighted using current holdings. All: unrealized gain vs cost basis. Excludes cash and T-bills." />
            </div>
            <div className="space-y-[3px]">
              {([
                { label: 'Today', pct: todayData.pct, spy: todayData.spy, amt: todayData.pct != null ? todayData.pct * invested : null, noData: !tiingoApiKey },
                { label: 'YTD',   pct: portfolioYtd,  spy: spyYtd,       amt: portfolioYtd != null ? portfolioYtd * invested : null,  noData: !tiingoApiKey },
                { label: '12m',   pct: portfolio12m,  spy: spy12m,        amt: portfolio12m != null ? portfolio12m * invested : null,  noData: !tiingoApiKey },
                { label: 'All',   pct: totalReturnPct, spy: null,          amt: totalNetGains !== 0 ? totalNetGains : null,            noData: false },
              ] as Array<{ label: string; pct: number | null; spy: number | null; amt: number | null; noData: boolean }>).map((item, i) => (
                <div key={item.label} className="flex items-baseline justify-between gap-2">
                  <span className="text-[11px] text-gray-400 shrink-0 w-[28px]">{item.label}</span>
                  <div className="flex items-baseline gap-1 min-w-0">
                    <span className={`tabular-nums font-semibold ${i === 0 ? 'text-[20px]' : 'text-[12px]'} ${item.pct != null ? returnClass(item.pct) : 'text-gray-300 dark:text-gray-600'}`}>
                      {item.pct != null ? fmtReturn(item.pct) : item.noData ? '–' : '—'}
                    </span>
                    {item.amt != null && i > 0 && (
                      <span className="text-[9.5px] text-gray-400 font-normal whitespace-nowrap">
                        ({item.amt >= 0 ? '+' : ''}{formatCompact(item.amt, profile.baseCurrency)})
                      </span>
                    )}
                    {item.spy != null && (
                      <span className={`text-[9.5px] font-normal whitespace-nowrap ${returnClass(item.spy)}`}>
                        SPY {fmtReturn(item.spy)}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <MetricCard
            label="Annual dividends"
            tooltip="Projected dividends for the next 12 months, based on historical payment patterns."
            value={formatCompact(annualDivBase, profile.baseCurrency)}
            valueClass="text-green-600"
            sub={divSub}
          />
          <MetricCard
            label="Annual interests"
            tooltip="Estimated annual interest from fixed-income positions, T-bills, and cash."
            value={formatCompact(annualInterestBase, profile.baseCurrency)}
            valueClass="text-green-600"
            sub={interestSub}
          />
        </div>

        {/* ── Performance chart ── */}
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <div className="flex items-center gap-3">
              <div className="text-[11.5px] font-medium text-gray-500 dark:text-gray-400">Performance</div>
              <div className="flex items-center gap-1">
                {(['$', '%'] as const).map(m => (
                  <button key={m} onClick={() => setChartMode(m)}
                    className={`text-[10.5px] px-2 py-[2px] rounded transition-colors ${
                      chartMode === m
                        ? 'bg-gray-800 dark:bg-gray-200 text-white dark:text-gray-900'
                        : 'border border-gray-200 dark:border-gray-700 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'
                    }`}>{m}</button>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[10px] text-gray-400">Accounts:</span>
              {[...portfolioAccounts].sort((a, b) => a.name.localeCompare(b.name)).map(a => {
                const isSelected = selectedAccountIds === null || selectedAccountIds.has(a.id)
                return (
                  <button
                    key={a.id}
                    onClick={() => toggleAccount(a.id)}
                    className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${
                      isSelected
                        ? 'bg-blue-100 dark:bg-blue-900/30 border-blue-300 dark:border-blue-600 text-blue-700 dark:text-blue-400'
                        : 'border-gray-200 dark:border-gray-700 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'
                    }`}
                  >
                    {a.name}
                  </button>
                )
              })}
            </div>
            <div className="flex items-center gap-1">
              {HIST_RANGES.map(r => (
                <button key={r} onClick={() => setHistoryRange(r)}
                  className={`text-[10.5px] px-2.5 py-[3px] rounded transition-colors ${
                    historyRange === r
                      ? 'bg-gray-800 dark:bg-gray-200 text-white dark:text-gray-900'
                      : 'border border-gray-200 dark:border-gray-700 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'
                  }`}>{r}</button>
              ))}
            </div>
          </div>
          {historyChartData.length === 0 ? (
            <div className="h-[220px] flex items-center justify-center text-[11.5px] text-gray-400">
              {tiingoApiKey ? 'Loading performance data…' : 'Set a Tiingo API key in Settings to see history.'}
            </div>
          ) : (
            <>
              <div className="h-[210px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={historyChartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" strokeOpacity={0.4} />
                    <XAxis dataKey="date" tickFormatter={fmtChartDate} tick={{ fontSize: 10 }} tickLine={false} axisLine={false} minTickGap={40} />
                    <YAxis
                      tick={{ fontSize: 10 }}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={chartMode === '$'
                        ? (v: number) => formatCompact(v, profile.baseCurrency)
                        : (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(0)}%`}
                      width={52}
                    />
                    <ReferenceLine y={0} stroke="#9ca3af" strokeDasharray="3 3" />
                    <RCTooltip
                      content={({ active, payload, label }) => {
                        if (!active || !payload?.length) return null
                        const port = payload.find((p: any) => p.dataKey === (chartMode === '$' ? 'portfolioValue' : 'portfolio'))
                        const spy = payload.find((p: any) => p.dataKey === (chartMode === '$' ? 'spyValue' : 'spy'))
                        const evts = portfolioEventsByDate.get(label as string) ?? []
                        return (
                          <div className="bg-gray-900 text-white text-[11px] px-3 py-2 rounded-lg shadow-xl min-w-[160px]">
                            <div className="text-gray-400 mb-1">{fmtChartDate(label as string)}</div>
                            {port && (
                              <div className="flex justify-between gap-3">
                                <span className="text-blue-400">Portfolio</span>
                                <span className={chartMode === '$' ? '' : returnClass(port.value as number)}>
                                  {chartMode === '$' ? formatCompact(port.value as number, profile.baseCurrency) : fmtReturn((port.value as number) / 100)}
                                </span>
                              </div>
                            )}
                            {spy && spy.value != null && (
                              <div className="flex justify-between gap-3">
                                <span className="text-orange-400">SPY (norm.)</span>
                                <span className={chartMode === '$' ? '' : returnClass(spy.value as number)}>
                                  {chartMode === '$' ? formatCompact(spy.value as number, profile.baseCurrency) : fmtReturn((spy.value as number) / 100)}
                                </span>
                              </div>
                            )}
                            {evts.length > 0 && (
                              <div className="mt-1.5 pt-1.5 border-t border-gray-700 space-y-[3px]">
                                {evts.map((ev, i) => (
                                  <div key={i} className="flex items-center gap-1.5 text-[10px]">
                                    <span className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full text-[8px]" style={{ background: ev.color }}>{ev.emoji}</span>
                                    <span className="text-gray-300 truncate">{ev.label}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )
                      }}
                    />
                    {[...portfolioEventsByDate.entries()]
                      .filter(([dateKey]) => historyChartData.some(d => d.date === dateKey))
                      .map(([dateKey, evts]) => (
                        <ReferenceLine key={dateKey} x={dateKey} stroke={evts[0]?.color ?? '#64748b'} strokeDasharray="4 2" strokeWidth={1.5}
                          label={({ viewBox }: any) => {
                            if (!viewBox || viewBox.x == null) return <g />
                            return (
                              <g transform={`translate(${Math.max(8, viewBox.x) + 4}, 6)`}>
                                {evts.slice(0, 3).map((ev, i) => (
                                  <g key={i} transform={`translate(0, ${i * 16})`}>
                                    <circle r="6" fill={ev.color} fillOpacity={0.9} />
                                    <text y="3.5" textAnchor="middle" fontSize="9" fill="#fff">{ev.emoji}</text>
                                  </g>
                                ))}
                              </g>
                            )
                          }}
                        />
                      ))
                    }
                    <Line type="monotone" dataKey={chartMode === '$' ? 'portfolioValue' : 'portfolio'} stroke="#3b82f6" strokeWidth={1.5} dot={false} name="Portfolio" connectNulls />
                    <Line type="monotone" dataKey={chartMode === '$' ? 'spyValue' : 'spy'} stroke="#f97316" strokeWidth={1.5} dot={false} name="SPY" connectNulls />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div className="flex items-center gap-3 mt-1 pb-1 text-[10px] text-gray-400 justify-end">
                <span className="flex items-center gap-1"><span className="w-3 h-[2px] bg-blue-500 inline-block rounded" /> Portfolio</span>
                <span className="flex items-center gap-1"><span className="w-3 h-[2px] bg-orange-400 inline-block rounded" /> SPY {chartMode === '$' ? '(normalized)' : ''}</span>
              </div>
            </>
          )}
        </Card>

        {/* ── Holdings treemap + accounts ── */}
        <div className="grid grid-cols-[2fr_1fr] gap-3">
          <Card>
            {drilldown ? (
              <div className="flex items-center gap-2 mb-2">
                <button onClick={goBack} className="text-[10.5px] text-blue-500 hover:underline">← Back</button>
                <span className="text-[10px] text-gray-400">{drilldown.label}</span>
              </div>
            ) : (
              <div className="flex justify-between items-center mb-2">
                <div className="flex items-center gap-1">
                  {(['positions', 'allocation', 'currency', 'gains'] as TreemapView[]).map(v => (
                    <button key={v} onClick={() => { setTreemapView(v); setDrilldownStack([]); setShowTableView(false) }}
                      className={`text-[10.5px] px-2.5 py-[3px] rounded transition-colors ${
                        treemapView === v
                          ? 'bg-gray-800 dark:bg-gray-200 text-white dark:text-gray-900'
                          : 'border border-gray-200 dark:border-gray-700 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'
                      }`}>
                      {v === 'positions' ? `Positions${allHoldings.length > 0 ? ` (${allHoldings.length})` : ''}`
                        : v === 'allocation' ? 'Allocation'
                        : v === 'currency' ? 'Currency'
                        : 'Gains'}
                    </button>
                  ))}
                </div>
                <ViewToggle showTable={showTableView} onToggle={() => setShowTableView(v => !v)} />
              </div>
            )}

            {showTableView && !drilldown ? (
              treemapView === 'positions' ? <TableViewPositions /> :
              treemapView === 'allocation' ? <TableViewAllocation /> :
              treemapView === 'currency' ? <TableViewCurrency /> :
              <TableViewGains />
            ) : (
              <div>
                <div className="h-[240px]">
                  {activeTreemapData.length === 0 ? (
                    <div className="h-full flex items-center justify-center text-[11.5px] text-gray-400">
                      {drilldown?.view === 'lots'
                        ? 'No tax lots available for this position.'
                        : treemapView === 'positions'
                          ? <>Link investment accounts to Plaid in <a href="#/config/accounts" className="text-blue-600 underline ml-1">Accounts</a>.</>
                          : treemapView === 'gains'
                            ? 'No unrealized gains data — link Plaid accounts with cost basis.'
                            : 'No data.'}
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <Treemap
                        data={activeTreemapData}
                        dataKey="size"
                        content={treemapContent as any}
                        isAnimationActive={false}
                      />
                    </ResponsiveContainer>
                  )}
                </div>
                {!drilldown && treemapView === 'positions' && (
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-[10px] text-gray-400">
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm inline-block" style={{ background: '#15803d' }} /> &gt;20%</span>
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm inline-block" style={{ background: '#22c55e' }} /> 0–20%</span>
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm inline-block" style={{ background: '#4ade80' }} /> 0%</span>
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm inline-block" style={{ background: '#fca5a5' }} /> 0 to −5%</span>
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm inline-block" style={{ background: '#b91c1c' }} /> &lt;−15%</span>
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm inline-block" style={{ background: '#6b7280' }} /> no cost basis</span>
                    <span className="text-[9px] text-gray-300 ml-auto">click to drill in</span>
                  </div>
                )}
                {!drilldown && treemapView === 'allocation' && (
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-[10px] text-gray-400">
                    {allocTreemapData.map(d => (
                      <span key={d.name} className="flex items-center gap-1">
                        <span className="w-2 h-2 rounded-sm inline-block" style={{ background: d.categoryColor }} />
                        {d.name}
                      </span>
                    ))}
                    <span className="text-[9px] text-gray-300 ml-auto">click to drill in</span>
                  </div>
                )}
                {!drilldown && treemapView === 'currency' && (
                  <div className="flex items-center gap-1 mt-2 text-[9px] text-gray-300 justify-end">
                    click to drill in
                  </div>
                )}
                {!drilldown && treemapView === 'gains' && (
                  <div className="flex items-center gap-3 mt-2 text-[10px] text-gray-400">
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm inline-block bg-green-600 opacity-70" /> LT gains (&gt;1y)</span>
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm inline-block bg-orange-500 opacity-70" /> ST gains (&lt;1y)</span>
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm inline-block bg-red-600 opacity-70" /> Losses</span>
                    <span className="text-[9px] text-gray-300 ml-auto">click bucket to drill in</span>
                  </div>
                )}
                {drilldown?.view === 'positions' && (
                  <div className="flex items-center gap-1 mt-2 text-[9px] text-gray-300 justify-end">
                    click position to see lots
                  </div>
                )}
              </div>
            )}
          </Card>

          {/* Accounts list */}
          <Card className="self-start">
            <div className="flex items-center justify-between mb-1">
              <div className="text-[11.5px] font-medium text-gray-500 dark:text-gray-400">
                Accounts ({portfolioAccounts.length})
              </div>
              <div className="flex items-center gap-2">
                {portfolioSyncMsg && (
                  <span className="text-[9.5px] text-gray-400 truncate max-w-[100px]">{portfolioSyncMsg}</span>
                )}
                <button
                  onClick={syncPortfolioAccounts}
                  disabled={portfolioSyncing || !lmProxyUrl}
                  title={syncLabel}
                  className="p-[4px] rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-40 transition-colors"
                >
                  <RefreshCw size={12} className={portfolioSyncing ? 'animate-spin' : ''} />
                </button>
              </div>
            </div>
            {mostRecentSyncedAt && (
              <div className="text-[9.5px] text-gray-400 mb-2">
                {syncLabel}
              </div>
            )}
            {portfolioAccounts.length === 0 ? (
              <div className="text-[11px] text-gray-400">No investment or retirement accounts.</div>
            ) : (
              <>
                {/* Column header */}
                <div className="flex items-center text-[9.5px] text-gray-400 pb-[4px] border-b border-gray-200 dark:border-gray-700 gap-1">
                  <span className="flex-1">Account</span>
                  <span className="w-[72px] text-right shrink-0">Balance</span>
                  <span className="w-[60px] text-right shrink-0">LT gains</span>
                  <span className="w-[60px] text-right shrink-0">ST gains</span>
                </div>
                <div className="space-y-px">
                  {portfolioAccounts.map(a => {
                    const gains = perAccountGains.get(a.id)
                    const ibkrHealthy = (a.taxLots ?? []).some(l => l.source === 'ibkr-flex')
                    const plaidHealthy = (a.holdings?.length ?? 0) > 0
                    return (
                      <div key={a.id} className="flex items-center py-[5px] border-b border-gray-100 dark:border-gray-700 last:border-0 text-[11px] gap-1">
                        {/* Name + badges */}
                        <div className="flex-1 min-w-0">
                          <div className="truncate text-gray-800 dark:text-gray-200">{a.name}</div>
                          <div className="flex items-center gap-1 mt-[2px] flex-wrap">
                            <span className="text-[9.5px] text-gray-400 capitalize">{a.type}</span>
                            {a.ibkrAccountId && (
                              <span className="shrink-0 inline-flex items-center gap-[3px] text-[9px] font-medium px-1 py-0.5 rounded bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400">
                                IBKR <ProviderDot healthy={ibkrHealthy} />
                              </span>
                            )}
                            {a.plaidAccessToken && (
                              <span className="shrink-0 inline-flex items-center gap-[3px] text-[9px] font-medium px-1 py-0.5 rounded bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400">
                                Plaid <ProviderDot healthy={plaidHealthy} />
                              </span>
                            )}
                          </div>
                        </div>
                        {/* Balance */}
                        <div className="w-[72px] text-right shrink-0">
                          <div className="font-medium">{formatCurrency(a.balance, a.currency)}</div>
                          {a.currency.toUpperCase() !== profile.baseCurrency && (
                            <div className="text-[9.5px] text-gray-400">{formatCompact(getAccountBaseValue(a), profile.baseCurrency)}</div>
                          )}
                        </div>
                        {/* LT */}
                        <div className="w-[52px] text-right shrink-0 text-[10px]">
                          {gains?.lt != null && gains.lt !== 0 ? (
                            <span className={gains.lt >= 0 ? 'text-green-500' : 'text-red-500'}>
                              {gains.lt >= 0 ? '+' : ''}{formatCompact(gains.lt, profile.baseCurrency)}
                            </span>
                          ) : <span className="text-gray-300">—</span>}
                        </div>
                        {/* ST */}
                        <div className="w-[52px] text-right shrink-0 text-[10px]">
                          {gains?.st != null && gains.st !== 0 ? (
                            <span className={gains.st >= 0 ? 'text-amber-500' : 'text-red-500'}>
                              {gains.st >= 0 ? '+' : ''}{formatCompact(gains.st, profile.baseCurrency)}
                            </span>
                          ) : <span className="text-gray-300">—</span>}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </>
            )}
          </Card>
        </div>

      </div>

      {/* ── Treemap hover tooltip ── */}
      {hoveredHolding && (() => {
        const tickerUp = hoveredHolding.ticker.toUpperCase()
        const tickerMonthly = perfReturnsMap.get(tickerUp) ?? []
        const tickerYtd = tickerMonthly.length > 0 ? compoundReturns(tickerMonthly, ytdStartMonth, currentMonth) : null
        const ticker12m = tickerMonthly.length > 0 ? compoundReturns(tickerMonthly, year12StartMonth, currentMonth) : null
        const hasPerf = tickerYtd != null || ticker12m != null
        const totalReturnPctHolding = (hoveredHolding.nativeGains != null && hoveredHolding.nativeValue > hoveredHolding.nativeGains)
          ? hoveredHolding.nativeGains / (hoveredHolding.nativeValue - hoveredHolding.nativeGains)
          : null

        return (
          <div
            style={{ position: 'fixed', left: treemapPos.x + 14, top: treemapPos.y - 10, zIndex: 50, pointerEvents: 'none' }}
            className="bg-gray-900 text-white text-[11px] px-3 py-2 rounded-lg shadow-xl max-w-[240px]"
          >
            <div className="font-semibold">{hoveredHolding.ticker !== hoveredHolding.fullName ? hoveredHolding.ticker : hoveredHolding.fullName}</div>
            {hoveredHolding.ticker !== hoveredHolding.fullName && (
              <div className="text-gray-400 text-[10px]">{hoveredHolding.fullName}</div>
            )}
            <div className="mt-1 font-medium">{formatCurrency(hoveredHolding.nativeValue, hoveredHolding.nativeCurrency)}</div>
            {/* Returns: total, 12m, YTD */}
            {(totalReturnPctHolding != null || hasPerf) && (
              <div className="mt-1.5 pt-1.5 border-t border-gray-700 space-y-[3px]">
                {totalReturnPctHolding != null && (
                  <div className="flex justify-between gap-3 text-[10px]">
                    <span className="text-gray-300">Total return</span>
                    <span className={returnClass(totalReturnPctHolding)}>{fmtReturn(totalReturnPctHolding)}</span>
                  </div>
                )}
                {ticker12m != null && (
                  <div className="flex justify-between gap-3 text-[10px]">
                    <span className="text-gray-300">Last 12m</span>
                    <span className={returnClass(ticker12m)}>{fmtReturn(ticker12m)}</span>
                  </div>
                )}
                {tickerYtd != null && (
                  <div className="flex justify-between gap-3 text-[10px]">
                    <span className="text-gray-300">YTD</span>
                    <span className={returnClass(tickerYtd)}>{fmtReturn(tickerYtd)}</span>
                  </div>
                )}
              </div>
            )}
            {hoveredHolding.positions && hoveredHolding.positions.length > 0 && (
              <div className="mt-2 pt-2 border-t border-gray-700 space-y-[3px]">
                {hoveredHolding.positions.map((p, i) => (
                  <div key={i} className="flex justify-between gap-3 text-[10px]">
                    <span className="text-gray-300 truncate">{p.label}</span>
                    <span className="text-gray-400 shrink-0">
                      {typeof p.value === 'string' ? p.value : formatCompact(p.value, profile.baseCurrency)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })()}
    </div>
  )
}
