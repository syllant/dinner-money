import { useState } from 'react'
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Treemap,
} from 'recharts'
import { useAppStore } from '../store/useAppStore'
import { PageHeader } from '../components/ui/PageHeader'
import { MetricCard } from '../components/ui/MetricCard'
import { Card, CardTitle } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { formatCompact, formatCurrency } from '../lib/format'
import { convertToBase, DEFAULT_EUR_USD_RATE } from '../lib/currency'
import { projectedAnnualDividendsEUR } from '../lib/dividends'
import { fetchTickerDividends, projectDividends } from '../lib/alphavantage'

// ─── Toggle button ─────────────────────────────────────────────────────────────

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

// ─── Pie chart helpers ─────────────────────────────────────────────────────────

const PIE_COLORS_ALLOC = ['#22c55e', '#378ADD', '#94a3b8']
const PIE_COLORS_CURR = ['#378ADD', '#f59e0b', '#94a3b8', '#a78bfa', '#34d399']

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

// ─── Treemap ───────────────────────────────────────────────────────────────────

function TreemapCell(props: any) {
  const { x, y, width, height, name, gain } = props
  const hasGain = gain != null
  const positive = (gain ?? 0) >= 0
  const fill = hasGain ? (positive ? '#16a34a' : '#dc2626') : '#3b82f6'
  return (
    <g>
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
}

// ─── Risk indicator ────────────────────────────────────────────────────────────

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

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function Investments() {
  const {
    accounts, profile, avApiKey, dividendHistory, dividendSyncedAt,
    setTickerDividends, setDividendSyncedAt,
    expenses, medicalCoverages, medicalExpenses,
  } = useAppStore()

  const [divSyncing, setDivSyncing] = useState(false)
  const [divSyncMsg, setDivSyncMsg] = useState<string | null>(null)
  const [syncedCount, setSyncedCount] = useState(0)
  const [showHoldingsTable, setShowHoldingsTable] = useState(false)
  const [showAllocTable, setShowAllocTable] = useState(false)
  const [showCurrTable, setShowCurrTable] = useState(false)

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
  const today = new Date()
  const allHoldings: Array<{ ticker: string; name: string; value: number; gains: number | null; isShortTerm: boolean | null }> = []

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
          if (gainBase !== null) existing.gains = (existing.gains ?? 0) + gainBase
          if (isShortTerm !== null) existing.isShortTerm = isShortTerm
        } else {
          allHoldings.push({ ticker: h.ticker ?? '', name: h.name, value: valBase, gains: gainBase, isShortTerm })
        }
      }
    }
  }
  allHoldings.sort((a, b) => b.value - a.value)

  const eqPct = totalBase > 0 ? totalEq / totalBase * 100 : 0
  const bdPct = totalBase > 0 ? totalBd / totalBase * 100 : 0
  const cashPct = totalBase > 0 ? totalCash / totalBase * 100 : 0

  // ── Currency exposure ──

  function holdingCurrency(ticker: string | null, fallback: string): string {
    if (ticker) {
      const m = ticker.match(/^CUR:([A-Z]{3})$/)
      if (m) return m[1]
    }
    return fallback.toUpperCase()
  }

  const byCurrency: Record<string, number> = {}
  for (const a of accounts) {
    const baseVal = convertToBase(a.balance, a.currency, profile.baseCurrency, DEFAULT_EUR_USD_RATE)
    if (a.fxSplitEUR && a.fxSplitEUR > 0 && a.currency.toUpperCase() !== 'EUR') {
      const eurAmountBase = convertToBase(a.fxSplitEUR, 'EUR', profile.baseCurrency, DEFAULT_EUR_USD_RATE)
      const eurInAccCurrency = convertToBase(a.fxSplitEUR, 'EUR', a.currency as 'EUR' | 'USD', DEFAULT_EUR_USD_RATE)
      const remainingBase = convertToBase(Math.max(0, a.balance - eurInAccCurrency), a.currency, profile.baseCurrency, DEFAULT_EUR_USD_RATE)
      byCurrency['EUR'] = (byCurrency['EUR'] ?? 0) + eurAmountBase
      byCurrency[a.currency.toUpperCase()] = (byCurrency[a.currency.toUpperCase()] ?? 0) + remainingBase
    } else if (a.holdings && a.holdings.length > 0) {
      for (const h of a.holdings) {
        const c = holdingCurrency(h.ticker, h.currency)
        byCurrency[c] = (byCurrency[c] ?? 0) + convertToBase(h.institutionValue, h.currency, profile.baseCurrency, DEFAULT_EUR_USD_RATE)
      }
    } else {
      const c = a.currency.toUpperCase()
      byCurrency[c] = (byCurrency[c] ?? 0) + baseVal
    }
  }

  // ── Dividends ──

  const projectedAnnualDiv = projectedAnnualDividendsEUR(accounts, DEFAULT_EUR_USD_RATE)

  const investableTickers = [...new Set(
    accounts.flatMap(a => a.holdings ?? [])
      .map(h => h.ticker)
      .filter((t): t is string => t !== null && !/^CUR:/.test(t))
  )]
  const tickersWithHistory = investableTickers.filter(t => (dividendHistory[t]?.length ?? 0) > 0)

  // Upcoming: scan ALL accounts (not just investment/retirement — the type filter was causing misses)
  const upcomingDividends = accounts
    .flatMap(a => (a.holdings ?? [])
      .filter(h => h.ticker && !/^CUR:/.test(h.ticker) && (dividendHistory[h.ticker!]?.length ?? 0) > 0)
      .flatMap(h => projectDividends(h.ticker!, dividendHistory[h.ticker!], h.quantity, 18)
        .map(d => ({ ...d, currency: h.currency }))
      )
    )
    .filter(d => d.paymentDate >= today.toISOString().slice(0, 10))
    .sort((a, b) => a.paymentDate.localeCompare(b.paymentDate))

  const upcomingDivTotalEUR = upcomingDividends.reduce(
    (s, d) => s + convertToBase(d.totalAmount, d.currency, 'EUR', DEFAULT_EUR_USD_RATE), 0
  )

  // ── Risk & income metrics ──

  const usdPct = totalBase > 0 ? ((byCurrency['USD'] ?? 0) / totalBase * 100) : 0
  const topHoldingPct = invested > 0 && allHoldings[0] ? allHoldings[0].value / invested * 100 : 0
  const dividendYield = invested > 0 ? projectedAnnualDiv / invested * 100 : 0

  const annualExpenses = [...(expenses ?? []), ...(medicalCoverages ?? []), ...(medicalExpenses ?? [])]
    .filter(e => !e.endDate || new Date(e.endDate + '-01') > today)
    .filter(e => !e.startDate || new Date(e.startDate + '-01') <= today)
    .reduce((s, e) => {
      const annual = e.frequency === 'monthly' ? e.amount * 12 : e.frequency === 'yearly' ? e.amount : 0
      return s + convertToBase(annual, e.currency, 'EUR', DEFAULT_EUR_USD_RATE)
    }, 0)

  const safeWithdrawal4pct = invested * 0.04 / DEFAULT_EUR_USD_RATE  // rough EUR estimate
  const dividendCoveragePct = annualExpenses > 0 ? projectedAnnualDiv / annualExpenses * 100 : 0

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

    const now = new Date().toISOString()
    setDividendSyncedAt(now)
    const msg = rateLimited
      ? `Rate limit hit — ${fetched} fetched, ${failed} failed.`
      : `Done — ${fetched} ticker${fetched !== 1 ? 's' : ''} synced${failed > 0 ? `, ${failed} failed` : ''}.`
    setDivSyncMsg(msg)
    setDivSyncing(false)
  }

  // ── Chart data ──

  const allocData = [
    { name: 'Equities', value: Math.round(eqPct), color: PIE_COLORS_ALLOC[0] },
    { name: 'Bonds', value: Math.round(bdPct), color: PIE_COLORS_ALLOC[1] },
    { name: 'Cash', value: Math.round(cashPct), color: PIE_COLORS_ALLOC[2] },
  ].filter(d => d.value > 0)

  const currData = Object.entries(byCurrency)
    .map(([cur, amt], i) => ({ name: cur, value: totalBase > 0 ? Math.round(amt / totalBase * 100) : 0, amt, color: PIE_COLORS_CURR[i % PIE_COLORS_CURR.length] }))
    .filter(d => d.value > 0)
    .sort((a, b) => b.value - a.value)

  const treemapData = allHoldings.slice(0, 25).map(h => ({
    name: h.ticker || 'Cash/Other',
    size: Math.max(1, h.value),
    gain: h.gains,
  }))

  const syncedAtStr = dividendSyncedAt
    ? new Date(dividendSyncedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : null

  return (
    <div>
      <PageHeader title="Investments" />
      <div className="p-4 space-y-4">

        {/* ── Metric cards ── */}
        <div className="grid grid-cols-4 gap-[9px]">
          <MetricCard label="Total invested" value={formatCompact(invested, profile.baseCurrency)}
            sub="excl. cash & real estate" />
          <MetricCard label="Annual dividends (proj.)"
            value={formatCompact(projectedAnnualDiv, 'EUR')}
            sub={tickersWithHistory.length > 0
              ? `${tickersWithHistory.length}/${investableTickers.length} tickers via AV`
              : 'type-based estimate'}
            valueClass="text-green-600" />
          <MetricCard label="Portfolio accounts"
            value={String(accounts.filter(a => a.type === 'investment' || a.type === 'retirement').length)}
            sub={`${plaidLinkedCount} synced via Plaid`} />
          <MetricCard label="Unrealized Gains"
            value={plaidLinkedCount > 0 ? formatCompact(totalUnrealizedGains, profile.baseCurrency) : '—'}
            sub={plaidLinkedCount > 0
              ? (ltGains !== 0 || stGains !== 0
                ? `LT ${ltGains >= 0 ? '+' : ''}${formatCompact(ltGains, profile.baseCurrency)} · ST ${stGains >= 0 ? '+' : ''}${formatCompact(stGains, profile.baseCurrency)}`
                : 'From Plaid synced accounts')
              : 'Link Plaid to see gains'}
            valueClass={totalUnrealizedGains >= 0 ? 'text-green-600' : 'text-red-500'} />
        </div>

        {/* ── Holdings + allocation/currency ── */}
        <div className="grid grid-cols-[2fr_1fr] gap-3">

          {/* Holdings treemap / table */}
          <Card>
            <div className="flex justify-between items-center mb-2">
              <CardTitle>Holdings {allHoldings.length > 0 && <span className="text-gray-400 font-normal text-[11px]">({allHoldings.length})</span>}</CardTitle>
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
                  <Treemap data={treemapData} dataKey="size" content={<TreemapCell />} />
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
                <div className="h-[120px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={allocData} cx="50%" cy="50%" innerRadius={32} outerRadius={52} dataKey="value" paddingAngle={2}>
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

            {/* Currency exposure */}
            <Card>
              <div className="flex justify-between items-center mb-1">
                <CardTitle>Currency exposure</CardTitle>
                <ViewToggle showTable={showCurrTable} onToggle={() => setShowCurrTable(v => !v)} />
              </div>
              {showCurrTable ? (
                <div>
                  {currData.map(({ name: cur, value: pct, amt }) => (
                    <div key={cur} className="flex justify-between items-center py-[5px] border-b border-gray-100 dark:border-gray-700 last:border-0 text-[12px]">
                      <Badge variant={cur === 'EUR' ? 'eur' : 'usd'}>{cur}</Badge>
                      <div className="flex items-center gap-2">
                        <span className="text-gray-500 text-[11px]">{formatCompact(amt, profile.baseCurrency)}</span>
                        <span className="font-medium">{pct}%</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="h-[120px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={currData} cx="50%" cy="50%" innerRadius={32} outerRadius={52} dataKey="value" paddingAngle={2}>
                        {currData.map((d, i) => <Cell key={i} fill={d.color} />)}
                      </Pie>
                      <Tooltip content={<PieTooltip />} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="flex flex-wrap justify-center gap-x-3 gap-y-1 text-[10px] text-gray-500 -mt-1">
                    {currData.map(d => (
                      <span key={d.name} className="flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: d.color }} />
                        {d.name} {d.value}%
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </Card>
          </div>
        </div>

        {/* ── Risk & income insights ── */}
        <div className="grid grid-cols-[1fr_1fr] gap-3">
          <Card>
            <CardTitle>Portfolio risk</CardTitle>
            <div className="space-y-3 mt-2">
              <RiskBar
                label="USD exposure"
                value={usdPct}
                max={100}
                color={usdPct > 75 ? '#f59e0b' : '#3b82f6'}
                note={usdPct > 70 ? '— high EUR/USD risk' : undefined}
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
                  note={`${dividendCoveragePct.toFixed(0)}%`}
                />
              )}
              {dividendYield > 0 && (
                <RiskBar
                  label="Portfolio dividend yield"
                  value={dividendYield}
                  max={6}
                  color="#22c55e"
                />
              )}
            </div>
            <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-700 space-y-[5px] text-[11px]">
              <div className="flex justify-between text-gray-500 dark:text-gray-400">
                <span>Annual dividends (proj.)</span>
                <span className="text-green-600 font-medium">+{formatCurrency(projectedAnnualDiv, 'EUR')}</span>
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
              {upcomingDividends.length > 0 && (
                <div className="flex justify-between text-gray-500 dark:text-gray-400">
                  <span>Upcoming 18m (AV)</span>
                  <span className="text-green-600 font-medium">+{formatCurrency(upcomingDivTotalEUR, 'EUR')}</span>
                </div>
              )}
            </div>
            <p className="text-[10px] text-gray-400 mt-2">
              FR PFU (flat tax) applies 30% to dividends and capital gains for French residents.
            </p>
          </Card>
        </div>

        {/* ── Dividend sync + upcoming ── */}
        <Card>
          <div className="flex items-center justify-between mb-3">
            <div>
              <CardTitle>Dividend projections — Alpha Vantage</CardTitle>
              {syncedAtStr && (
                <div className="text-[10px] text-gray-400 mt-0.5">
                  Last synced {syncedAtStr} · {tickersWithHistory.length}/{investableTickers.length} tickers with data
                  {divSyncing && ` · ${syncedCount}/${investableTickers.length} fetched this session`}
                </div>
              )}
            </div>
            <div className="flex items-center gap-2">
              {!avApiKey && (
                <span className="text-[11px] text-gray-400">
                  Add Alpha Vantage key in <a href="#/settings" className="text-blue-600 underline">Settings</a>
                </span>
              )}
              {avApiKey && investableTickers.length > 0 && (
                <button
                  onClick={syncDividendHistory}
                  disabled={divSyncing}
                  className="text-[11.5px] px-3 py-1 rounded-[5px] border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-40 transition-colors"
                >
                  {divSyncing ? 'Syncing…' : `Sync ${investableTickers.length} tickers`}
                </button>
              )}
            </div>
          </div>

          {divSyncMsg && (
            <div className="text-[11px] text-gray-500 mb-3">{divSyncMsg}</div>
          )}

          {investableTickers.length === 0 && (
            <div className="text-[11.5px] text-gray-400">
              No Plaid-linked investment holdings found. Link accounts via Plaid in the{' '}
              <a href="#/config/accounts" className="text-blue-600 underline">Accounts</a> page.
            </div>
          )}

          {investableTickers.length > 0 && upcomingDividends.length === 0 && (
            <div className="text-[11.5px] text-gray-400">
              {tickersWithHistory.length === 0
                ? `${investableTickers.length} tickers found — click Sync to fetch dividend history from Alpha Vantage.`
                : `History synced for ${tickersWithHistory.length} ticker${tickersWithHistory.length !== 1 ? 's' : ''} but no upcoming payments projected.`}
            </div>
          )}

          {/* Per-ticker diagnostic — always shown when history exists but no upcoming dividends */}
          {tickersWithHistory.length > 0 && upcomingDividends.length === 0 && (() => {
            const allHoldingsFlat = accounts.flatMap(a => a.holdings ?? [])
            return (
              <div className="mt-3 border border-amber-200 dark:border-amber-800 rounded-[5px] overflow-hidden">
                <div className="px-3 py-2 bg-amber-50 dark:bg-amber-900/20 text-[10.5px] font-medium text-amber-700 dark:text-amber-400">
                  Per-ticker diagnosis — check qty and next projected date
                </div>
                <div className="divide-y divide-gray-100 dark:divide-gray-700">
                  {tickersWithHistory.map(t => {
                    const holding = allHoldingsFlat.find(h => h.ticker === t)
                    const hist = dividendHistory[t] ?? []
                    const qty = holding ? parseFloat(String(holding.quantity)) : null
                    const lastPayment = hist[0]?.paymentDate ?? '—'
                    const projected = (holding && qty != null && qty > 0)
                      ? projectDividends(t, hist, qty, 18)
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
                          next: {nextFuture?.paymentDate ?? (projected.length > 0 ? `all past (last: ${projected[projected.length - 1]?.paymentDate})` : 'none — qty=0 or no hist')}
                        </span>
                      </div>
                    )
                  })}
                </div>
                <div className="px-3 py-2 bg-amber-50 dark:bg-amber-900/20 text-[10px] text-amber-600 dark:text-amber-400">
                  If qty = 0 → re-sync Plaid in Accounts. If "no holding" → re-sync AV after syncing Plaid. If all projected dates are past → re-sync AV (history is stale).
                </div>
              </div>
            )
          })()}

          {upcomingDividends.length > 0 && (
            <div>
              <div className="flex justify-between items-center mb-2 text-[11px]">
                <span className="text-gray-500">Next 18 months · {tickersWithHistory.length}/{investableTickers.length} tickers synced</span>
                <span className="font-medium text-green-600">+{formatCurrency(upcomingDivTotalEUR, 'EUR')} total</span>
              </div>
              <div className="max-h-[200px] overflow-y-auto space-y-px">
                {upcomingDividends.slice(0, 40).map((d, i) => (
                  <div key={i} className="flex items-center gap-3 py-[4px] border-b border-gray-100 dark:border-gray-700 last:border-0 text-[11.5px]">
                    <span className="text-gray-400 shrink-0 w-[68px]">{d.paymentDate.slice(0, 7)}</span>
                    <span className="font-medium text-gray-700 dark:text-gray-300 shrink-0 w-[60px]">{d.ticker}</span>
                    <span className="text-gray-500 flex-1">{d.sharesHeld.toFixed(2)} shares @ {formatCurrency(d.amount, d.currency)}</span>
                    <span className="text-green-600 font-medium shrink-0">+{formatCurrency(d.totalAmount, d.currency)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <p className="text-[10.5px] text-gray-400 mt-3">
            Free tier: 25 req/day, 5/min. Syncing {investableTickers.length} tickers takes ~{Math.ceil(investableTickers.length * 13 / 60)} min.
            {plaidLinkedCount === 0 && ' LT/ST classification requires purchase dates from Plaid investment transactions.'}
          </p>
        </Card>
      </div>
    </div>
  )
}
