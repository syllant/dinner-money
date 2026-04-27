import { useState, useCallback } from 'react'
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Treemap,
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

type ExtDividend = ProjectedDividend & { currency: string; accountId: string; accountName: string }
type MonthGroup = { month: string; totalEUR: number; items: ExtDividend[] }

// ─── Helpers ───────────────────────────────────────────────────────────────────

const PIE_COLORS_ALLOC = ['#22c55e', '#378ADD', '#94a3b8']

function ViewToggle({ showTable, onToggle }: { showTable: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      className="text-[10px] px-2 py-[3px] rounded border border-gray-200 dark:border-gray-700 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:border-gray-300 transition-colors"
    >
      {showTable ? '⬡ Chart' : '⊞ Table'}
    </button>
  )
}

function PieTooltip({ active, payload }: { active?: boolean; payload?: any[] }) {
  if (!active || !payload?.length) return null
  const { name, value } = payload[0]
  return (
    <div className="bg-gray-900 text-white text-[11px] px-2.5 py-1.5 rounded-lg shadow-lg">
      <span className="font-medium">{name}</span>
      <span className="ml-2 text-gray-300">{value.toFixed(0)}%</span>
    </div>
  )
}

function RiskBar({ label, value, max, color, note }: {
  label: string; value: number; max: number; color: string; note?: string
}) {
  const pct = Math.min(100, (value / max) * 100)
  return (
    <div>
      <div className="flex justify-between items-baseline mb-[3px]">
        <span className="text-[11px] text-gray-600 dark:text-gray-400">{label}</span>
        <span className="text-[11px] font-medium">{value.toFixed(0)}%{note && <span className="text-[10px] text-gray-400 font-normal ml-1">{note}</span>}</span>
      </div>
      <div className="h-[5px] rounded-full bg-gray-100 dark:bg-gray-700">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  )
}

// ─── Month tooltip content ─────────────────────────────────────────────────────

function MonthTooltip({ group }: { group: MonthGroup }) {
  const byAccount = new Map<string, { name: string; items: ExtDividend[] }>()
  for (const item of group.items) {
    if (!byAccount.has(item.accountId)) byAccount.set(item.accountId, { name: item.accountName, items: [] })
    byAccount.get(item.accountId)!.items.push(item)
  }
  return (
    <div className="min-w-[200px] max-w-[280px]">
      <div className="font-semibold mb-2">{formatYearMonth(group.month)}</div>
      {[...byAccount.values()].map(({ name, items }) => (
        <div key={name} className="mb-2 last:mb-0">
          <div className="text-gray-400 text-[10px] uppercase tracking-wide mb-[3px]">{name}</div>
          {items.map((d, i) => (
            <div key={i} className="flex justify-between gap-4 text-[11px]">
              <span>{d.ticker} × {d.sharesHeld.toFixed(2)}sh @ {formatCurrency(d.amount, d.currency, 2)}</span>
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
  const [divSyncing, setDivSyncing] = useState(false)
  const [divSyncMsg, setDivSyncMsg] = useState<string | null>(null)
  const [syncedCount, setSyncedCount] = useState(0)
  const [showHoldingsTable, setShowHoldingsTable] = useState(false)
  const [showAllocTable, setShowAllocTable] = useState(false)
  const [hoveredHolding, setHoveredHolding] = useState<{ ticker: string; fullName: string; value: number; gains: number | null } | null>(null)
  const [treemapPos, setTreemapPos] = useState({ x: 0, y: 0 })
  const [divTooltip, setDivTooltip] = useState<{ group: MonthGroup; x: number; y: number } | null>(null)

  // ── Date range ──

  const today = new Date()
  const thisYear = today.getFullYear()
  const rangeStart = dateRange === 'year' ? `${thisYear}-01-01` : today.toISOString().slice(0, 10)
  const rangeEnd = (() => {
    if (dateRange === 'year') return `${thisYear}-12-31`
    const d = new Date(today)
    d.setFullYear(d.getFullYear() + 1)
    return d.toISOString().slice(0, 10)
  })()
  const rangeLabel = dateRange === 'year' ? String(thisYear) : 'next 12m'

  // ── Core totals ──

  const invested = accounts
    .filter(a => a.type === 'investment' || a.type === 'retirement')
    .reduce((s, a) => s + convertToBase(a.balance, a.currency, profile.baseCurrency, DEFAULT_EUR_USD_RATE), 0)

  const totalBase = accounts.reduce((s, a) => s + convertToBase(a.balance, a.currency, profile.baseCurrency, DEFAULT_EUR_USD_RATE), 0)

  // ── Holdings + gains ──

  let totalUnrealizedGains = 0
  let totalCostBasis = 0
  let ltGains = 0, stGains = 0
  let plaidLinkedCount = 0
  const allHoldings: Array<{
    ticker: string; name: string; value: number; gains: number | null
    isShortTerm: boolean | null; quantity: number
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
            if (isShortTerm) stGains += gain
            else ltGains += gain
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
          allHoldings.push({ ticker: h.ticker ?? '', name: h.name, value: valBase, gains: gainBase, isShortTerm, quantity: h.quantity })
        }
      }
    }
  }
  allHoldings.sort((a, b) => b.value - a.value)

  const eqPct = totalBase > 0 ? totalEq / totalBase * 100 : 0
  const bdPct = totalBase > 0 ? totalBd / totalBase * 100 : 0
  const cashPct = totalBase > 0 ? totalCash / totalBase * 100 : 0

  // ── Dividends — all projected, then filtered by range ──

  const projectedAnnualDiv = projectedAnnualDividendsEUR(accounts, DEFAULT_EUR_USD_RATE)

  const investableTickers = [...new Set(
    accounts.flatMap(a => a.holdings ?? [])
      .map(h => h.ticker)
      .filter((t): t is string => t !== null && !/^CUR:/.test(t))
  )]
  const tickersWithHistory = investableTickers.filter(t => (dividendHistory[t]?.length ?? 0) > 0)

  const allProjected: ExtDividend[] = accounts
    .flatMap(a => (a.holdings ?? [])
      .filter(h => h.ticker && !/^CUR:/.test(h.ticker) && (dividendHistory[h.ticker!]?.length ?? 0) > 0)
      .flatMap(h => projectDividends(h.ticker!, dividendHistory[h.ticker!], h.quantity, 20)
        .map(d => ({ ...d, currency: h.currency, accountId: a.id, accountName: a.name }))
      )
    )
    .sort((a, b) => a.paymentDate.localeCompare(b.paymentDate))

  const rangedDividends = allProjected.filter(d => d.paymentDate >= rangeStart && d.paymentDate <= rangeEnd)

  const monthGroups: MonthGroup[] = []
  for (const d of rangedDividends) {
    const m = d.paymentDate.slice(0, 7)
    let g = monthGroups.find(x => x.month === m)
    if (!g) { g = { month: m, totalEUR: 0, items: [] }; monthGroups.push(g) }
    g.totalEUR += convertToBase(d.totalAmount, d.currency, 'EUR', DEFAULT_EUR_USD_RATE)
    g.items.push(d)
  }

  const rangedDivTotal = tickersWithHistory.length > 0 && rangedDividends.length > 0
    ? rangedDividends.reduce((s, d) => s + convertToBase(d.totalAmount, d.currency, 'EUR', DEFAULT_EUR_USD_RATE), 0)
    : projectedAnnualDiv

  // ── Risk & income ──

  const usdExposure = (() => {
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
    return totalBase > 0 ? ((byCurrency['USD'] ?? 0) / totalBase * 100) : 0
  })()

  const topHoldingPct = invested > 0 && allHoldings[0] ? allHoldings[0].value / invested * 100 : 0
  const dividendYield = invested > 0 ? rangedDivTotal / invested * 100 : 0

  const annualExpenses = [...(expenses ?? []), ...(medicalCoverages ?? []), ...(medicalExpenses ?? [])]
    .filter(e => !e.endDate || new Date(e.endDate + '-01') > today)
    .filter(e => !e.startDate || new Date(e.startDate + '-01') <= today)
    .reduce((s, e) => {
      const annual = e.frequency === 'monthly' ? e.amount * 12 : e.frequency === 'yearly' ? e.amount : 0
      return s + convertToBase(annual, e.currency, 'EUR', DEFAULT_EUR_USD_RATE)
    }, 0)

  const safeWithdrawal4pct = invested * 0.04 / DEFAULT_EUR_USD_RATE
  const dividendCoveragePct = annualExpenses > 0 ? rangedDivTotal / annualExpenses * 100 : 0

  // ── AV sync ──

  async function syncDividendHistory() {
    if (!avApiKey || investableTickers.length === 0) return
    setDivSyncing(true)
    setDivSyncMsg(null)
    setSyncedCount(0)
    let fetched = 0, failed = 0, rateLimited = false

    for (let i = 0; i < investableTickers.length; i++) {
      const ticker = investableTickers[i]
      try {
        setDivSyncMsg(`Fetching ${ticker} (${i + 1}/${investableTickers.length})…`)
        setSyncedCount(i + 1)
        const dividends = await fetchTickerDividends(avApiKey, ticker)
        setTickerDividends(ticker, dividends)
        fetched++
      } catch (err: any) {
        failed++
        if (err.message?.toLowerCase().includes('rate limit') || err.message?.toLowerCase().includes('25 api')) {
          rateLimited = true
          break
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

  // ── Chart data ──

  const allocData = [
    { name: 'Equities', value: Math.round(eqPct), color: PIE_COLORS_ALLOC[0] },
    { name: 'Bonds', value: Math.round(bdPct), color: PIE_COLORS_ALLOC[1] },
    { name: 'Cash', value: Math.round(cashPct), color: PIE_COLORS_ALLOC[2] },
  ].filter(d => d.value > 0)

  const treemapData = allHoldings.slice(0, 25).map(h => ({
    name: h.ticker || 'Cash/Other',
    fullName: h.name,
    size: Math.max(1, h.value),
    gain: h.gains,
    quantity: h.quantity,
  }))

  const syncedAtStr = dividendSyncedAt
    ? new Date(dividendSyncedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    : null

  // Treemap cell renderer — stable across renders via useCallback
  const treemapContent = useCallback((props: any) => {
    const { x, y, width, height, name, fullName, gain, size } = props
    const hasGain = gain != null
    const positive = (gain ?? 0) >= 0
    const fill = hasGain ? (positive ? '#16a34a' : '#dc2626') : '#3b82f6'
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
        <rect x={x} y={y} width={width} height={height} fill={fill} fillOpacity={0.72}
          stroke="white" strokeWidth={1.5} rx={2} />
        {width > 32 && height > 18 && (
          <text x={x + width / 2} y={y + height / 2 - (height > 34 && hasGain ? 7 : 0)}
            textAnchor="middle" dominantBaseline="middle"
            fill="white" fontSize={Math.min(11, width / 5)} fontWeight={500}>
            {name}
          </text>
        )}
        {width > 32 && height > 34 && hasGain && (
          <text x={x + width / 2} y={y + height / 2 + 8}
            textAnchor="middle" dominantBaseline="middle"
            fill="white" fillOpacity={0.8} fontSize={9}>
            {gain >= 0 ? '+' : ''}{formatCompact(gain, 'EUR')}
          </text>
        )}
      </g>
    )
  }, [])  // setters are stable refs

  // ── Investment accounts list ──

  const portfolioAccounts = accounts.filter(a => a.type === 'investment' || a.type === 'retirement')

  return (
    <div onMouseLeave={() => setDivTooltip(null)}>
      <PageHeader title="Investments">
        {/* Date range toggle */}
        <div className="flex rounded-[5px] overflow-hidden border border-gray-200 dark:border-gray-700 text-[11px]">
          {(['year', 'next12'] as const).map(r => (
            <button
              key={r}
              onClick={() => setDateRange(r)}
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

        {/* AV sync */}
        <div className="flex items-center gap-2">
          {syncedAtStr && !divSyncing && (
            <span className="text-[10px] text-gray-400">
              {tickersWithHistory.length}/{investableTickers.length} synced · {syncedAtStr}
            </span>
          )}
          {divSyncing && divSyncMsg && (
            <span className="text-[10px] text-gray-400">{divSyncMsg}</span>
          )}
          {!avApiKey ? (
            <a href="#/settings" className="text-[11px] text-blue-500 hover:underline">Add AV key</a>
          ) : investableTickers.length > 0 ? (
            <button
              onClick={syncDividendHistory}
              disabled={divSyncing}
              className="text-[11px] px-2.5 py-[3px] rounded-[5px] border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-40 transition-colors"
            >
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
            sub={tickersWithHistory.length > 0
              ? `${tickersWithHistory.length}/${investableTickers.length} tickers via AV`
              : 'yield-based estimate'}
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

        {/* ── Holdings + right column ── */}
        <div className="grid grid-cols-[2fr_1fr] gap-3">

          {/* Holdings treemap / table */}
          <Card>
            <div className="flex justify-between items-center mb-2">
              <CardTitle>
                Holdings{allHoldings.length > 0 && <span className="text-gray-400 font-normal text-[11px] ml-1">({allHoldings.length})</span>}
              </CardTitle>
              {allHoldings.length > 0 && <ViewToggle showTable={showHoldingsTable} onToggle={() => setShowHoldingsTable(v => !v)} />}
            </div>
            {allHoldings.length === 0 ? (
              <div className="text-[11.5px] text-gray-500 dark:text-gray-400 py-2">
                Link investment accounts to Plaid in{' '}
                <a href="#/config/accounts" className="text-blue-600 underline">Accounts</a>{' '}
                to see holdings and unrealized gains.
              </div>
            ) : showHoldingsTable ? (
              <div className="space-y-px mt-1 max-h-[220px] overflow-y-auto">
                {allHoldings.slice(0, 20).map((h, i) => (
                  <div key={i} className="flex justify-between items-center py-[4px] border-b border-gray-100 dark:border-gray-700 last:border-0 text-[11px]">
                    <div className="min-w-0 flex-1 pr-2">
                      <div className="font-medium text-gray-900 dark:text-gray-100 truncate">{h.ticker || 'Cash/Other'}</div>
                      <div className="text-[10px] text-gray-400 truncate">{h.name}</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-medium">{formatCompact(h.value, profile.baseCurrency)}</div>
                      <div className={`text-[10px] ${h.gains != null && h.gains >= 0 ? 'text-green-500' : h.gains ? 'text-red-500' : 'text-gray-400'}`}>
                        {h.gains != null
                          ? `${h.gains >= 0 ? '+' : ''}${formatCompact(h.gains, profile.baseCurrency)}${h.isShortTerm ? ' ST' : ''}`
                          : 'No cost basis'}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="h-[220px]">
                <ResponsiveContainer width="100%" height="100%">
                  <Treemap data={treemapData} dataKey="size" content={treemapContent} />
                </ResponsiveContainer>
                <div className="flex items-center gap-3 mt-2 text-[10px] text-gray-400">
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm inline-block bg-green-600 opacity-70" /> Gain</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm inline-block bg-red-600 opacity-70" /> Loss</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm inline-block bg-blue-500 opacity-70" /> No cost basis</span>
                </div>
              </div>
            )}
          </Card>

          {/* Right column */}
          <div className="space-y-3">

            {/* Asset allocation */}
            <Card>
              <div className="flex justify-between items-center mb-1">
                <CardTitle>Asset allocation</CardTitle>
                <ViewToggle showTable={showAllocTable} onToggle={() => setShowAllocTable(v => !v)} />
              </div>
              {showAllocTable ? (
                <div>
                  {[
                    { label: 'Equities', pct: eqPct, color: PIE_COLORS_ALLOC[0] },
                    { label: 'Bonds', pct: bdPct, color: PIE_COLORS_ALLOC[1] },
                    { label: 'Cash', pct: cashPct, color: PIE_COLORS_ALLOC[2] },
                  ].map(({ label, pct, color }) => (
                    <div key={label} className="flex justify-between items-center py-[5px] border-b border-gray-100 dark:border-gray-700 last:border-0 text-[12px]">
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full inline-block shrink-0" style={{ background: color }} />
                        {label}
                      </div>
                      <span className="font-medium">{pct.toFixed(0)}%</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="h-[110px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={allocData} cx="50%" cy="50%" innerRadius={28} outerRadius={46} dataKey="value" paddingAngle={2}>
                        {allocData.map((d, i) => <Cell key={i} fill={d.color} />)}
                      </Pie>
                      <Tooltip content={<PieTooltip />} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="flex flex-wrap justify-center gap-x-3 gap-y-1 text-[10px] text-gray-500 -mt-1">
                    {allocData.map(d => (
                      <span key={d.name} className="flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: d.color }} />
                        {d.name} {d.value}%
                      </span>
                    ))}
                  </div>
                </div>
              )}
              <p className="text-[10px] text-gray-400 mt-2">Set per-account in Accounts config.</p>
            </Card>

            {/* Portfolio accounts */}
            <Card>
              <CardTitle>Accounts ({portfolioAccounts.length})</CardTitle>
              {portfolioAccounts.length === 0 ? (
                <div className="text-[11px] text-gray-400">No investment or retirement accounts.</div>
              ) : (
                <div className="space-y-px">
                  {portfolioAccounts.map(a => {
                    const bal = convertToBase(a.balance, a.currency, profile.baseCurrency, DEFAULT_EUR_USD_RATE)
                    return (
                      <div key={a.id} className="flex items-center justify-between py-[4px] border-b border-gray-100 dark:border-gray-700 last:border-0 text-[11px]">
                        <div className="min-w-0 flex-1 pr-2">
                          <div className="truncate text-gray-800 dark:text-gray-200">{a.name}</div>
                          <div className="text-[10px] text-gray-400 capitalize">{a.type}{a.holdings ? ` · ${a.holdings.length} holdings` : ''}</div>
                        </div>
                        <div className="shrink-0 font-medium">{formatCompact(bal, profile.baseCurrency)}</div>
                      </div>
                    )
                  })}
                </div>
              )}
            </Card>
          </div>
        </div>

        {/* ── Risk & income ── */}
        <div className="grid grid-cols-[1fr_1fr] gap-3">
          <Card>
            <CardTitle>Portfolio risk</CardTitle>
            <div className="space-y-3 mt-2">
              <RiskBar
                label="USD exposure"
                value={usdExposure}
                max={100}
                color={usdExposure > 75 ? '#f59e0b' : '#3b82f6'}
                note={usdExposure > 70 ? '— high EUR/USD risk' : undefined}
              />
              <RiskBar
                label={`Top holding (${allHoldings[0]?.ticker || '—'})`}
                value={topHoldingPct}
                max={100}
                color={topHoldingPct > 20 ? '#f59e0b' : '#22c55e'}
                note={topHoldingPct > 25 ? '— concentrated' : undefined}
              />
              {totalCostBasis > 0 && (
                <RiskBar
                  label="Unrealized gain ratio"
                  value={totalBase > 0 ? totalUnrealizedGains / totalCostBasis * 100 : 0}
                  max={100}
                  color="#22c55e"
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
                <span className="text-[10.5px] italic">Link Plaid + holding dates needed for LT/ST split</span>
              )}
            </div>
          </Card>

          <Card>
            <CardTitle>Income sustainability</CardTitle>
            <div className="space-y-3 mt-2">
              {annualExpenses > 0 && (
                <RiskBar
                  label="Dividend coverage of expenses"
                  value={dividendCoveragePct}
                  max={100}
                  color={dividendCoveragePct >= 80 ? '#22c55e' : dividendCoveragePct >= 40 ? '#f59e0b' : '#ef4444'}
                />
              )}
              {dividendYield > 0 && (
                <RiskBar label="Portfolio dividend yield" value={dividendYield} max={6} color="#22c55e" />
              )}
            </div>
            <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-700 space-y-[5px] text-[11px]">
              <div className="flex justify-between text-gray-500 dark:text-gray-400">
                <span>Dividends ({rangeLabel})</span>
                <span className="text-green-600 font-medium">+{formatCurrency(rangedDivTotal, 'EUR')}</span>
              </div>
              {annualExpenses > 0 && (
                <div className="flex justify-between text-gray-500 dark:text-gray-400">
                  <span>Annual expenses (active)</span>
                  <span className="text-red-500 font-medium">{formatCurrency(annualExpenses, 'EUR')}</span>
                </div>
              )}
              <div className="flex justify-between text-gray-500 dark:text-gray-400">
                <span>4% rule (invested)</span>
                <span className="font-medium">{formatCurrency(safeWithdrawal4pct, 'EUR')}/yr</span>
              </div>
            </div>
            <p className="text-[10px] text-gray-400 mt-2">
              FR PFU (flat tax) applies 30% to dividends and capital gains for French residents.
            </p>
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
              No Plaid-linked investment holdings. Link accounts via Plaid in{' '}
              <a href="#/config/accounts" className="text-blue-600 underline">Accounts</a>.
            </div>
          )}

          {investableTickers.length > 0 && tickersWithHistory.length === 0 && (
            <div className="text-[11.5px] text-gray-400">
              {investableTickers.length} tickers found — use the Sync button above to fetch dividend history.
            </div>
          )}

          {/* Monthly grouped rows */}
          {monthGroups.length > 0 && (
            <div className="space-y-px">
              {monthGroups.map(g => (
                <div
                  key={g.month}
                  className="relative flex items-center justify-between py-[5px] px-2 border-b border-gray-100 dark:border-gray-700 last:border-0 text-[12px] rounded hover:bg-gray-50 dark:hover:bg-gray-800/50 cursor-default"
                  onMouseEnter={e => {
                    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                    setDivTooltip({ group: g, x: rect.left, y: rect.top })
                  }}
                  onMouseLeave={() => setDivTooltip(null)}
                >
                  <span className="text-gray-600 dark:text-gray-400 w-[80px]">{formatYearMonth(g.month)}</span>
                  <div className="flex-1 mx-3">
                    <div className="h-[4px] rounded-full bg-gray-100 dark:bg-gray-700">
                      <div
                        className="h-full rounded-full bg-green-500 opacity-60"
                        style={{ width: `${Math.min(100, g.totalEUR / Math.max(...monthGroups.map(x => x.totalEUR)) * 100)}%` }}
                      />
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-[10px] text-gray-400">{g.items.length} payment{g.items.length !== 1 ? 's' : ''}</span>
                    <span className="text-green-600 font-medium">+{formatCurrency(g.totalEUR, 'EUR')}</span>
                  </div>
                </div>
              ))}
              <div className="flex justify-end pt-2 text-[11.5px]">
                <span className="text-gray-500 mr-2">Total ({rangeLabel})</span>
                <span className="font-medium text-green-600">+{formatCurrency(rangedDivTotal, 'EUR')}</span>
              </div>
            </div>
          )}

          {/* No data diagnostics */}
          {tickersWithHistory.length > 0 && monthGroups.length === 0 && (
            <>
              <div className="text-[11.5px] text-gray-400 mb-3">
                History synced for {tickersWithHistory.length} ticker{tickersWithHistory.length !== 1 ? 's' : ''} but no payments projected in {rangeLabel}.
              </div>
              {(() => {
                const flat = accounts.flatMap(a => a.holdings ?? [])
                return (
                  <div className="border border-amber-200 dark:border-amber-800 rounded-[5px] overflow-hidden">
                    <div className="px-3 py-2 bg-amber-50 dark:bg-amber-900/20 text-[10.5px] font-medium text-amber-700 dark:text-amber-400">
                      Per-ticker diagnosis
                    </div>
                    <div className="divide-y divide-gray-100 dark:divide-gray-700">
                      {tickersWithHistory.map(t => {
                        const holding = flat.find(h => h.ticker === t)
                        const hist = dividendHistory[t] ?? []
                        const qty = holding ? parseFloat(String(holding.quantity)) : null
                        const lastPayment = hist[0]?.paymentDate ?? '—'
                        const projected = (holding && qty != null && qty > 0)
                          ? projectDividends(t, hist, qty, 20)
                          : []
                        const nextFuture = projected.find(d => d.paymentDate >= today.toISOString().slice(0, 10))
                        return (
                          <div key={t} className="grid grid-cols-[60px_80px_110px_80px_1fr] gap-2 px-3 py-[5px] text-[10.5px]">
                            <span className="font-medium text-gray-800 dark:text-gray-200">{t}</span>
                            <span className="text-gray-500">{hist.length} entries</span>
                            <span className="text-gray-500">last: {lastPayment}</span>
                            <span className={qty === 0 ? 'text-red-500 font-medium' : qty == null ? 'text-amber-500' : 'text-gray-500'}>
                              qty: {qty == null ? 'no holding' : qty === 0 ? '0 ← bug' : qty.toFixed(3)}
                            </span>
                            <span className={nextFuture ? 'text-green-600' : 'text-amber-500'}>
                              next: {nextFuture?.paymentDate ?? (projected.length > 0 ? `all past (last: ${projected[projected.length - 1]?.paymentDate})` : 'none')}
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

      {/* ── Treemap tooltip (fixed) ── */}
      {hoveredHolding && (
        <div
          style={{ position: 'fixed', left: treemapPos.x + 14, top: treemapPos.y - 10, zIndex: 50, pointerEvents: 'none' }}
          className="bg-gray-900 text-white text-[11px] px-3 py-2 rounded-lg shadow-xl max-w-[200px]"
        >
          <div className="font-semibold">{hoveredHolding.ticker}</div>
          {hoveredHolding.fullName !== hoveredHolding.ticker && (
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
            position: 'fixed',
            left: divTooltip.x,
            top: divTooltip.y,
            transform: 'translateY(-100%) translateY(-6px)',
            zIndex: 50,
            pointerEvents: 'none',
          }}
          className="bg-gray-900 text-white text-[11px] px-3 py-2.5 rounded-lg shadow-xl"
        >
          <MonthTooltip group={divTooltip.group} />
        </div>
      )}
    </div>
  )
}
