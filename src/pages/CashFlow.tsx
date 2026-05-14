import { useState, useMemo } from 'react'
import { useAppStore } from '../store/useAppStore'
import { PageHeader } from '../components/ui/PageHeader'
import { Card } from '../components/ui/Card'
import { Banner } from '../components/ui/Banner'
import { InfoTooltip } from '../components/ui/InfoTooltip'
import { AccountLogo } from '../components/ui/AccountLabel'
import { formatCurrency, formatCompact } from '../lib/format'
import { DEFAULT_EUR_USD_RATE, convertToBase } from '../lib/currency'
import { buildCashProjection } from '../lib/cashProjection'
import { projectedAnnualDividendsEUR } from '../lib/dividends'
import { projectDividends } from '../lib/tiingo'
import type { ProjectedMonth, CashEvent } from '../lib/cashProjection'
import type { Account } from '../types'

// ─── Helpers ──────────────────────────────────────────────────────────────────



function useLocalStorage<T>(key: string, init: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try { const s = localStorage.getItem(key); return s != null ? (JSON.parse(s) as T) : init }
    catch { return init }
  })
  return [value, (v: T) => { setValue(v); try { localStorage.setItem(key, JSON.stringify(v)) } catch {} }]
}

function currencySymbol(cur: string): string {
  return cur === 'EUR' ? '€' : cur === 'USD' ? '$' : cur
}

function computeAnnualDivEUR(
  accounts: Account[],
  dividendHistory: Record<string, import('../lib/tiingo').TickerDividend[]>,
  fxRate: number = DEFAULT_EUR_USD_RATE,
): number {
  const invAccounts = accounts.filter(
    a => (a.type === 'investment' || a.type === 'retirement') && a.includedInPlanning !== false
  )
  const today = new Date()
  const todayStr = today.toISOString().slice(0, 10)
  const yearLater = new Date(today)
  yearLater.setFullYear(yearLater.getFullYear() + 1)
  const yearLaterStr = yearLater.toISOString().slice(0, 10)

  let tiingoTotal = 0
  let hasTiingo = false
  for (const acc of invAccounts) {
    for (const h of acc.holdings ?? []) {
      if (!h.ticker || /^CUR:/.test(h.ticker)) continue
      const hist = dividendHistory[h.ticker]
      if (!hist?.length) continue
      hasTiingo = true
      const projected = projectDividends(h.ticker, hist, h.quantity, 13)
        .filter(d => d.paymentDate >= todayStr && d.paymentDate <= yearLaterStr)
      for (const d of projected) {
        tiingoTotal += convertToBase(d.totalAmount, h.currency, 'EUR', fxRate)
      }
    }
  }
  return hasTiingo && tiingoTotal > 0 ? tiingoTotal : projectedAnnualDividendsEUR(invAccounts, fxRate)
}

// ─── Constants ────────────────────────────────────────────────────────────────

const CUR_BADGE = 'text-[9px] font-bold px-1.5 py-px rounded'
const EUR_BADGE_CLS = 'bg-sky-500 text-white'
const USD_BADGE_CLS = 'bg-emerald-600 text-white'

const EVENT_STYLE: Record<string, { label: string }> = {
  real_estate:      { label: 'Real estate' },
  windfall:         { label: 'Windfall' },
  one_time_expense: { label: 'Expense' },
  tax_payment:      { label: 'Tax' },
  transfer:         { label: 'Transfer' },
  dividend:         { label: 'Dividend' },
}

function eventBadgeBg(type: string, amountNative: number): string {
  if (type === 'transfer') return 'bg-blue-100 text-blue-700'
  if (amountNative >= 0) return 'bg-green-100 text-green-700'
  return 'bg-red-100 text-red-700'
}

// ─── Chart helpers ────────────────────────────────────────────────────────────

function formatK(v: number): string {
  const abs = Math.abs(v)
  const sign = v < 0 ? '−' : ''
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(1)}M`
  if (abs >= 10_000) return `${sign}${(abs / 1_000).toFixed(0)}k`
  if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(1)}k`
  return `${sign}${Math.abs(Math.round(v))}`
}

/** Format a native-currency amount with sign before symbol: −$10k, +€5k */
function fmtNative(v: number, sym: string): string {
  const sign = v < 0 ? '−' : ''
  return `${sign}${sym}${formatK(Math.abs(v))}`
}

// ─── Month balance tooltip (shared by chart hover + date cell) ───────────────

function MonthBalanceTooltip({ month, accounts }: { month: ProjectedMonth; accounts: Account[] }) {
  const openMap = new Map(month.openingAccountBalances.map(a => [a.id, a]))
  const closeMap = new Map(month.accountBalances.map(a => [a.id, a]))
  const accountById = new Map(accounts.map(account => [account.id, account]))
  const currencies = [...new Set(month.accountBalances.map(a => a.currency))].sort()
  return (
    <div className="bg-gray-900 text-white text-[11px] px-3 py-2.5 rounded-lg shadow-xl border border-gray-700 w-[340px] pointer-events-none">
      <div className="font-semibold mb-1.5 pb-1 border-b border-gray-700 text-[11.5px]">{month.label}</div>
      <div className="flex justify-end gap-1 mb-1 text-[9px] text-gray-500">
        <span className="w-[48px] text-right">Start</span>
        <span className="w-[48px] text-right">End</span>
        <span className="w-[48px] text-right">Net</span>
      </div>
      {currencies.map(cur => {
        const openAccs = month.openingAccountBalances.filter(a => a.currency === cur)
        const toNative = (balEUR: number) => cur === 'USD' ? balEUR * DEFAULT_EUR_USD_RATE : balEUR
        const openTotal = openAccs.reduce((s, a) => s + toNative(a.balanceEUR), 0)
        const closeAccs = month.accountBalances.filter(a => a.currency === cur)
        const closeTotal = closeAccs.reduce((s, a) => s + toNative(a.balanceEUR), 0)
        const totalNet = closeTotal - openTotal
        const sym = cur === 'EUR' ? '€' : '$'
        return (
          <div key={cur} className="mb-2">
            <div className="flex items-center justify-between">
              <span className={`${CUR_BADGE} ${cur === 'EUR' ? EUR_BADGE_CLS : USD_BADGE_CLS}`}>{cur}</span>
              <div className="flex gap-1">
                <span className={`tabular-nums text-[10px] w-[48px] text-right ${openTotal >= 0 ? 'text-green-400' : 'text-red-400'}`}>{fmtNative(Math.round(openTotal), sym)}</span>
                <span className={`tabular-nums text-[10px] w-[48px] text-right ${closeTotal >= 0 ? 'text-green-400' : 'text-red-400'}`}>{fmtNative(Math.round(closeTotal), sym)}</span>
                <span className={`tabular-nums text-[10px] w-[48px] text-right ${totalNet >= 0 ? 'text-green-400' : 'text-red-400'}`}>{fmtNative(Math.round(totalNet), sym)}</span>
              </div>
            </div>
            {openAccs.map(oa => {
              const ca = closeMap.get(oa.id) ?? openMap.get(oa.id)!
              const account = accountById.get(oa.id)
              const oNative = toNative(oa.balanceEUR), cNative = toNative(ca.balanceEUR)
              const netNative = cNative - oNative
              return (
                <div key={oa.id} className="flex items-center justify-between pl-3">
                  <span className="text-gray-400 text-[10px] flex-1 min-w-0 inline-flex items-center gap-1.5">
                    {account && <AccountLogo account={account} size="xs" />}
                    <span className="truncate">{oa.name}</span>
                  </span>
                  <div className="flex gap-1 shrink-0">
                    <span className={`tabular-nums text-[10px] w-[48px] text-right ${oNative >= 0 ? 'text-gray-300' : 'text-red-400'}`}>{fmtNative(Math.round(oNative), sym)}</span>
                    <span className={`tabular-nums text-[10px] w-[48px] text-right ${cNative >= 0 ? 'text-gray-300' : 'text-red-400'}`}>{fmtNative(Math.round(cNative), sym)}</span>
                    <span className={`tabular-nums text-[10px] w-[48px] text-right ${netNative >= 0 ? 'text-green-400' : 'text-red-400'}`}>{fmtNative(Math.round(netNative), sym)}</span>
                  </div>
                </div>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}

// ─── Vertical balance chart ───────────────────────────────────────────────────

const ROW_H = 26
const HEADER_H = 28

function VerticalBalanceChart({ rows, slotCounts, accounts }: {
  rows: Array<{ month: ProjectedMonth }>
  slotCounts: number[]
  accounts: Account[]
}) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null)

  const W = 345
  const totalH = slotCounts.reduce((s, c) => s + c * ROW_H, 0)

  // Cumulative band start Y positions
  const bandStarts: number[] = []
  let cumH = 0
  for (const c of slotCounts) { bandStarts.push(cumH); cumH += c * ROW_H }

  // Chart data points — use opening balances so first point = current balance shown at top of page
  // EUR in native EUR, USD in native USD (no cross-currency conversion)
  const points = rows.map((r, i) => {
    const midY = bandStarts[i] + slotCounts[i] * ROW_H / 2
    const eurNative = r.month.openingAccountBalances
      .filter(a => a.currency === 'EUR').reduce((s, a) => s + a.balanceEUR, 0)
    const usdNative = r.month.openingAccountBalances
      .filter(a => a.currency === 'USD').reduce((s, a) => s + a.balanceEUR * DEFAULT_EUR_USD_RATE, 0)
    return { y: midY, eur: eurNative, usd: usdNative }
  })

  const allVals = [...points.map(p => p.eur), ...points.map(p => p.usd), 0]
  const minVal = Math.min(...allVals), maxVal = Math.max(...allVals)
  const range = maxVal - minVal || 1
  const ML = 10, MR = 10
  const xScale = (v: number) => ML + ((v - minVal) / range) * (W - ML - MR)

  const eurPath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${xScale(p.eur).toFixed(1)},${p.y.toFixed(1)}`).join(' ')
  const usdPath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${xScale(p.usd).toFixed(1)},${p.y.toFixed(1)}`).join(' ')

  const separators: number[] = []
  let sepY = 0
  for (const c of slotCounts.slice(0, -1)) { sepY += c * ROW_H; separators.push(sepY) }

  function handleMouseMove(e: React.MouseEvent<SVGSVGElement>) {
    const y = e.clientY - e.currentTarget.getBoundingClientRect().top
    const idx = bandStarts.findIndex((start, i) => y >= start && y < start + slotCounts[i] * ROW_H)
    setHoveredIdx(idx >= 0 ? idx : null)
  }

  const hoveredRow = hoveredIdx != null ? rows[hoveredIdx] : null

  const tooltipTop = hoveredIdx != null
    ? HEADER_H + Math.max(0, Math.min(totalH - 200, bandStarts[hoveredIdx] + slotCounts[hoveredIdx] * ROW_H / 2 - 80))
    : 0

  const axisLabel = (v: number, anchor: 'start' | 'middle' | 'end', y: number) => (
    <text x={xScale(v)} y={y} textAnchor={anchor} fill="#d1d5db" fontSize="7.5">{formatK(Math.round(v))}</text>
  )

  return (
    <div className="shrink-0 border-r border-gray-100 dark:border-gray-800 relative" style={{ width: W }}>
      {/* Legend header */}
      <div style={{ height: HEADER_H }} className="flex items-center gap-3 px-3 border-b border-gray-100 dark:border-gray-800 text-[9px] text-gray-400">
        <span className="flex items-center gap-1.5"><span className="w-3 h-[2px] rounded bg-sky-500 inline-block" />EUR</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-[2px] rounded bg-emerald-500 inline-block" />USD</span>
      </div>
      {/* Tooltip */}
      {hoveredRow != null && (
        <div className="absolute left-full ml-2 z-20" style={{ top: tooltipTop }}>
          <MonthBalanceTooltip month={hoveredRow.month} accounts={accounts} />
        </div>
      )}
      {/* Chart */}
      <svg width={W} height={totalH} className="block" onMouseMove={handleMouseMove} onMouseLeave={() => setHoveredIdx(null)}>
        {/* Hover highlight */}
        {hoveredIdx != null && (
          <rect x={0} y={bandStarts[hoveredIdx]} width={W} height={slotCounts[hoveredIdx] * ROW_H} fill="rgba(99,102,241,0.07)" />
        )}
        {/* Month separator lines */}
        {separators.map((y, i) => <line key={i} x1={0} y1={y} x2={W} y2={y} stroke="#f3f4f6" strokeWidth="1" />)}
        {/* Zero line */}
        {minVal < 0 && maxVal > 0 && (
          <line x1={xScale(0)} y1={0} x2={xScale(0)} y2={totalH} stroke="#e5e7eb" strokeWidth="1" strokeDasharray="3 2" />
        )}
        {/* Lines */}
        {points.length > 1 && <>
          <path d={eurPath} fill="none" stroke="#0ea5e9" strokeWidth="2" strokeLinejoin="round" />
          <path d={usdPath} fill="none" stroke="#22c55e" strokeWidth="2" strokeLinejoin="round" />
        </>}
        {/* Dots + value labels */}
        {points.map((p, i) => {
          const ex = xScale(p.eur), ux = xScale(p.usd)
          const eAnchor = ex < 40 ? 'start' : ex > W - 40 ? 'end' : 'middle'
          const uAnchor = ux < 40 ? 'start' : ux > W - 40 ? 'end' : 'middle'
          return (
            <g key={i}>
              <circle cx={ex} cy={p.y} r={2.5} fill="#0ea5e9" />
              <text x={ex} y={p.y - 6} textAnchor={eAnchor}
                    fill="#1e40af" stroke="white" strokeWidth="4" strokeLinejoin="round"
                    paintOrder="stroke" fontSize="10" fontWeight="600">
                {fmtNative(Math.round(p.eur), '€')}
              </text>
              <circle cx={ux} cy={p.y} r={2.5} fill="#22c55e" />
              <text x={ux} y={p.y + 15} textAnchor={uAnchor}
                    fill="#166534" stroke="white" strokeWidth="4" strokeLinejoin="round"
                    paintOrder="stroke" fontSize="10" fontWeight="600">
                {fmtNative(Math.round(p.usd), '$')}
              </text>
            </g>
          )
        })}
        {/* Scale labels — top */}
        {axisLabel(minVal, 'start', 9)}
        {minVal < 0 && maxVal > 0 && <>
          <text x={xScale(0)} y={9} textAnchor="middle" fill="white" fontSize="7.5" stroke="white" strokeWidth="3">0</text>
          <text x={xScale(0)} y={9} textAnchor="middle" fill="#9ca3af" fontSize="7.5">0</text>
        </>}
        {minVal !== maxVal && axisLabel(maxVal, 'end', 9)}
        {/* Scale labels — bottom */}
        {axisLabel(minVal, 'start', totalH - 2)}
        {minVal < 0 && maxVal > 0 && <>
          <text x={xScale(0)} y={totalH - 2} textAnchor="middle" fill="white" fontSize="7.5" stroke="white" strokeWidth="3">0</text>
          <text x={xScale(0)} y={totalH - 2} textAnchor="middle" fill="#9ca3af" fontSize="7.5">0</text>
        </>}
        {minVal !== maxVal && axisLabel(maxVal, 'end', totalH - 2)}
      </svg>
    </div>
  )
}

// ─── Projection view (chart left + table right) ───────────────────────────────

function eventTypeOrder(ev: CashEvent): number {
  if (ev.type === 'transfer') return 2
  if (ev.amountEUR < 0) return 0  // expense
  return 1                         // income
}

function ProjectionView({ projection, minTransactionEUR, accounts }: {
  projection: ProjectedMonth[]
  minTransactionEUR: number
  accounts: Account[]
}) {
  if (projection.length === 0) return <p className="text-[12px] text-gray-400 py-2">No upcoming cash events in the selected period.</p>

  const rows = projection.map(month => {
    const filteredExpenses = month.recurringItems.filter(it => it.amountEUR >= minTransactionEUR)
    const filteredIncome = month.recurringIncomeItems.filter(it => it.amountEUR >= minTransactionEUR)
    const sortedEvents = [...month.events]
      .filter(ev => ev.bypassesCash || Math.abs(ev.amountEUR) >= minTransactionEUR)
      .sort((a, b) => {
        const od = eventTypeOrder(a) - eventTypeOrder(b)
        return od !== 0 ? od : Math.abs(b.amountEUR) - Math.abs(a.amountEUR)
      })
    // Net row moved to date column — no extra slot
    const totalSlots = Math.max(1, filteredExpenses.length + filteredIncome.length + sortedEvents.length)
    // Per-currency net from the VISIBLE filtered rows — so the total matches what the user sees
    const eurNet =
      filteredIncome.filter(i => i.currency === 'EUR').reduce((s, i) => s + i.amountNative, 0)
      - filteredExpenses.filter(i => i.currency === 'EUR').reduce((s, i) => s + i.amountNative, 0)
      + sortedEvents.filter(e => !e.bypassesCash && e.currency.toUpperCase() === 'EUR').reduce((s, e) => s + e.amountNative, 0)
    const usdNet =
      filteredIncome.filter(i => i.currency === 'USD').reduce((s, i) => s + i.amountNative, 0)
      - filteredExpenses.filter(i => i.currency === 'USD').reduce((s, i) => s + i.amountNative, 0)
      + sortedEvents.filter(e => !e.bypassesCash && e.currency.toUpperCase() === 'USD').reduce((s, e) => s + e.amountNative, 0)
    return { month, totalSlots, filteredExpenses, filteredIncome, sortedEvents, eurNet, usdNet }
  })

  const slotCounts = rows.map(r => r.totalSlots)

  return (
    <div className="flex rounded-xl border border-gray-100 dark:border-gray-800 overflow-visible text-[12px]">
      {/* Chart — LEFT, aligned with rows */}
      <VerticalBalanceChart rows={rows.map(r => ({ month: r.month }))} slotCounts={slotCounts} accounts={accounts} />
      {/* Table */}
      <div className="flex-1 min-w-0">
        <div style={{ height: HEADER_H }} className="flex items-center border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 text-[10.5px] text-gray-400">
          <div className="w-[88px] shrink-0 px-3">Date</div>
          <div className="w-[90px] shrink-0 px-2">Category</div>
          <div className="flex-1 px-2">Event</div>
          <div className="w-[100px] shrink-0 text-right px-2">Amount</div>
        </div>
        <div className="divide-y divide-gray-100 dark:divide-gray-800">
          {rows.map(({ month, totalSlots, filteredExpenses, filteredIncome, sortedEvents, eurNet, usdNet }) => {
            const balanceColor = month.closingBalance < 0 ? 'text-red-500' : ''
            const rowH = totalSlots * ROW_H

            return (
              <div key={`${month.year}-${month.month}`} style={{ height: rowH }} className="flex">
                {/* Date cell — month label + per-currency net below */}
                <div className="w-[88px] shrink-0 px-3 flex flex-col items-end pt-[6px] gap-0.5 relative">
                  <span className="relative inline-block group cursor-help">
                    <span className={`text-[11.5px] ${balanceColor || 'text-gray-500'}`}>{month.label}</span>
                    <span className="absolute bottom-full right-0 mb-1.5 hidden group-hover:block z-30 pointer-events-none">
                      <MonthBalanceTooltip month={month} accounts={accounts} />
                    </span>
                  </span>
                  {eurNet !== 0 && (
                    <span className="flex items-center gap-0.5">
                      <span className={`tabular-nums text-[10px] font-medium ${eurNet >= 0 ? 'text-green-600' : 'text-red-500'}`}>{fmtNative(Math.round(eurNet), '€')}</span>
                      <span className={`${CUR_BADGE} ${EUR_BADGE_CLS}`}>€</span>
                    </span>
                  )}
                  {usdNet !== 0 && (
                    <span className="flex items-center gap-0.5">
                      <span className={`tabular-nums text-[10px] font-medium ${usdNet >= 0 ? 'text-green-600' : 'text-red-500'}`}>{fmtNative(Math.round(usdNet), '$')}</span>
                      <span className={`${CUR_BADGE} ${USD_BADGE_CLS}`}>$</span>
                    </span>
                  )}
                </div>
                <div className="flex-1 divide-y divide-gray-50 dark:divide-gray-800/50 pt-1">
                  {/* Per-expense recurring rows */}
                  {filteredExpenses.map((item, i) => (
                    <div key={i} style={{ height: ROW_H }} className="flex items-center">
                      <div className="w-[90px] shrink-0 px-2">
                        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-red-100 text-red-700 truncate max-w-full inline-block">{item.category}</span>
                      </div>
                      <div className="flex-1 min-w-0 px-2 text-[11px] text-gray-600 dark:text-gray-300 truncate">{item.name}</div>
                      <div className="w-[100px] shrink-0 flex items-center justify-end gap-1">
                        <span className="tabular-nums font-medium text-red-500">−{formatK(item.amountNative)}</span>
                        <span className={`${CUR_BADGE} ${item.currency === 'EUR' ? EUR_BADGE_CLS : USD_BADGE_CLS}`}>{currencySymbol(item.currency)}</span>
                      </div>
                    </div>
                  ))}
                  {/* Per-income-source recurring rows */}
                  {filteredIncome.map((item, i) => (
                    <div key={i} style={{ height: ROW_H }} className="flex items-center">
                      <div className="w-[90px] shrink-0 px-2">
                        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-green-100 text-green-700 truncate max-w-full inline-block">{item.category}</span>
                      </div>
                      <div className="flex-1 min-w-0 px-2 text-[11px] text-gray-600 dark:text-gray-300 truncate">{item.name}</div>
                      <div className="w-[100px] shrink-0 flex items-center justify-end gap-1">
                        <span className="tabular-nums font-medium text-green-600">+{formatK(item.amountNative)}</span>
                        <span className={`${CUR_BADGE} ${item.currency === 'EUR' ? EUR_BADGE_CLS : USD_BADGE_CLS}`}>{currencySymbol(item.currency)}</span>
                      </div>
                    </div>
                  ))}
                  {/* One-time events (sorted: expenses → income → transfers, then by |amount| DESC) */}
                  {sortedEvents.map((ev, i) => {
                    const style = EVENT_STYLE[ev.type] ?? EVENT_STYLE.one_time_expense
                    const badgeLabel = ev.category || style.label
                    const badgeBg = eventBadgeBg(ev.type, ev.amountNative)
                    const curBg = ev.currency === 'EUR' ? EUR_BADGE_CLS
                      : ev.currency === 'USD' ? USD_BADGE_CLS : 'bg-gray-200 text-gray-700'
                    return (
                      <div key={i} style={{ height: ROW_H }} className="flex items-center">
                        <div className="w-[90px] shrink-0 px-2 flex items-center">
                          <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${badgeBg}`}>{badgeLabel}</span>
                        </div>
                        <div className="flex-1 min-w-0 flex items-center gap-1.5 px-2">
                          <span className="truncate">{ev.label}</span>
                          {ev.installmentNote && <span className="text-[10px] text-indigo-500 font-medium shrink-0">{ev.installmentNote}</span>}
                          {ev.accountNote && <span className="text-[10px] text-gray-400 shrink-0 truncate">{ev.accountNote}</span>}
                        </div>
                        <div className="w-[100px] shrink-0 flex items-center justify-end gap-1">
                          <span className={`tabular-nums font-medium ${
                            ev.bypassesCash ? 'text-gray-400' : ev.amountEUR >= 0 ? 'text-green-600' : 'text-red-500'
                          }`}>
                            {ev.bypassesCash
                              ? `${ev.amountNative < 0 ? '−' : '+'}${formatK(Math.abs(ev.amountNative))}`
                              : `${ev.amountEUR >= 0 ? '+' : ''}${formatK(Math.abs(ev.amountNative))}`}
                          </span>
                          {ev.bypassesCash && (
                            <InfoTooltip text="This amount goes directly to/from a non-cash account (e.g., brokerage) and does not affect your cash balance." position="left" />
                          )}
                          <span className={`${CUR_BADGE} ${curBg}`}>{currencySymbol(ev.currency)}</span>
                        </div>
                      </div>
                    )
                  })}
                  {/* Empty slot when nothing at all */}
                  {sortedEvents.length === 0 && filteredExpenses.length === 0 && filteredIncome.length === 0 && (
                    <div style={{ height: ROW_H }} />
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}


// ─── Annual budget section ────────────────────────────────────────────────────

interface CategoryEntry { eur: number; usd: number; totalEUR: number }
interface CategoryItem { cat: string; entry: CategoryEntry; isIncome: boolean; isTransfer: boolean }

function emptyCE(): CategoryEntry { return { eur: 0, usd: 0, totalEUR: 0 } }
function addToCE(m: Record<string, CategoryEntry>, cat: string, amount: number, currency: string) {
  const e = m[cat] ??= emptyCE()
  if (currency.toUpperCase() === 'EUR') { e.eur += amount; e.totalEUR += amount }
  else { e.usd += amount; e.totalEUR += amount / DEFAULT_EUR_USD_RATE }
}
function sumCE(entries: CategoryEntry[]): CategoryEntry {
  return entries.reduce((s, e) => ({ eur: s.eur + e.eur, usd: s.usd + e.usd, totalEUR: s.totalEUR + e.totalEUR }), emptyCE())
}

/**
 * Build budget summary exclusively from the projection — guarantees perfect
 * consistency with the timeline table (same window, same categories, same amounts).
 */
function buildBudgetSummary(projection: ProjectedMonth[]): {
  items: CategoryItem[]
  totalIncome: CategoryEntry
  totalExpense: CategoryEntry
  transferNet: { eur: number; usd: number; totalEUR: number }
} {
  const incomeByCategory: Record<string, CategoryEntry> = {}
  const expenseByCategory: Record<string, CategoryEntry> = {}
  // Signed net for transfers: positive = credit, negative = debit
  const transferNet = { eur: 0, usd: 0, totalEUR: 0 }

  for (const month of projection) {
    // One-time events — use same categories as the badge shown in the table
    for (const ev of month.events) {
      if (ev.bypassesCash) continue
      const style = EVENT_STYLE[ev.type] ?? EVENT_STYLE.one_time_expense
      const cat = (ev.category || style.label).trim()
      const cur = ev.currency.toUpperCase()

      if (ev.type === 'transfer') {
        // Track signed net — credit (+) or debit (−)
        if (cur === 'EUR') { transferNet.eur += ev.amountNative; transferNet.totalEUR += ev.amountEUR }
        else { transferNet.usd += ev.amountNative; transferNet.totalEUR += ev.amountEUR }
      } else if (ev.amountEUR >= 0) {
        addToCE(incomeByCategory, cat, Math.abs(ev.amountNative), cur)
      } else {
        addToCE(expenseByCategory, cat, Math.abs(ev.amountNative), cur)
      }
    }
    // Recurring expenses — same category as the badge in the table
    for (const item of month.recurringItems) {
      addToCE(expenseByCategory, item.category.trim(), item.amountNative, item.currency)
    }
    // Recurring income — same category as the badge in the table
    for (const item of month.recurringIncomeItems) {
      addToCE(incomeByCategory, item.category.trim(), item.amountNative, item.currency)
    }
  }

  const totalIncome = sumCE(Object.values(incomeByCategory))
  const totalExpense = sumCE(Object.values(expenseByCategory))

  // Deduplicate across income/expense maps — same category name nets out into one row
  const rawItems: CategoryItem[] = [
    ...Object.entries(incomeByCategory).map(([cat, entry]) => ({ cat, entry, isIncome: true, isTransfer: false })),
    ...Object.entries(expenseByCategory).map(([cat, entry]) => ({ cat, entry, isIncome: false, isTransfer: false })),
  ]
  const deduped = new Map<string, CategoryItem>()
  for (const item of rawItems) {
    const key = item.cat
    const existing = deduped.get(key)
    if (!existing) {
      deduped.set(key, { ...item, entry: { ...item.entry } })
    } else {
      const sign = item.isIncome ? 1 : -1
      const existSign = existing.isIncome ? 1 : -1
      const netTotalEUR = existSign * existing.entry.totalEUR + sign * item.entry.totalEUR
      existing.entry.eur = existSign * existing.entry.eur + sign * item.entry.eur
      existing.entry.usd = existSign * existing.entry.usd + sign * item.entry.usd
      existing.entry.totalEUR = Math.abs(netTotalEUR)
      existing.entry.eur = Math.abs(existing.entry.eur)
      existing.entry.usd = Math.abs(existing.entry.usd)
      existing.isIncome = netTotalEUR >= 0
    }
  }

  const allItems = [...deduped.values()]
    .filter(it => it.entry.totalEUR > 0)
    .sort((a, b) => b.entry.totalEUR - a.entry.totalEUR)

  return { items: allItems, totalIncome, totalExpense, transferNet }
}

function CurrencyAmounts({ entry, isIncome }: { entry: CategoryEntry; isIncome: boolean }) {
  const sign = isIncome ? '+' : entry.totalEUR < 0 ? '' : '−'
  return (
    <div className="flex items-center gap-2 justify-end shrink-0">
      <div className="flex items-center gap-1 w-[90px] justify-end">
        {entry.eur !== 0
          ? <><span className="tabular-nums text-[10.5px]">{formatCurrency(Math.abs(entry.eur), 'EUR')}</span>
              <span className={`${CUR_BADGE} ${EUR_BADGE_CLS}`}>€</span></>
          : <span className="text-gray-300 dark:text-gray-600 text-[10.5px]">—</span>}
      </div>
      <div className="flex items-center gap-1 w-[90px] justify-end">
        {entry.usd !== 0
          ? <><span className="tabular-nums text-[10.5px]">{formatCurrency(Math.abs(entry.usd), 'USD')}</span>
              <span className={`${CUR_BADGE} ${USD_BADGE_CLS}`}>$</span></>
          : <span className="text-gray-300 dark:text-gray-600 text-[10.5px]">—</span>}
      </div>
      <span className={`w-[90px] text-right tabular-nums text-[11px] font-semibold shrink-0 ${entry.totalEUR >= 0 && isIncome ? 'text-green-600' : entry.totalEUR < 0 ? 'text-red-500' : 'text-red-500'}`}>
        {sign}{formatCurrency(Math.abs(entry.totalEUR), 'EUR')}
      </span>
    </div>
  )
}

function AnnualBudgetSection({ projection, months, sidebar }: {
  projection: ProjectedMonth[]
  months: number
  sidebar?: boolean
}) {
  const { items, totalIncome, totalExpense, transferNet } = useMemo(
    () => buildBudgetSummary(projection),
    [projection]
  )
  const net: CategoryEntry = {
    eur: totalIncome.eur - totalExpense.eur + transferNet.eur,
    usd: totalIncome.usd - totalExpense.usd + transferNet.usd,
    totalEUR: totalIncome.totalEUR - totalExpense.totalEUR + transferNet.totalEUR,
  }

  const maxAmt = Math.max(...items.map(c => c.entry.totalEUR), 1)

  // Income / Expenses / Transfer (if any) / Net rows
  const transferAbs: CategoryEntry = {
    eur: Math.abs(transferNet.eur),
    usd: Math.abs(transferNet.usd),
    totalEUR: Math.abs(transferNet.totalEUR),
  }
  const summaryRows = [
    { label: 'Income',   entry: totalIncome,  sign: '+', colorCls: 'text-green-600' },
    { label: 'Expenses', entry: totalExpense,  sign: '−', colorCls: 'text-red-500'   },
    ...(transferAbs.totalEUR > 0 ? [{
      label: 'Transfer', entry: transferAbs,
      sign: transferNet.totalEUR >= 0 ? '+' : '−',
      colorCls: transferNet.totalEUR >= 0 ? 'text-green-600' : 'text-red-500',
    }] : []),
    { label: 'Net',      entry: { eur: Math.abs(net.eur), usd: Math.abs(net.usd), totalEUR: Math.abs(net.totalEUR) },
      sign: net.totalEUR >= 0 ? '+' : '−',
      colorCls: net.totalEUR >= 0 ? 'text-green-600 font-bold' : 'text-red-500 font-bold' },
  ]

  // Helper: colored cell for a EUR or USD sub-total
  function subCell(value: number, currency: 'EUR' | 'USD', sign: string, cls: string) {
    if (value === 0) return <span className="text-gray-300 dark:text-gray-600">—</span>
    return <span className={`${cls} whitespace-nowrap`}>{sign}{formatCurrency(Math.round(Math.abs(value)), currency)}</span>
  }

  void months  // months unused now that summary is derived from projection

  if (sidebar) {
    const COL_LABEL = 'w-[64px] shrink-0 text-right'
    const COL_EUR   = 'w-[72px] shrink-0 text-right tabular-nums text-[10.5px]'
    const COL_USD   = 'w-[72px] shrink-0 text-right tabular-nums text-[10.5px]'
    const COL_TOTAL = 'w-[84px] shrink-0 text-right tabular-nums whitespace-nowrap border-l border-gray-200 dark:border-gray-700 pl-3 ml-1'

    const colHeader = (
      <div className="flex items-center gap-1 px-3 pt-2 pb-1">
        <span className={`${COL_LABEL} text-[9px] text-gray-400`}></span>
        <div className="flex-1" />
        <div className={`${COL_EUR} flex justify-end`}>
          <span className={`${CUR_BADGE} ${EUR_BADGE_CLS}`}>€</span>
        </div>
        <div className={`${COL_USD} flex justify-end`}>
          <span className={`${CUR_BADGE} ${USD_BADGE_CLS}`}>$</span>
        </div>
        <div className={`${COL_TOTAL} text-[9px] text-gray-400 uppercase tracking-wide`}>Total €</div>
      </div>
    )

    return (
      <>
        {/* ── Summary card ── */}
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50/80 dark:bg-gray-800/40 overflow-hidden">
          <div className="px-3 py-1.5 border-b border-gray-200 dark:border-gray-700 text-[9.5px] font-semibold text-gray-400 uppercase tracking-wide">Summary</div>
          {colHeader}
          <div className="pb-2">
            {summaryRows.map(({ label, entry, sign, colorCls }) => {
              const isNet = label === 'Net'
              return (
                <div key={label} className="flex items-center gap-1 px-3 py-0.5">
                  <span className={`${COL_LABEL} text-[10.5px] text-gray-500 dark:text-gray-400 ${isNet ? 'font-semibold' : 'font-medium'}`}>{label}</span>
                  <div className="flex-1" />
                  <span className={COL_EUR}>{subCell(entry.eur, 'EUR', sign, colorCls)}</span>
                  <span className={COL_USD}>{subCell(entry.usd, 'USD', sign, colorCls)}</span>
                  <span className={`${COL_TOTAL} text-[11px] ${colorCls}`}>
                    {entry.totalEUR === 0
                      ? <span className="text-gray-300 dark:text-gray-600">—</span>
                      : `${sign}${formatCurrency(Math.round(Math.abs(entry.totalEUR)), 'EUR')}`}
                  </span>
                </div>
              )
            })}
          </div>
        </div>

        {/* ── Categories card ── */}
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50/80 dark:bg-gray-800/40 overflow-hidden mt-3">
          <div className="px-3 py-1.5 border-b border-gray-200 dark:border-gray-700 text-[9.5px] font-semibold text-gray-400 uppercase tracking-wide">Categories</div>
          {colHeader}
          <div className="px-3 pb-3 space-y-1">
            {items.map(({ cat, entry, isIncome, isTransfer }) => {
              const key = `${isIncome ? 'inc' : isTransfer ? 'tr' : 'exp'}:${cat}`
              const barCls = isIncome ? 'bg-green-400/70 dark:bg-green-500/50' : 'bg-red-400/70 dark:bg-red-500/50'
              const sign = isIncome ? '+' : '−'
              const amtCls = isIncome ? 'text-green-600' : 'text-red-500'
              return (
                <div key={key} className="flex items-center gap-1">
                  <span className={`${COL_LABEL} text-[10px] text-gray-500 dark:text-gray-400 truncate`}>{cat}</span>
                  <div className="flex-1 h-[6px] bg-gray-100 dark:bg-gray-800/60 rounded overflow-hidden mx-1">
                    <div className={`h-full rounded ${barCls}`} style={{ width: `${(entry.totalEUR / maxAmt) * 100}%` }} />
                  </div>
                  <span className={`${COL_EUR} ${amtCls}`}>{subCell(entry.eur, 'EUR', sign, amtCls)}</span>
                  <span className={`${COL_USD} ${amtCls}`}>{subCell(entry.usd, 'USD', sign, amtCls)}</span>
                  <span className={`${COL_TOTAL} text-[10.5px] font-medium ${amtCls}`}>
                    {`${sign}${formatCurrency(Math.round(entry.totalEUR), 'EUR')}`}
                  </span>
                </div>
              )
            })}
            {items.length === 0 && <p className="text-[11px] text-gray-400 italic">No income or expenses in this period.</p>}
          </div>
        </div>
      </>
    )
  }

  // ── Non-sidebar (horizontal summary bar above category chart) ──
  return (
    <div className="pt-4 mt-4 border-t border-gray-100 dark:border-gray-800">
      <div className="flex justify-center mb-4">
        <div className="inline-flex items-stretch gap-0 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden bg-gray-50 dark:bg-gray-800/50 divide-x divide-gray-200 dark:divide-gray-700">
          {summaryRows.map(({ label, entry, sign }) => (
            <div key={label} className="flex items-center gap-3 px-4 py-2.5">
              <span className="text-[10.5px] font-medium text-gray-500 dark:text-gray-400 shrink-0">{label}</span>
              <CurrencyAmounts entry={entry} isIncome={sign === '+'} />
            </div>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-2 mb-1.5 text-[9.5px] text-gray-400 uppercase tracking-wide">
        <span className="w-[90px] text-right shrink-0">Category</span>
        <div className="flex-1" />
        <div className="w-[90px] text-right shrink-0 flex items-center justify-end gap-0.5">
          <span className={`${CUR_BADGE} ${EUR_BADGE_CLS}`}>€</span>
        </div>
        <div className="w-[90px] text-right shrink-0 flex items-center justify-end gap-0.5">
          <span className={`${CUR_BADGE} ${USD_BADGE_CLS}`}>$</span>
        </div>
        <span className="w-[90px] text-right shrink-0">Total (€)</span>
      </div>
      <div className="space-y-1.5">
        {items.map(({ cat, entry, isIncome, isTransfer }) => {
          const key = `${isIncome ? 'inc' : isTransfer ? 'tr' : 'exp'}:${cat}`
          const barCls = isIncome ? 'bg-green-400/70 dark:bg-green-500/50' : 'bg-red-400/70 dark:bg-red-500/50'
          const amtCls = isIncome ? 'text-green-600' : 'text-red-500'
          const sign = isIncome ? '+' : '−'
          return (
            <div key={key} className="flex items-center gap-2">
              <span className="w-[90px] text-right text-[11px] text-gray-500 dark:text-gray-400 shrink-0 truncate">{cat}</span>
              <div className="flex-1 h-[10px] bg-gray-50 dark:bg-gray-800/60 rounded overflow-hidden">
                <div className={`h-full rounded ${barCls}`} style={{ width: `${(entry.totalEUR / maxAmt) * 100}%` }} />
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <div className="w-[90px] text-right tabular-nums text-[10.5px] text-gray-500">
                  {entry.eur > 0 ? formatCurrency(Math.round(entry.eur), 'EUR') : '—'}
                </div>
                <div className="w-[90px] text-right tabular-nums text-[10.5px] text-gray-500">
                  {entry.usd > 0 ? formatCurrency(Math.round(entry.usd), 'USD') : '—'}
                </div>
              </div>
              <span className={`w-[90px] text-right tabular-nums text-[11px] font-medium shrink-0 ${amtCls}`}>
                {sign}{formatCurrency(Math.round(entry.totalEUR), 'EUR')}
              </span>
            </div>
          )
        })}
        {items.length === 0 && <p className="text-[11px] text-gray-400 italic">No income or expenses in the selected period.</p>}
      </div>
    </div>
  )
}

// ─── Shared period badge ─────────────────────────────────────────────────────

type BadgeVariant = 'violet' | 'emerald' | 'amber' | 'red'
const BADGE_CLS: Record<BadgeVariant, string> = {
  violet:  'bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300',
  emerald: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300',
  amber:   'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300',
  red:     'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300',
}
function PeriodBadge({ label, variant }: { label: string; variant: BadgeVariant }) {
  return (
    <span className={`inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded ${BADGE_CLS[variant]}`}>
      {label}
    </span>
  )
}

// ─── Cash column ──────────────────────────────────────────────────────────────

function CashColumn({ currency, cash, monthDiff, firstNegative, projectionEndLabel,
  monthLabel, openingBalances, closingBalances, zeroYieldWarning, accounts }: {
  currency: 'EUR' | 'USD'
  cash: number
  monthDiff: number
  firstNegative: { label: string; shortage: number; prevLabel: string } | null
  projectionEndLabel: string
  monthLabel: string
  openingBalances: import('../lib/cashProjection').AccountBalance[]
  closingBalances: import('../lib/cashProjection').AccountBalance[]
  zeroYieldWarning?: string
  accounts: Account[]
}) {
  const isEUR = currency === 'EUR'
  const sym = isEUR ? '€' : '$'
  const toNative = (balEUR: number) => isEUR ? balEUR : balEUR * DEFAULT_EUR_USD_RATE
  const accountById = new Map(accounts.map(account => [account.id, account]))

  const diffColor = monthDiff >= 0 ? 'text-emerald-600' : 'text-red-500'
  const diffLabel = `${monthDiff >= 0 ? '+' : ''}${formatCompact(monthDiff, currency)} this mo.`

  return (
    <div className={`rounded-xl border p-4 ${
      isEUR ? 'border-sky-200 dark:border-sky-900/50' : 'border-green-200 dark:border-green-900/50'
    }`}>
      <div className="flex items-start gap-5">
        {/* Left: currency + balance + diff */}
        <div className="shrink-0">
          <div className="flex items-center gap-1.5 mb-2">
            <span className="text-[16px] leading-none">{isEUR ? '🇪🇺' : '🇺🇸'}</span>
            <span className="text-[10px] font-bold tracking-widest text-gray-400 uppercase">{currency}</span>
          </div>
          <div className={`text-[34px] font-bold leading-none tracking-tight ${isEUR ? 'text-sky-600' : 'text-green-600'}`}>
            {formatCompact(cash, currency)}
          </div>
          {monthDiff !== 0 && (
            <div className={`text-[11px] font-medium mt-1 ${diffColor}`}>{diffLabel}</div>
          )}
        </div>

        {/* Right: status + inline account table */}
        <div className="flex-1 min-w-0">
          {/* Status message — top right */}
          <div className="text-right mb-1.5 leading-[1.8]">
            {firstNegative ? (
              <span className="text-[11px] text-amber-600 dark:text-amber-400 font-medium">
                ⚠ Goes negative in <PeriodBadge label={firstNegative.label} variant="amber" />
                {', top up '}<PeriodBadge label={formatCompact(firstNegative.shortage, currency)} variant="amber" />{' before!'}
              </span>
            ) : (
              <span className="text-[11px] text-emerald-600 dark:text-emerald-400">
                ✓ Through <PeriodBadge label={projectionEndLabel} variant="emerald" />
              </span>
            )}
          </div>
          {/* Table header */}
          <div className="flex items-center text-[9.5px] text-gray-400 mb-1 border-b border-gray-100 dark:border-gray-800 pb-1">
            <span className="flex-1 font-medium">{monthLabel}</span>
            <span className="w-[52px] text-right">Start</span>
            <span className="w-[52px] text-right">End</span>
            <span className="w-[52px] text-right">Net</span>
          </div>
          {/* Account rows */}
          <div className="space-y-0.5">
            {openingBalances.map(ob => {
              const cb = closingBalances.find(c => c.id === ob.id)
              const account = accountById.get(ob.id)
              const open = toNative(ob.balanceEUR)
              const close = toNative(cb?.balanceEUR ?? ob.balanceEUR)
              const net = close - open
              return (
                <div key={ob.id} className="flex items-center text-[10.5px]">
                  <span className="flex-1 min-w-0 inline-flex items-center gap-1.5 text-gray-600 dark:text-gray-300">
                    {account && <AccountLogo account={account} size="xs" />}
                    <span className="truncate">{ob.name}</span>
                  </span>
                  <span className={`w-[52px] text-right tabular-nums ${open >= 0 ? 'text-gray-500' : 'text-red-500'}`}>{fmtNative(Math.round(open), sym)}</span>
                  <span className={`w-[52px] text-right tabular-nums ${close >= 0 ? 'text-gray-500' : 'text-red-500'}`}>{fmtNative(Math.round(close), sym)}</span>
                  <span className={`w-[52px] text-right tabular-nums font-medium ${net >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>{fmtNative(Math.round(net), sym)}</span>
                </div>
              )
            })}
            {openingBalances.length === 0 && (
              <p className="text-[10.5px] text-gray-400 italic">No {currency} cash accounts</p>
            )}
          </div>
        </div>
      </div>

      {zeroYieldWarning && <Banner variant="warning" className="mt-2 text-[10.5px]">{zeroYieldWarning}</Banner>}
    </div>
  )
}

// ─── Global cash banner ───────────────────────────────────────────────────────

function GlobalCashBanner({
  totalCashEUR,
  projectedCashEUR,
  totalIncomeEUR,
  totalExpensesEUR,
  startLabel,
  projectionEndLabel,
}: {
  totalCashEUR: number
  projectedCashEUR: number
  totalIncomeEUR: number
  totalExpensesEUR: number
  startLabel: string
  projectionEndLabel: string
}) {
  const projBadgeVariant: BadgeVariant = projectedCashEUR >= 0 ? 'emerald' : 'red'
  const CASH_NUM = 'text-[34px] font-bold leading-none tracking-tight tabular-nums'
  const FLOW_NUM = 'text-[22px] font-bold leading-none tracking-tight tabular-nums'
  const LABEL_CLS = 'text-[11px] text-gray-500 dark:text-gray-400 font-medium'
  const startBadgeVariant: BadgeVariant = totalCashEUR >= 0 ? 'emerald' : 'red'

  return (
    <div className="rounded-xl border border-violet-200 dark:border-violet-900/50 px-4 py-2.5">
      {/* Top row: two cash totals */}
      <div className="flex divide-x divide-violet-100 dark:divide-violet-900/40 pb-2 mb-2 border-b border-violet-100 dark:border-violet-900/40">
        <div className="flex-1 pr-3">
          <div className="flex items-center gap-1 mb-1.5">
            <span className={LABEL_CLS}>Start cash</span>
            <PeriodBadge label={startLabel} variant={startBadgeVariant} />
            <InfoTooltip text="Current consolidated cash: all EUR + USD accounts converted to EUR at current rate." />
          </div>
          <div className={`${CASH_NUM} ${totalCashEUR >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
            {formatCompact(totalCashEUR, 'EUR')}
          </div>
        </div>
        <div className="flex-1 pl-3">
          <div className="flex items-center gap-1 mb-1.5">
            <span className={LABEL_CLS}>End cash</span>
            <PeriodBadge label={projectionEndLabel} variant={projBadgeVariant} />
            <InfoTooltip text="Projected consolidated cash at the end of the selected period." />
          </div>
          <div className={`${CASH_NUM} ${projectedCashEUR >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
            {formatCompact(projectedCashEUR, 'EUR')}
          </div>
        </div>
      </div>
      {/* Bottom row: income + expenses */}
      <div className="flex divide-x divide-violet-100 dark:divide-violet-900/40">
        <div className="flex-1 pr-3">
          <div className="flex items-center gap-1 mb-1">
            <span className={LABEL_CLS}>Total income</span>
            <InfoTooltip text="Total cash inflows (pensions, windfalls, sales) over the selected period." />
          </div>
          <div className={`${FLOW_NUM} text-emerald-600`}>{formatCompact(totalIncomeEUR, 'EUR')}</div>
        </div>
        <div className="flex-1 pl-3">
          <div className="flex items-center gap-1 mb-1">
            <span className={LABEL_CLS}>Total expenses</span>
            <InfoTooltip text="Total cash outflows (expenses, taxes, one-time costs) over the selected period." />
          </div>
          <div className={`${FLOW_NUM} text-red-500`}>−{formatCompact(totalExpensesEUR, 'EUR')}</div>
        </div>
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function CashFlow() {
  const {
    accounts, expenses, medicalCoverages, medicalExpenses,
    pensions, profile, realEstateEvents, windfalls, taxConfig, transfers,
    dividendHistory, minTransactionEUR, liveEurUsdRate,
  } = useAppStore()

  const cashAccounts = accounts.filter(a => a.type === 'cash' && a.includedInPlanning !== false)
  const usdAccounts = cashAccounts.filter(a => a.currency.toUpperCase() === 'USD')
  const eurAccounts = cashAccounts.filter(a => a.currency.toUpperCase() === 'EUR')

  const usdCash = usdAccounts.reduce((s, a) => s + a.balance, 0)
  const eurCash = eurAccounts.reduce((s, a) => s + a.balance, 0)

  const annualDivEUR = computeAnnualDivEUR(accounts, dividendHistory, liveEurUsdRate)

  const [projectionMode, setProjectionMode] = useLocalStorage<'year' | 'next12'>('cashflow.projectionMode', 'next12')
  const currentYear = new Date().getFullYear()
  // 'year' = remaining months in current year; 'next12' = rolling 12 months
  const projectionMonths = projectionMode === 'year' ? 12 - new Date().getMonth() : 12

  const projection = buildCashProjection({
    accounts, expenses,
    medicalCoverages: medicalCoverages ?? [],
    medicalExpenses: medicalExpenses ?? [],
    pensions, realEstateEvents, windfalls,
    transfers: transfers ?? [],
    taxConfig, profile, months: projectionMonths, annualDivEUR,
  })

  const eurZeroYieldAmt = eurAccounts.filter(a => (a.interestRate ?? 0) === 0).reduce((s, a) => s + a.balance, 0)
  const eurZeroYieldWarning = eurCash > 0 && eurZeroYieldAmt / eurCash > 0.3
    ? `${formatCurrency(eurZeroYieldAmt, 'EUR')} (${Math.round(eurZeroYieldAmt / eurCash * 100)}% of EUR cash) earning 0% — consider a livret or high-yield account.`
    : undefined

  // Monthly diff: expected change for current month based on projection
  const m0 = projection[0]
  const eurMonthDiff = m0
    ? m0.accountBalances.filter(a => a.currency === 'EUR').reduce((s, a) => s + a.balanceEUR, 0)
      - m0.openingAccountBalances.filter(a => a.currency === 'EUR').reduce((s, a) => s + a.balanceEUR, 0)
    : 0
  const usdMonthDiff = m0
    ? (m0.accountBalances.filter(a => a.currency === 'USD').reduce((s, a) => s + a.balanceEUR, 0)
       - m0.openingAccountBalances.filter(a => a.currency === 'USD').reduce((s, a) => s + a.balanceEUR, 0)) * liveEurUsdRate
    : 0

  const projectionEndLabel = projection.length > 0 ? projection[projection.length - 1].label : ''
  const currentMonthLabel = m0?.label ?? ''

  // Consolidated cash (all currencies → EUR)
  const totalCashEUR = eurCash + usdCash / liveEurUsdRate
  const lastMonth = projection.length > 0 ? projection[projection.length - 1] : null
  const projectedCashEUR = lastMonth
    ? lastMonth.accountBalances.reduce((s, a) => s + a.balanceEUR, 0)
    : totalCashEUR
  const { totalExpense: projTotalExpense, totalIncome: projTotalIncome } = useMemo(() => buildBudgetSummary(projection), [projection])

  // Per-currency first month where balance goes negative (using closing balances)
  function findFirstNegative(cur: 'EUR' | 'USD') {
    for (let i = 0; i < projection.length; i++) {
      const month = projection[i]
      const native = month.accountBalances
        .filter(a => a.currency === cur)
        .reduce((s, a) => s + (cur === 'EUR' ? a.balanceEUR : a.balanceEUR * liveEurUsdRate), 0)
      if (native < 0) {
        const prevLabel = i > 0 ? projection[i - 1].label : month.label
        return { label: month.label, shortage: Math.ceil(-native), prevLabel }
      }
    }
    return null
  }
  const eurFirstNegative = findFirstNegative('EUR')
  const usdFirstNegative = findFirstNegative('USD')

  // Per-account opening/closing for current month, split by currency
  const eurOpenBals = (m0?.openingAccountBalances ?? []).filter(a => a.currency === 'EUR')
  const eurCloseBals = (m0?.accountBalances ?? []).filter(a => a.currency === 'EUR')
  const usdOpenBals = (m0?.openingAccountBalances ?? []).filter(a => a.currency === 'USD')
  const usdCloseBals = (m0?.accountBalances ?? []).filter(a => a.currency === 'USD')

  return (
    <div>
      <PageHeader title="Cash flow">
        <div className="flex rounded-[5px] overflow-hidden border border-gray-200 dark:border-gray-700 text-[11px]">
          {(['year', 'next12'] as const).map(mode => (
            <button key={mode} onClick={() => setProjectionMode(mode)}
              className={`px-[10px] py-[3px] transition-colors ${
                projectionMode === mode
                  ? 'bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900'
                  : 'text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800'
              }`}>
              {mode === 'year' ? currentYear : 'Next 12m'}
            </button>
          ))}
        </div>
      </PageHeader>
      <div className="p-4 space-y-5">

        {/* Global + per-currency columns */}
        <div className="grid grid-cols-3 gap-6">
          <GlobalCashBanner
            totalCashEUR={totalCashEUR}
            projectedCashEUR={projectedCashEUR}
            totalIncomeEUR={projTotalIncome.totalEUR}
            totalExpensesEUR={projTotalExpense.totalEUR}
            startLabel={currentMonthLabel}
            projectionEndLabel={projectionEndLabel}
          />
          <CashColumn
            currency="EUR" cash={eurCash}
            monthDiff={eurMonthDiff}
            firstNegative={eurFirstNegative}
            projectionEndLabel={projectionEndLabel}
            monthLabel={currentMonthLabel}
            openingBalances={eurOpenBals}
            closingBalances={eurCloseBals}
            zeroYieldWarning={eurZeroYieldWarning}
            accounts={accounts}
          />
          <CashColumn
            currency="USD" cash={usdCash}
            monthDiff={usdMonthDiff}
            firstNegative={usdFirstNegative}
            projectionEndLabel={projectionEndLabel}
            monthLabel={currentMonthLabel}
            openingBalances={usdOpenBals}
            closingBalances={usdCloseBals}
            accounts={accounts}
          />
        </div>

        {/* Cash projection */}
        <Card>
          <div className="text-[11.5px] font-medium text-gray-500 dark:text-gray-400 flex items-center mb-[10px]">
            Cash projection
            <InfoTooltip text="Month-by-month EUR and USD cash balance. Recurring income includes interest (in the net) and quarterly dividends (as events). Grayed amounts go directly to/from a non-cash account and don't affect the cash balance." />
          </div>
          <div className="flex gap-5 items-start">
            <div className="flex-1 min-w-0">
              {projection.length > 0
                ? <ProjectionView projection={projection} minTransactionEUR={minTransactionEUR} accounts={accounts} />
                : <p className="text-[12px] text-gray-400 py-4 text-center">Configure expenses to see projection.</p>
              }
            </div>
            <div className="w-[400px] shrink-0">
              <AnnualBudgetSection projection={projection} months={projectionMonths} sidebar />
            </div>
          </div>
        </Card>

      </div>
    </div>
  )
}
