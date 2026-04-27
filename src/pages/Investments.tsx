import { useState, useCallback } from 'react'
import {
  ResponsiveContainer, Treemap,
} from 'recharts'
import { useAppStore } from '../store/useAppStore'
import { PageHeader } from '../components/ui/PageHeader'
import { MetricCard } from '../components/ui/MetricCard'
import { Card, CardTitle } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { formatCompact, formatCurrency, formatYearMonth } from '../lib/format'
import { convertToBase, DEFAULT_EUR_USD_RATE } from '../lib/currency'
import { projectedAnnualDividendsEUR } from '../lib/dividends'
import { fetchTickerDividends, projectDividends } from '../lib/alphavantage'
import type { ProjectedDividend } from '../lib/alphavantage'

// ─── Types ─────────────────────────────────────────────────────────────────────

type ExtDividend = ProjectedDividend & {
  currency: string; accountId: string; accountName: string; isActual: boolean
}
type MonthGroup = { month: string; totalEUR: number; items: ExtDividend[]; isPast: boolean }
type TreemapView = 'holdings' | 'allocation' | 'currency'

// ─── Constants ─────────────────────────────────────────────────────────────────

const ALLOC_COLORS: Record<string, string> = {
  Stocks: '#22c55e',
  Bonds: '#378ADD',
  Cash: '#94a3b8',
  'Real Estate': '#f59e0b',
  Other: '#6b7280',
}

const CURRENCY_PALETTE = ['#378ADD', '#22c55e', '#f59e0b', '#a78bfa', '#34d399', '#94a3b8']
function currencyColor(cur: string, idx: number): string {
  const explicit: Record<string, string> = { USD: '#378ADD', EUR: '#22c55e', GBP: '#f59e0b' }
  return explicit[cur] ?? CURRENCY_PALETTE[idx % CURRENCY_PALETTE.length]
}

function empowerCategory(securityType: string, ticker: string | null): string {
  if (ticker?.startsWith('CUR:')) return 'Cash'
  switch (securityType.toLowerCase()) {
    case 'equity': case 'etf': case 'mutual fund': return 'Stocks'
    case 'fixed income': return 'Bonds'
    case 'cash': case 'money market': return 'Cash'
    default: return 'Other'
  }
}

// ─── Small UI helpers ──────────────────────────────────────────────────────────

function InfoTooltip({ text }: { text: string }) {
  return (
    <span className="relative inline-block group ml-1 align-middle cursor-help">
      <span className="inline-flex items-center justify-center w-3.5 h-3.5 text-[9px] text-gray-400 border border-gray-300 dark:border-gray-600 rounded-full leading-none select-none">?</span>
      <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 w-52 bg-gray-900 dark:bg-gray-700 text-white text-[10px] leading-[1.4] px-2.5 py-2 rounded-lg shadow-xl opacity-0 group-hover:opacity-100 pointer-events-none z-[60] whitespace-normal text-left font-normal normal-case transition-opacity duration-100">
        {text}
      </span>
    </span>
  )
}

function ViewToggle({ showTable, onToggle }: { showTable: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      className="text-[10px] px-2 py-[3px] rounded border border-gray-200 dark:border-gray-700 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
    >
      {showTable ? '⬡ Chart' : '⊞ Table'}
    </button>
  )
}

function RiskBar({ label, value, max, color, note, precision = 0, tooltip }: {
  label: string; value: number; max: number; color: string
  note?: string; precision?: number; tooltip?: string
}) {
  const pct = Math.min(100, (value / max) * 100)
  return (
    <div>
      <div className="flex justify-between items-baseline mb-[3px]">
        <span className="text-[11px] text-gray-600 dark:text-gray-400">
          {label}{tooltip && <InfoTooltip text={tooltip} />}
        </span>
        <span className="text-[11px] font-medium">
          {value.toFixed(precision)}%
          {note && <span className="text-[10px] text-gray-400 font-normal ml-1">{note}</span>}
        </span>
      </div>
      <div className="h-[5px] rounded-full bg-gray-100 dark:bg-gray-700">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  )
}

// ─── Month tooltip ─────────────────────────────────────────────────────────────

function MonthTooltip({ group }: { group: MonthGroup }) {
  const byAccount = new Map<string, { name: string; items: ExtDividend[] }>()
  for (const item of group.items) {
    if (!byAccount.has(item.accountId)) byAccount.set(item.accountId, { name: item.accountName, items: [] })
    byAccount.get(item.accountId)!.items.push(item)
  }
  return (
    <div className="min-w-[210px] max-w-[290px]">
      <div className="font-semibold mb-2 flex items-center gap-2">
        {formatYearMonth(group.month)}
        {group.isPast && <span className="text-[9px] text-gray-400 font-normal border border-gray-600 rounded px-1">actual</span>}
      </div>
      {[...byAccount.values()].map(({ name, items }) => (
        <div key={name} className="mb-2 last:mb-0">
          <div className="text-gray-400 text-[10px] uppercase tracking-wide mb-[3px]">{name}</div>
          {items.map((d, i) => (
            <div key={i} className="flex justify-between gap-3 text-[10.5px]">
              <span className="text-gray-300">
                {d.ticker} · {d.sharesHeld.toFixed(2)} sh @ {formatCurrency(d.amount, d.currency, 2)}
              </span>
              <span className="text-green-400 shrink-0">+{formatCurrency(d.totalAmount, d.currency, 2)}</span>
            </div>
          ))}
        </div>
      ))}
      <div className="border-t border-gray-600 mt-2 pt-1 flex justify-between text-[11px]">
        <span className="text-gray-400">Total</span>
        <span className="text-green-400 font-medium">+{formatCurrency(group.totalEUR, 'EUR')}</span>
      </div>
    </div>
  )
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function Investments() {
  const {
    accounts, profile, avApiKey, dividendHistory, dividendSyncedAt,
    setTickerDividends, setDividendSyncedAt,
    expenses, medicalCoverages, medicalExpenses,
  } = useAppStore()

  const [dateRange, setDateRange] = useState<'year' | 'next12'>('year')
  const [treemapView, setTreemapView] = useState<TreemapView>('holdings')
  const [divSyncing, setDivSyncing] = useState(false)
  const [divSyncMsg, setDivSyncMsg] = useState<string | null>(null)
  const [syncedCount, setSyncedCount] = useState(0)
  const [showHoldingsTable, setShowHoldingsTable] = useState(false)
  const [hoveredHolding, setHoveredHolding] = useState<{
    ticker: string; fullName: string; value: number; gains: number | null
  } | null>(null)
  const [treemapPos, setTreemapPos] = useState({ x: 0, y: 0 })
  const [divTooltip, setDivTooltip] = useState<{ group: MonthGroup; x: number; y: number } | null>(null)

  // ── Date range ──

  const today = new Date()
  const todayStr = today.toISOString().slice(0, 10)
  const thisMonthStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`
  const thisYear = today.getFullYear()
  const rangeStart = dateRange === 'year' ? `${thisYear}-01-01` : todayStr
  const rangeEnd = (() => {
    if (dateRange === 'year') return `${thisYear}-12-31`
    const d = new Date(today); d.setFullYear(d.getFullYear() + 1)
    return d.toISOString().slice(0, 10)
  })()
  const rangeLabel = dateRange === 'year' ? String(thisYear) : 'next 12m'

  // ── Core totals ──

  const invested = accounts
    .filter(a => a.type === 'investment' || a.type === 'retirement')
    .reduce((s, a) => s + convertToBase(a.balance, a.currency, profile.baseCurrency, DEFAULT_EUR_USD_RATE), 0)

  const totalBase = accounts
    .reduce((s, a) => s + convertToBase(a.balance, a.currency, profile.baseCurrency, DEFAULT_EUR_USD_RATE), 0)

  // ── Holdings + gains (all investment/retirement accounts) ──

  let totalUnrealizedGains = 0
  let totalCostBasis = 0
  let ltGains = 0, stGains = 0
  let plaidLinkedCount = 0
  const allHoldings: Array<{
    ticker: string; name: string; value: number; gains: number | null
    isShortTerm: boolean | null; quantity: number; isPseudo: boolean
  }> = []

  let totalEq = 0, totalBd = 0, totalCash = 0

  for (const a of accounts) {
    const b = convertToBase(a.balance, a.currency, profile.baseCurrency, DEFAULT_EUR_USD_RATE)
    totalEq += b * a.allocation.equity / 100
    totalBd += b * a.allocation.bonds / 100
    totalCash += b * a.allocation.cash / 100

    if (a.holdings && a.holdings.length > 0) {
      plaidLinkedCount++
      for (const h of a.holdings) {
        const valBase = convertToBase(h.institutionValue, h.currency, profile.baseCurrency, DEFAULT_EUR_USD_RATE)
        let gainBase: number | null = null
        let isShortTerm: boolean | null = null

        if (h.costBasis != null && h.costBasis > 0) {
          const costBase = convertToBase(h.costBasis, h.currency, profile.baseCurrency, DEFAULT_EUR_USD_RATE)
          totalCostBasis += costBase
          const gain = valBase - costBase
          totalUnrealizedGains += gain
          gainBase = gain
          if (h.purchaseDate) {
            const days = (today.getTime() - new Date(h.purchaseDate).getTime()) / 86400000
            isShortTerm = days < 365
            if (isShortTerm) stGains += gain; else ltGains += gain
          } else {
            ltGains += gain
          }
        }

        const existing = h.ticker !== null ? allHoldings.find(x => x.ticker === h.ticker) : null
        if (existing) {
          existing.value += valBase
          existing.quantity += h.quantity
          if (gainBase !== null) existing.gains = (existing.gains ?? 0) + gainBase
          if (isShortTerm !== null) existing.isShortTerm = isShortTerm
        } else {
          allHoldings.push({ ticker: h.ticker ?? '', name: h.name, value: valBase, gains: gainBase, isShortTerm, quantity: h.quantity, isPseudo: false })
        }
      }
    }
  }

  // Add investment/retirement accounts without Plaid holdings as synthetic entries
  for (const a of accounts.filter(a => a.type === 'investment' || a.type === 'retirement')) {
    if (!a.holdings || a.holdings.length === 0) {
      const val = convertToBase(a.balance, a.currency, profile.baseCurrency, DEFAULT_EUR_USD_RATE)
      if (val !== 0) {
        allHoldings.push({ ticker: '', name: a.name, value: val, gains: null, isShortTerm: null, quantity: 0, isPseudo: true })
      }
    }
  }

  allHoldings.sort((a, b) => b.value - a.value)

  // ── Currency exposure ──

  const byCurrency: Record<string, number> = {}
  for (const a of accounts) {
    const baseVal = convertToBase(a.balance, a.currency, profile.baseCurrency, DEFAULT_EUR_USD_RATE)
    if (a.fxSplitEUR && a.fxSplitEUR > 0 && a.currency.toUpperCase() !== 'EUR') {
      const eurBase = convertToBase(a.fxSplitEUR, 'EUR', profile.baseCurrency, DEFAULT_EUR_USD_RATE)
      const eurInAcc = convertToBase(a.fxSplitEUR, 'EUR', a.currency as 'EUR' | 'USD', DEFAULT_EUR_USD_RATE)
      byCurrency['EUR'] = (byCurrency['EUR'] ?? 0) + eurBase
      byCurrency[a.currency.toUpperCase()] = (byCurrency[a.currency.toUpperCase()] ?? 0) + convertToBase(Math.max(0, a.balance - eurInAcc), a.currency, profile.baseCurrency, DEFAULT_EUR_USD_RATE)
    } else if (a.holdings && a.holdings.length > 0) {
      for (const h of a.holdings) {
        const c = h.ticker?.match(/^CUR:([A-Z]{3})$/)?.[1] ?? h.currency.toUpperCase()
        byCurrency[c] = (byCurrency[c] ?? 0) + convertToBase(h.institutionValue, h.currency, profile.baseCurrency, DEFAULT_EUR_USD_RATE)
      }
    } else {
      byCurrency[a.currency.toUpperCase()] = (byCurrency[a.currency.toUpperCase()] ?? 0) + baseVal
    }
  }

  // ── Allocation by Empower category ──

  const allocationByCategory: Record<string, number> = {}
  for (const a of accounts) {
    if (a.type === 'loan' || a.type === 'credit') continue
    const b = convertToBase(a.balance, a.currency, profile.baseCurrency, DEFAULT_EUR_USD_RATE)
    if (a.holdings && a.holdings.length > 0) {
      for (const h of a.holdings) {
        const cat = empowerCategory(h.securityType, h.ticker)
        allocationByCategory[cat] = (allocationByCategory[cat] ?? 0) + convertToBase(h.institutionValue, h.currency, profile.baseCurrency, DEFAULT_EUR_USD_RATE)
      }
    } else if (a.type === 'real_estate') {
      allocationByCategory['Real Estate'] = (allocationByCategory['Real Estate'] ?? 0) + b
    } else {
      if (a.allocation.equity > 0) allocationByCategory['Stocks'] = (allocationByCategory['Stocks'] ?? 0) + b * a.allocation.equity / 100
      if (a.allocation.bonds > 0) allocationByCategory['Bonds'] = (allocationByCategory['Bonds'] ?? 0) + b * a.allocation.bonds / 100
      if (a.allocation.cash > 0) allocationByCategory['Cash'] = (allocationByCategory['Cash'] ?? 0) + b * a.allocation.cash / 100
    }
  }

  // ── Dividends — past (actual from AV history) + future (projected) ──

  const projectedAnnualDiv = projectedAnnualDividendsEUR(accounts, DEFAULT_EUR_USD_RATE)

  const investableTickers = [...new Set(
    accounts.flatMap(a => a.holdings ?? [])
      .map(h => h.ticker)
      .filter((t): t is string => t !== null && !/^CUR:/.test(t))
  )]
  const tickersWithHistory = investableTickers.filter(t => (dividendHistory[t]?.length ?? 0) > 0)

  const pastDividends: ExtDividend[] = accounts
    .flatMap(a => (a.holdings ?? [])
      .filter(h => h.ticker && !/^CUR:/.test(h.ticker) && (dividendHistory[h.ticker!]?.length ?? 0) > 0)
      .flatMap(h => (dividendHistory[h.ticker!] ?? [])
        .filter(d => d.paymentDate >= rangeStart && d.paymentDate < todayStr)
        .map(d => ({
          ticker: h.ticker!,
          paymentDate: d.paymentDate,
          amount: d.amount,
          sharesHeld: h.quantity,
          totalAmount: d.amount * h.quantity,
          currency: h.currency,
          accountId: a.id,
          accountName: a.name,
          isActual: true,
        }))
      )
    )

  const futureDividends: ExtDividend[] = accounts
    .flatMap(a => (a.holdings ?? [])
      .filter(h => h.ticker && !/^CUR:/.test(h.ticker) && (dividendHistory[h.ticker!]?.length ?? 0) > 0)
      .flatMap(h => projectDividends(h.ticker!, dividendHistory[h.ticker!], h.quantity, 20)
        .filter(d => d.paymentDate >= todayStr && d.paymentDate <= rangeEnd)
        .map(d => ({ ...d, currency: h.currency, accountId: a.id, accountName: a.name, isActual: false }))
      )
    )

  const allRangeDividends = [...pastDividends, ...futureDividends]
    .sort((a, b) => a.paymentDate.localeCompare(b.paymentDate))

  const monthGroups: MonthGroup[] = []
  for (const d of allRangeDividends) {
    const m = d.paymentDate.slice(0, 7)
    let g = monthGroups.find(x => x.month === m)
    if (!g) {
      g = { month: m, totalEUR: 0, items: [], isPast: m < thisMonthStr }
      monthGroups.push(g)
    }
    g.totalEUR += convertToBase(d.totalAmount, d.currency, 'EUR', DEFAULT_EUR_USD_RATE)
    g.items.push(d)
  }

  const rangedDivTotal = tickersWithHistory.length > 0 && allRangeDividends.length > 0
    ? allRangeDividends.reduce((s, d) => s + convertToBase(d.totalAmount, d.currency, 'EUR', DEFAULT_EUR_USD_RATE), 0)
    : projectedAnnualDiv

  // ── Risk & income ──

  const usdExposurePct = totalBase > 0 ? ((byCurrency['USD'] ?? 0) / totalBase * 100) : 0
  const topHoldingPct = invested > 0 && allHoldings[0] ? allHoldings[0].value / invested * 100 : 0
  const dividendYield = invested > 0 ? rangedDivTotal / invested * 100 : 0

  const rangeStartDate = new Date(rangeStart)
  const rangeEndDate = new Date(rangeEnd)
  const annualExpenses = [...(expenses ?? []), ...(medicalCoverages ?? []), ...(medicalExpenses ?? [])]
    .filter(e => {
      const s = e.startDate ? new Date(e.startDate + '-01') : null
      const en = e.endDate ? new Date(e.endDate + '-01') : null
      return (!s || s <= rangeEndDate) && (!en || en >= rangeStartDate)
    })
    .reduce((s, e) => {
      const annual = e.frequency === 'monthly' ? e.amount * 12 : e.frequency === 'yearly' ? e.amount : e.amount
      return s + convertToBase(annual, e.currency, 'EUR', DEFAULT_EUR_USD_RATE)
    }, 0)

  const safeWithdrawal4pct = invested * 0.04  // 4% rule; invested already in base currency (EUR)
  const dividendCoveragePct = annualExpenses > 0 ? rangedDivTotal / annualExpenses * 100 : 0

  // ── AV sync ──

  async function syncDividendHistory() {
    if (!avApiKey || investableTickers.length === 0) return
    setDivSyncing(true); setDivSyncMsg(null); setSyncedCount(0)
    let fetched = 0, failed = 0, rateLimited = false

    for (let i = 0; i < investableTickers.length; i++) {
      const ticker = investableTickers[i]
      try {
        setDivSyncMsg(`Fetching ${ticker} (${i + 1}/${investableTickers.length})…`)
        setSyncedCount(i + 1)
        setTickerDividends(ticker, await fetchTickerDividends(avApiKey, ticker))
        fetched++
      } catch (err: any) {
        failed++
        if (err.message?.toLowerCase().includes('rate limit') || err.message?.toLowerCase().includes('25 api')) {
          rateLimited = true; break
        }
      }
      if (i < investableTickers.length - 1) await new Promise(r => setTimeout(r, 13000))
    }

    setDividendSyncedAt(new Date().toISOString())
    setDivSyncMsg(rateLimited
      ? `Rate limit hit — ${fetched} fetched, ${failed} failed.`
      : `Done — ${fetched} ticker${fetched !== 1 ? 's' : ''} synced${failed > 0 ? `, ${failed} failed` : ''}.`)
    setDivSyncing(false)
  }

  // ── Treemap data (per view) ──

  const holdingsTreemapData = allHoldings.slice(0, 30).map(h => ({
    name: h.isPseudo ? `(${h.name.slice(0, 9)})` : (h.ticker || '?'),
    fullName: h.isPseudo ? `${h.name} — no Plaid` : h.name,
    size: Math.max(1, h.value),
    gain: h.gains,
    isPseudo: h.isPseudo,
    categoryColor: h.isPseudo ? '#6b7280' : undefined as string | undefined,
  }))

  const allocTreemapData = Object.entries(allocationByCategory)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([cat, val]) => ({
      name: cat, fullName: cat, size: val, gain: null, isPseudo: false,
      categoryColor: ALLOC_COLORS[cat] ?? '#6b7280',
    }))

  const currencyTreemapData = Object.entries(byCurrency)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([cur, val], i) => ({
      name: cur, fullName: cur, size: val, gain: null, isPseudo: false,
      categoryColor: currencyColor(cur, i),
    }))

  const activeTreemapData =
    treemapView === 'holdings' ? holdingsTreemapData :
    treemapView === 'allocation' ? allocTreemapData :
    currencyTreemapData

  const syncedAtStr = dividendSyncedAt
    ? new Date(dividendSyncedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    : null

  // ── Treemap cell renderer ──

  const treemapContent = useCallback((props: any) => {
    const { x, y, width, height, name, fullName, gain, size, categoryColor } = props
    const hasGain = gain != null
    const positive = (gain ?? 0) >= 0
    const fill = categoryColor ?? (hasGain ? (positive ? '#16a34a' : '#dc2626') : '#3b82f6')

    // Compute how many text lines we can fit
    const lineH = 11
    const showValue = width > 36 && height > 28
    const showGain = width > 36 && height > 50 && hasGain
    const lines = showGain ? 3 : showValue ? 2 : width > 28 && height > 16 ? 1 : 0
    const startY = y + height / 2 - ((lines - 1) * lineH) / 2

    return (
      <g
        onMouseEnter={e => {
          setHoveredHolding({ ticker: name, fullName: fullName ?? name, value: size, gains: gain ?? null })
          setTreemapPos({ x: e.clientX, y: e.clientY })
        }}
        onMouseMove={e => setTreemapPos({ x: e.clientX, y: e.clientY })}
        onMouseLeave={() => setHoveredHolding(null)}
        style={{ cursor: 'default' }}
      >
        <rect x={x} y={y} width={width} height={height} fill={fill} fillOpacity={0.75}
          stroke="white" strokeWidth={1.5} rx={2} />
        {lines >= 1 && (
          <text x={x + width / 2} y={startY} textAnchor="middle" dominantBaseline="middle"
            fill="white" fontSize={Math.min(11, Math.max(8, width / 6))} fontWeight={600}>
            {name}
          </text>
        )}
        {lines >= 2 && (
          <text x={x + width / 2} y={startY + lineH} textAnchor="middle" dominantBaseline="middle"
            fill="white" fillOpacity={0.85} fontSize={8.5}>
            {formatCompact(size, profile.baseCurrency)}
          </text>
        )}
        {lines >= 3 && hasGain && (
          <text x={x + width / 2} y={startY + 2 * lineH} textAnchor="middle" dominantBaseline="middle"
            fill="white" fillOpacity={0.7} fontSize={8}>
            {gain >= 0 ? '+' : ''}{formatCompact(gain, profile.baseCurrency)}
          </text>
        )}
      </g>
    )
  }, [profile.baseCurrency])

  // ── Portfolio accounts ──

  const portfolioAccounts = accounts.filter(a => a.type === 'investment' || a.type === 'retirement')

  return (
    <div onMouseLeave={() => setDivTooltip(null)}>
      <PageHeader title="Investments">
        <div className="flex rounded-[5px] overflow-hidden border border-gray-200 dark:border-gray-700 text-[11px]">
          {(['year', 'next12'] as const).map(r => (
            <button key={r} onClick={() => setDateRange(r)}
              className={`px-[10px] py-[3px] transition-colors ${
                dateRange === r
                  ? 'bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900'
                  : 'text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800'
              }`}
            >
              {r === 'year' ? thisYear : 'Next 12m'}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          {syncedAtStr && !divSyncing && (
            <span className="text-[10px] text-gray-400">
              {tickersWithHistory.length}/{investableTickers.length} synced · {syncedAtStr}
            </span>
          )}
          {divSyncing && divSyncMsg && <span className="text-[10px] text-gray-400">{divSyncMsg}</span>}
          {!avApiKey ? (
            <a href="#/settings" className="text-[11px] text-blue-500 hover:underline">Add AV key</a>
          ) : investableTickers.length > 0 ? (
            <button onClick={syncDividendHistory} disabled={divSyncing}
              className="text-[11px] px-2.5 py-[3px] rounded-[5px] border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-40 transition-colors">
              {divSyncing ? `${syncedCount}/${investableTickers.length}…` : `Sync ${investableTickers.length}`}
            </button>
          ) : null}
        </div>
      </PageHeader>

      <div className="p-4 space-y-4">

        {/* ── Metric cards ── */}
        <div className="grid grid-cols-3 gap-[9px]">
          <MetricCard label="Total invested" value={formatCompact(invested, profile.baseCurrency)}
            sub="excl. cash & real estate" />
          <MetricCard
            label={`Dividends (${rangeLabel})`}
            value={formatCompact(rangedDivTotal, 'EUR')}
            sub={tickersWithHistory.length > 0 ? `${tickersWithHistory.length}/${investableTickers.length} tickers via AV` : 'yield-based estimate'}
            valueClass="text-green-600"
          />
          <MetricCard
            label="Unrealized gains"
            value={plaidLinkedCount > 0 ? formatCompact(totalUnrealizedGains, profile.baseCurrency) : '—'}
            sub={plaidLinkedCount > 0
              ? (ltGains !== 0 || stGains !== 0
                ? `LT ${ltGains >= 0 ? '+' : ''}${formatCompact(ltGains, profile.baseCurrency)} · ST ${stGains >= 0 ? '+' : ''}${formatCompact(stGains, profile.baseCurrency)}`
                : 'from Plaid accounts')
              : 'link Plaid to see gains'}
            valueClass={totalUnrealizedGains >= 0 ? 'text-green-600' : 'text-red-500'}
          />
        </div>

        {/* ── Holdings treemap + accounts ── */}
        <div className="grid grid-cols-[2fr_1fr] gap-3">

          <Card>
            {/* Treemap view toggle */}
            <div className="flex justify-between items-center mb-2">
              <div className="flex items-center gap-1">
                {(['holdings', 'allocation', 'currency'] as TreemapView[]).map(v => (
                  <button key={v} onClick={() => setTreemapView(v)}
                    className={`text-[10.5px] px-2.5 py-[3px] rounded transition-colors ${
                      treemapView === v
                        ? 'bg-gray-800 dark:bg-gray-200 text-white dark:text-gray-900'
                        : 'border border-gray-200 dark:border-gray-700 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'
                    }`}
                  >
                    {v === 'holdings' ? `Holdings${allHoldings.length > 0 ? ` (${allHoldings.length})` : ''}` : v === 'allocation' ? 'Allocation' : 'Currency'}
                  </button>
                ))}
              </div>
              {treemapView === 'holdings' && allHoldings.length > 0 && (
                <ViewToggle showTable={showHoldingsTable} onToggle={() => setShowHoldingsTable(v => !v)} />
              )}
            </div>

            {/* Holdings table view */}
            {treemapView === 'holdings' && showHoldingsTable ? (
              <div className="space-y-px max-h-[240px] overflow-y-auto">
                {allHoldings.slice(0, 30).map((h, i) => (
                  <div key={i} className="flex justify-between items-center py-[4px] border-b border-gray-100 dark:border-gray-700 last:border-0 text-[11px]">
                    <div className="min-w-0 flex-1 pr-2">
                      <div className="font-medium text-gray-900 dark:text-gray-100 truncate">
                        {h.isPseudo ? `(${h.name})` : (h.ticker || '?')}
                      </div>
                      <div className="text-[10px] text-gray-400 truncate">{h.name}</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-medium">{formatCompact(h.value, profile.baseCurrency)}</div>
                      <div className={`text-[10px] ${h.gains != null && h.gains >= 0 ? 'text-green-500' : h.gains ? 'text-red-500' : 'text-gray-400'}`}>
                        {h.gains != null
                          ? `${h.gains >= 0 ? '+' : ''}${formatCompact(h.gains, profile.baseCurrency)}${h.isShortTerm ? ' ST' : ''}`
                          : h.isPseudo ? 'no Plaid sync' : 'no cost basis'}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              /* Treemap (all views) */
              <div className="h-[240px]">
                {activeTreemapData.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-[11.5px] text-gray-400">
                    {treemapView === 'holdings'
                      ? <>Link investment accounts to Plaid in <a href="#/config/accounts" className="text-blue-600 underline ml-1">Accounts</a>.</>
                      : 'No data.'}
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <Treemap data={activeTreemapData} dataKey="size" content={treemapContent} />
                  </ResponsiveContainer>
                )}
                {treemapView === 'holdings' && (
                  <div className="flex items-center gap-3 mt-2 text-[10px] text-gray-400">
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm inline-block bg-green-600 opacity-70" /> Gain</span>
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm inline-block bg-red-600 opacity-70" /> Loss</span>
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm inline-block bg-blue-500 opacity-70" /> No cost basis</span>
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm inline-block bg-gray-500 opacity-70" /> Not synced</span>
                  </div>
                )}
                {treemapView === 'allocation' && (
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-[10px] text-gray-400">
                    {allocTreemapData.map(d => (
                      <span key={d.name} className="flex items-center gap-1">
                        <span className="w-2 h-2 rounded-sm inline-block" style={{ background: d.categoryColor }} />
                        {d.name}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </Card>

          {/* Accounts list */}
          <Card className="self-start">
            <CardTitle>Accounts ({portfolioAccounts.length})</CardTitle>
            {portfolioAccounts.length === 0 ? (
              <div className="text-[11px] text-gray-400">No investment or retirement accounts.</div>
            ) : (
              <div className="space-y-px">
                {portfolioAccounts.map(a => {
                  const bal = convertToBase(a.balance, a.currency, profile.baseCurrency, DEFAULT_EUR_USD_RATE)
                  return (
                    <div key={a.id} className="flex items-start justify-between py-[5px] border-b border-gray-100 dark:border-gray-700 last:border-0 text-[11px]">
                      <div className="min-w-0 flex-1 pr-2">
                        <div className="truncate text-gray-800 dark:text-gray-200">{a.name}</div>
                        <div className="flex items-center gap-1.5 mt-[2px]">
                          <span className="text-[10px] text-gray-400 capitalize">{a.type}</span>
                          {a.plaidAccessToken && (
                            <Badge variant="success">Plaid</Badge>
                          )}
                          {!a.plaidAccessToken && a.isManual && (
                            <Badge variant="neutral">Manual</Badge>
                          )}
                          {a.holdings && a.holdings.length > 0 && (
                            <span className="text-[10px] text-gray-400">{a.holdings.length} holdings</span>
                          )}
                        </div>
                      </div>
                      <div className="shrink-0 font-medium">{formatCompact(bal, profile.baseCurrency)}</div>
                    </div>
                  )
                })}
              </div>
            )}
          </Card>
        </div>

        {/* ── Risk & income ── */}
        <div className="grid grid-cols-[1fr_1fr] gap-3">
          <Card>
            <CardTitle>Portfolio risk</CardTitle>
            <div className="space-y-3 mt-2">
              <RiskBar
                label="USD exposure"
                value={usdExposurePct}
                max={100}
                color={usdExposurePct > 75 ? '#f59e0b' : '#3b82f6'}
                note={usdExposurePct > 70 ? '— high FX risk' : undefined}
                tooltip="Share of total portfolio held in USD. High USD exposure creates EUR/USD currency risk — a weaker dollar directly reduces your real purchasing power when spending in euros."
              />
              <RiskBar
                label={`Top holding (${allHoldings[0]?.ticker || allHoldings[0]?.name || '—'})`}
                value={topHoldingPct}
                max={100}
                color={topHoldingPct > 20 ? '#f59e0b' : '#22c55e'}
                note={topHoldingPct > 25 ? '— concentrated' : undefined}
                tooltip="Largest single position as a share of total invested assets. High concentration increases sensitivity to one stock or fund's performance."
              />
              {totalCostBasis > 0 && (
                <RiskBar
                  label="Unrealized gain ratio"
                  value={totalBase > 0 ? totalUnrealizedGains / totalCostBasis * 100 : 0}
                  max={100}
                  color="#22c55e"
                  tooltip="Total unrealized gains relative to cost basis. A high ratio means large latent capital gains tax exposure — if you need to sell, you will trigger a significant tax event (FR PFU 30% for residents)."
                />
              )}
            </div>
            <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-700 space-y-[5px] text-[11px] text-gray-500 dark:text-gray-400">
              {ltGains !== 0 && (
                <div className="flex justify-between">
                  <span>LT gains (held &gt;1y, ~15–20% FR PFU)</span>
                  <span className={ltGains >= 0 ? 'text-green-600' : 'text-red-500'}>{ltGains >= 0 ? '+' : ''}{formatCurrency(ltGains, profile.baseCurrency)}</span>
                </div>
              )}
              {stGains !== 0 && (
                <div className="flex justify-between">
                  <span>ST gains (held &lt;1y, ~30% FR PFU)</span>
                  <span className={stGains >= 0 ? 'text-green-600' : 'text-red-500'}>{stGains >= 0 ? '+' : ''}{formatCurrency(stGains, profile.baseCurrency)}</span>
                </div>
              )}
              {ltGains === 0 && stGains === 0 && (
                <span className="text-[10.5px] italic">Link Plaid + holding dates for LT/ST breakdown</span>
              )}
            </div>
          </Card>

          <Card>
            <CardTitle>Income sustainability</CardTitle>
            <div className="space-y-3 mt-2">
              {annualExpenses > 0 && (
                <RiskBar
                  label="Dividend coverage"
                  value={dividendCoveragePct}
                  max={100}
                  color={dividendCoveragePct >= 80 ? '#22c55e' : dividendCoveragePct >= 40 ? '#f59e0b' : '#ef4444'}
                  note={`${dividendCoveragePct.toFixed(0)}%`}
                  tooltip={`Projected dividend income (${rangeLabel}) as a share of your active expenses for the same period. 100% means dividends alone cover spending without drawing down principal.`}
                />
              )}
              {dividendYield > 0 && (
                <RiskBar
                  label="Portfolio dividend yield"
                  value={dividendYield}
                  max={6}
                  color="#22c55e"
                  precision={2}
                  tooltip={`Annual dividend income as a percentage of total invested assets. A yield of 2–4% is typical for a diversified equity portfolio. Shown for ${rangeLabel}.`}
                />
              )}
            </div>
            <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-700 space-y-[5px] text-[11px]">
              <div className="flex justify-between text-gray-500 dark:text-gray-400">
                <span>Dividends ({rangeLabel})</span>
                <span className="text-green-600 font-medium">+{formatCurrency(rangedDivTotal, 'EUR')}</span>
              </div>
              {annualExpenses > 0 && (
                <div className="flex justify-between text-gray-500 dark:text-gray-400">
                  <span>Expenses ({rangeLabel})</span>
                  <span className="text-red-500 font-medium">{formatCurrency(annualExpenses, 'EUR')}</span>
                </div>
              )}
              <div className="flex justify-between text-gray-500 dark:text-gray-400">
                <span className="flex items-center">
                  4% rule (invested)
                  <InfoTooltip text="The 4% safe withdrawal rate from the Bengen/Trinity study: withdraw 4% of your invested portfolio per year and historically you have ~95% probability of not depleting it over 30 years. This is the annual spend your portfolio can theoretically sustain." />
                </span>
                <span className="font-medium">{formatCurrency(safeWithdrawal4pct, 'EUR')}/yr</span>
              </div>
            </div>
          </Card>
        </div>

        {/* ── Dividend schedule ── */}
        <Card>
          <CardTitle>Dividend schedule — {rangeLabel}</CardTitle>

          {divSyncMsg && !divSyncing && (
            <div className="text-[11px] text-gray-500 mb-3">{divSyncMsg}</div>
          )}

          {investableTickers.length === 0 && (
            <div className="text-[11.5px] text-gray-400">
              No Plaid-linked investment holdings. Link accounts in{' '}
              <a href="#/config/accounts" className="text-blue-600 underline">Accounts</a>.
            </div>
          )}

          {investableTickers.length > 0 && tickersWithHistory.length === 0 && (
            <div className="text-[11.5px] text-gray-400">
              {investableTickers.length} tickers found — use Sync above to fetch dividend history.
            </div>
          )}

          {/* Monthly grouped rows */}
          {monthGroups.length > 0 && (
            <div className="space-y-px">
              {monthGroups.map(g => {
                const maxTotal = Math.max(...monthGroups.map(x => x.totalEUR))
                return (
                  <div
                    key={g.month}
                    className={`relative flex items-center gap-3 py-[5px] px-2 border-b border-gray-100 dark:border-gray-700 last:border-0 text-[12px] rounded hover:bg-gray-50 dark:hover:bg-gray-800/50 cursor-default transition-opacity ${g.isPast ? 'opacity-40 hover:opacity-70' : ''}`}
                    onMouseEnter={e => {
                      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                      setDivTooltip({ group: g, x: rect.left, y: rect.top })
                    }}
                    onMouseLeave={() => setDivTooltip(null)}
                  >
                    <span className="text-gray-600 dark:text-gray-400 w-[72px] shrink-0">{formatYearMonth(g.month)}</span>
                    <div className="flex-1">
                      <div className="h-[4px] rounded-full bg-gray-100 dark:bg-gray-700">
                        <div className="h-full rounded-full bg-green-500 opacity-60"
                          style={{ width: `${Math.min(100, g.totalEUR / maxTotal * 100)}%` }} />
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-[10px] text-gray-400">{g.items.length} payment{g.items.length !== 1 ? 's' : ''}</span>
                      <span className="text-green-600 font-medium w-[56px] text-right">+{formatCurrency(g.totalEUR, 'EUR')}</span>
                    </div>
                  </div>
                )
              })}
              <div className="flex justify-end pt-2 text-[11.5px]">
                <span className="text-gray-500 mr-2">Total ({rangeLabel})</span>
                <span className="font-medium text-green-600">+{formatCurrency(rangedDivTotal, 'EUR')}</span>
              </div>
            </div>
          )}

          {/* No data diagnostic */}
          {tickersWithHistory.length > 0 && monthGroups.length === 0 && (
            <>
              <div className="text-[11.5px] text-gray-400 mb-3">
                History synced for {tickersWithHistory.length} ticker{tickersWithHistory.length !== 1 ? 's' : ''} but no payments in {rangeLabel}.
              </div>
              {(() => {
                const flat = accounts.flatMap(a => a.holdings ?? [])
                return (
                  <div className="border border-amber-200 dark:border-amber-800 rounded-[5px] overflow-hidden">
                    <div className="px-3 py-2 bg-amber-50 dark:bg-amber-900/20 text-[10.5px] font-medium text-amber-700 dark:text-amber-400">Per-ticker diagnosis</div>
                    <div className="divide-y divide-gray-100 dark:divide-gray-700">
                      {tickersWithHistory.map(t => {
                        const holding = flat.find(h => h.ticker === t)
                        const hist = dividendHistory[t] ?? []
                        const qty = holding ? parseFloat(String(holding.quantity)) : null
                        const projected = (holding && qty != null && qty > 0) ? projectDividends(t, hist, qty, 20) : []
                        const nextFuture = projected.find(d => d.paymentDate >= todayStr)
                        return (
                          <div key={t} className="grid grid-cols-[60px_80px_110px_80px_1fr] gap-2 px-3 py-[5px] text-[10.5px]">
                            <span className="font-medium text-gray-800 dark:text-gray-200">{t}</span>
                            <span className="text-gray-500">{hist.length} entries</span>
                            <span className="text-gray-500">last: {hist[0]?.paymentDate ?? '—'}</span>
                            <span className={qty === 0 ? 'text-red-500 font-medium' : qty == null ? 'text-amber-500' : 'text-gray-500'}>
                              qty: {qty == null ? 'no holding' : qty === 0 ? '0 ← bug' : qty.toFixed(3)}
                            </span>
                            <span className={nextFuture ? 'text-green-600' : 'text-amber-500'}>
                              next: {nextFuture?.paymentDate ?? (projected.length > 0 ? `all past (${projected[projected.length - 1]?.paymentDate})` : 'none')}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                    <div className="px-3 py-2 bg-amber-50 dark:bg-amber-900/20 text-[10px] text-amber-600 dark:text-amber-400">
                      qty=0 → re-sync Plaid · "no holding" → re-sync AV after Plaid · all past → re-sync AV (stale history)
                    </div>
                  </div>
                )
              })()}
            </>
          )}
        </Card>
      </div>

      {/* ── Treemap hover tooltip (fixed) ── */}
      {hoveredHolding && (
        <div
          style={{ position: 'fixed', left: treemapPos.x + 14, top: treemapPos.y - 10, zIndex: 50, pointerEvents: 'none' }}
          className="bg-gray-900 text-white text-[11px] px-3 py-2 rounded-lg shadow-xl max-w-[200px]"
        >
          <div className="font-semibold">{hoveredHolding.ticker !== hoveredHolding.fullName ? hoveredHolding.ticker : hoveredHolding.fullName}</div>
          {hoveredHolding.ticker !== hoveredHolding.fullName && (
            <div className="text-gray-400 text-[10px] truncate">{hoveredHolding.fullName}</div>
          )}
          <div className="mt-1 font-medium">{formatCurrency(hoveredHolding.value, profile.baseCurrency)}</div>
          {hoveredHolding.gains != null && (
            <div className={hoveredHolding.gains >= 0 ? 'text-green-400' : 'text-red-400'}>
              {hoveredHolding.gains >= 0 ? '+' : ''}{formatCurrency(hoveredHolding.gains, profile.baseCurrency)}
            </div>
          )}
        </div>
      )}

      {/* ── Dividend month tooltip (fixed) ── */}
      {divTooltip && (
        <div
          style={{
            position: 'fixed', left: divTooltip.x, top: divTooltip.y,
            transform: 'translateY(-100%) translateY(-8px)', zIndex: 50, pointerEvents: 'none',
          }}
          className="bg-gray-900 text-white text-[11px] px-3 py-2.5 rounded-lg shadow-xl"
        >
          <MonthTooltip group={divTooltip.group} />
        </div>
      )}
    </div>
  )
}
