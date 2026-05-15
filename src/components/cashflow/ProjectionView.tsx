import { useState } from 'react'
import { InfoTooltip } from '../ui/InfoTooltip'
import { AccountLogo } from '../ui/AccountLabel'
import { DEFAULT_EUR_USD_RATE } from '../../lib/currency'
import type { Account } from '../../types'
import type { CashEvent, ProjectedMonth } from '../../lib/cashProjection'

export const CUR_BADGE = 'text-[9px] font-bold px-1.5 py-px rounded'
export const EUR_BADGE_CLS = 'bg-sky-500 text-white'
export const USD_BADGE_CLS = 'bg-emerald-600 text-white'

export const EVENT_STYLE: Record<string, { label: string }> = {
  real_estate:      { label: 'Real estate' },
  windfall:         { label: 'Windfall' },
  one_time_expense: { label: 'Expense' },
  tax_payment:      { label: 'Tax' },
  transfer:         { label: 'Transfer' },
  dividend:         { label: 'Dividend' },
}

function currencySymbol(cur: string): string {
  return cur === 'EUR' ? '€' : cur === 'USD' ? '$' : cur
}

function eventBadgeBg(type: string, amountNative: number): string {
  if (type === 'transfer') return 'bg-blue-100 text-blue-700'
  if (amountNative >= 0) return 'bg-green-100 text-green-700'
  return 'bg-red-100 text-red-700'
}

export function formatK(v: number): string {
  const abs = Math.abs(v)
  const sign = v < 0 ? '−' : ''
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(1)}M`
  if (abs >= 10_000) return `${sign}${(abs / 1_000).toFixed(0)}k`
  if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(1)}k`
  return `${sign}${Math.abs(Math.round(v))}`
}

/** Format a native-currency amount with sign before symbol: −$10k, +€5k */
export function fmtNative(v: number, sym: string): string {
  const sign = v < 0 ? '−' : ''
  return `${sign}${sym}${formatK(Math.abs(v))}`
}

export function findFirstNegative(
  projection: ProjectedMonth[],
  currency: 'EUR' | 'USD',
  fxRate = DEFAULT_EUR_USD_RATE,
): { label: string; shortage: number; prevLabel: string } | null {
  for (let i = 0; i < projection.length; i++) {
    const month = projection[i]
    const native = month.accountBalances
      .filter(account => account.currency === currency)
      .reduce((sum, account) => sum + (currency === 'EUR' ? account.balanceEUR : account.balanceEUR * fxRate), 0)
    if (native < 0) {
      const prevLabel = i > 0 ? projection[i - 1].label : month.label
      return { label: month.label, shortage: Math.ceil(-native), prevLabel }
    }
  }
  return null
}

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
        const balanceLabel = cur === 'EUR' ? 'Euro balance' : 'USD balance'
        return (
          <div key={cur} className="mb-2">
            <div className="flex min-h-5 items-center justify-between">
              <span className="inline-flex items-center gap-1.5">
                <span className={`${CUR_BADGE} ${cur === 'EUR' ? EUR_BADGE_CLS : USD_BADGE_CLS}`}>{cur === 'EUR' ? '€' : '$'}</span>
                <span className="text-[10px] font-medium text-gray-300">{balanceLabel}</span>
              </span>
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
                <div key={oa.id} className="flex min-h-5 items-center justify-between pl-3">
                  <span className="text-gray-400 text-[10px] leading-5 flex-1 min-w-0 inline-flex items-center gap-1.5">
                    {account && <AccountLogo account={account} size="xs" />}
                    <span className="truncate">{oa.name}</span>
                  </span>
                  <div className="flex gap-1 shrink-0">
                    <span className={`tabular-nums text-[10px] leading-5 w-[48px] text-right ${oNative >= 0 ? 'text-gray-300' : 'text-red-400'}`}>{fmtNative(Math.round(oNative), sym)}</span>
                    <span className={`tabular-nums text-[10px] leading-5 w-[48px] text-right ${cNative >= 0 ? 'text-gray-300' : 'text-red-400'}`}>{fmtNative(Math.round(cNative), sym)}</span>
                    <span className={`tabular-nums text-[10px] leading-5 w-[48px] text-right ${netNative >= 0 ? 'text-green-400' : 'text-red-400'}`}>{fmtNative(Math.round(netNative), sym)}</span>
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
  const bandStarts: number[] = []
  let cumH = 0
  for (const c of slotCounts) { bandStarts.push(cumH); cumH += c * ROW_H }

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
      <div style={{ height: HEADER_H }} className="flex items-center gap-3 px-3 border-b border-gray-100 dark:border-gray-800 text-[9px] text-gray-400">
        <span className="flex items-center gap-1.5"><span className="w-3 h-[2px] rounded bg-sky-500 inline-block" />EUR</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-[2px] rounded bg-emerald-500 inline-block" />USD</span>
      </div>
      {hoveredRow != null && (
        <div className="absolute left-full ml-2 z-20" style={{ top: tooltipTop }}>
          <MonthBalanceTooltip month={hoveredRow.month} accounts={accounts} />
        </div>
      )}
      <svg width={W} height={totalH} className="block" onMouseMove={handleMouseMove} onMouseLeave={() => setHoveredIdx(null)}>
        {hoveredIdx != null && (
          <rect x={0} y={bandStarts[hoveredIdx]} width={W} height={slotCounts[hoveredIdx] * ROW_H} fill="rgba(99,102,241,0.07)" />
        )}
        {separators.map((y, i) => <line key={i} x1={0} y1={y} x2={W} y2={y} stroke="#f3f4f6" strokeWidth="1" />)}
        {minVal < 0 && maxVal > 0 && (
          <line x1={xScale(0)} y1={0} x2={xScale(0)} y2={totalH} stroke="#e5e7eb" strokeWidth="1" strokeDasharray="3 2" />
        )}
        {points.length > 1 && <>
          <path d={eurPath} fill="none" stroke="#0ea5e9" strokeWidth="2" strokeLinejoin="round" />
          <path d={usdPath} fill="none" stroke="#22c55e" strokeWidth="2" strokeLinejoin="round" />
        </>}
        {points.map((p, i) => {
          const ex = xScale(p.eur), ux = xScale(p.usd)
          const eAnchor = ex < 40 ? 'start' : ex > W - 40 ? 'end' : 'middle'
          const uAnchor = ux < 40 ? 'start' : ux > W - 40 ? 'end' : 'middle'
          return (
            <g key={i}>
              <circle cx={ex} cy={p.y} r={2.5} fill="#0ea5e9" />
              <text x={ex} y={p.y - 6} textAnchor={eAnchor} fill="#1e40af" stroke="white" strokeWidth="4" strokeLinejoin="round" paintOrder="stroke" fontSize="10" fontWeight="600">
                {fmtNative(Math.round(p.eur), '€')}
              </text>
              <circle cx={ux} cy={p.y} r={2.5} fill="#22c55e" />
              <text x={ux} y={p.y + 15} textAnchor={uAnchor} fill="#166534" stroke="white" strokeWidth="4" strokeLinejoin="round" paintOrder="stroke" fontSize="10" fontWeight="600">
                {fmtNative(Math.round(p.usd), '$')}
              </text>
            </g>
          )
        })}
        {axisLabel(minVal, 'start', 9)}
        {minVal < 0 && maxVal > 0 && <>
          <text x={xScale(0)} y={9} textAnchor="middle" fill="white" fontSize="7.5" stroke="white" strokeWidth="3">0</text>
          <text x={xScale(0)} y={9} textAnchor="middle" fill="#9ca3af" fontSize="7.5">0</text>
        </>}
        {minVal !== maxVal && axisLabel(maxVal, 'end', 9)}
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

function eventTypeOrder(ev: CashEvent): number {
  if (ev.type === 'transfer') return 2
  if (ev.amountEUR < 0) return 0
  return 1
}

export function ProjectionView({ projection, minTransactionEUR, accounts, className = '' }: {
  projection: ProjectedMonth[]
  minTransactionEUR: number
  accounts: Account[]
  className?: string
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
    const totalSlots = Math.max(1, filteredExpenses.length + filteredIncome.length + sortedEvents.length)
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
    <div className={`flex rounded-xl border border-gray-100 dark:border-gray-800 overflow-visible text-[12px] ${className}`}>
      <VerticalBalanceChart rows={rows.map(r => ({ month: r.month }))} slotCounts={slotCounts} accounts={accounts} />
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
