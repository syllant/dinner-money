import { useState, useMemo } from 'react'
import { useAppStore } from '../store/useAppStore'
import { PageHeader } from '../components/ui/PageHeader'
import { Card } from '../components/ui/Card'
import { Banner } from '../components/ui/Banner'
import { InfoTooltip } from '../components/ui/InfoTooltip'
import { AccountLogo } from '../components/ui/AccountLabel'
import {
  CUR_BADGE, EUR_BADGE_CLS, EVENT_STYLE, ProjectionView, USD_BADGE_CLS,
  findFirstNegative, fmtNative,
} from '../components/cashflow/ProjectionView'
import { formatCurrency, formatCompact } from '../lib/format'
import { DEFAULT_EUR_USD_RATE } from '../lib/currency'
import { buildCashProjection } from '../lib/cashProjection'
import { computeAnnualDividendsEUR } from '../lib/dividends'
import type { ProjectedMonth } from '../lib/cashProjection'
import type { Account } from '../types'

// ─── Helpers ──────────────────────────────────────────────────────────────────



function useLocalStorage<T>(key: string, init: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try { const s = localStorage.getItem(key); return s != null ? (JSON.parse(s) as T) : init }
    catch { return init }
  })
  return [value, (v: T) => { setValue(v); try { localStorage.setItem(key, JSON.stringify(v)) } catch {} }]
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

  const annualDivEUR = computeAnnualDividendsEUR(accounts, dividendHistory, liveEurUsdRate)

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

  const eurFirstNegative = findFirstNegative(projection, 'EUR', liveEurUsdRate)
  const usdFirstNegative = findFirstNegative(projection, 'USD', liveEurUsdRate)

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
