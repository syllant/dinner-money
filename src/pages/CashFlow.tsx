import { useState } from 'react'
import {
  ComposedChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts'
import { useAppStore } from '../store/useAppStore'
import { PageHeader } from '../components/ui/PageHeader'
import { MetricCard } from '../components/ui/MetricCard'
import { Card, CardTitle } from '../components/ui/Card'
import { Table, TableHead, TableRow } from '../components/ui/Table'
import { Banner } from '../components/ui/Banner'
import { formatCurrency, formatCompact } from '../lib/format'
import { DEFAULT_EUR_USD_RATE } from '../lib/currency'
import { buildCashProjection, avgMonthlyBurn } from '../lib/cashProjection'
import { projectedAnnualDividendsEUR } from '../lib/dividends'
import type { ProjectedMonth, CashEvent } from '../lib/cashProjection'
import type { Account, PensionEstimate, UserProfile } from '../types'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toEUR(amount: number, currency: string) {
  return currency.toUpperCase() === 'USD' ? amount / DEFAULT_EUR_USD_RATE : amount
}

function computeMonthlyBurn(
  expenses: ReturnType<typeof useAppStore.getState>['expenses'],
  medicalCoverages: ReturnType<typeof useAppStore.getState>['medicalCoverages'],
  medicalExpenses: ReturnType<typeof useAppStore.getState>['medicalExpenses'],
): number {
  const today = new Date()
  const cy = today.getFullYear()
  const cm = today.getMonth() + 1
  const allExp = [...expenses, ...(medicalCoverages ?? []), ...(medicalExpenses ?? [])]
  return allExp.reduce((sum, exp) => {
    const startY = parseInt(exp.startDate.split('-')[0])
    const startM = parseInt(exp.startDate.split('-')[1] ?? '1')
    const endY = exp.endDate ? parseInt(exp.endDate.split('-')[0]) : null
    const endM = exp.endDate ? parseInt(exp.endDate.split('-')[1] ?? '12') : null
    const afterStart = cy > startY || (cy === startY && cm >= startM)
    const beforeEnd = endY === null || cy < endY || (cy === endY && cm <= (endM ?? 12))
    if (!afterStart || !beforeEnd) return sum
    const monthly = exp.frequency === 'monthly' ? exp.amount :
      exp.frequency === 'yearly' ? exp.amount / 12 : 0
    return sum + toEUR(monthly, exp.currency)
  }, 0)
}

function computeMonthlyIncome(pensions: PensionEstimate[], profile: UserProfile): number {
  const today = new Date()
  const cy = today.getFullYear()
  return pensions.reduce((sum, p) => {
    const personBY = p.person === 'self' ? profile.birthYear : profile.spouseBirthYear
    if (personBY + p.startAge > cy) return sum
    return sum + toEUR(p.monthlyAmount, p.currency)
  }, 0)
}

// ─── Event type styling ───────────────────────────────────────────────────────

const EVENT_STYLE: Record<string, { bg: string; label: string }> = {
  real_estate:      { bg: 'bg-green-100 text-green-700',    label: 'Real estate' },
  windfall:         { bg: 'bg-amber-100 text-amber-700',    label: 'Windfall' },
  one_time_expense: { bg: 'bg-red-100 text-red-700',        label: 'Expense' },
  tax_payment:      { bg: 'bg-violet-100 text-violet-700',  label: 'Tax' },
  transfer:         { bg: 'bg-sky-100 text-sky-700',        label: 'Transfer' },
}

// ─── Cash flow chart ──────────────────────────────────────────────────────────

interface ChartPoint {
  label: string
  balance: number
  hasEvent: boolean
  events: CashEvent[]
  bufferThreshold: number
}

function CashFlowTooltip({ active, payload }: {
  active?: boolean
  payload?: Array<{ payload: ChartPoint }>
}) {
  if (!active || !payload?.length) return null
  const pt = payload[0]?.payload
  if (!pt) return null
  return (
    <div className="bg-gray-900 text-white text-[11px] px-3 py-2 rounded-lg shadow-lg border border-gray-700 max-w-[240px]">
      <div className="font-semibold mb-1 pb-1 border-b border-gray-700">{pt.label}</div>
      <div className={`font-medium ${pt.balance < 0 ? 'text-red-400' : pt.balance < pt.bufferThreshold ? 'text-amber-400' : 'text-green-400'}`}>
        {formatCompact(pt.balance, 'EUR')} cash
      </div>
      {pt.events.length > 0 && (
        <div className="mt-1.5 pt-1.5 border-t border-gray-700 space-y-1">
          {pt.events.map((ev, i) => (
            <div key={i} className="flex items-start justify-between gap-2">
              <span className={`flex-1 truncate ${ev.bypassesCash ? 'text-gray-400' : 'text-gray-300'}`}>
                {ev.label}{ev.accountNote ? ` ${ev.accountNote}` : ''}
              </span>
              {ev.bypassesCash
                ? <span className="text-gray-500 shrink-0 text-[10px]">bypasses cash</span>
                : <span className={ev.amountEUR >= 0 ? 'text-green-400 shrink-0' : 'text-red-400 shrink-0'}>
                    {ev.amountEUR >= 0 ? '+' : ''}{formatCompact(ev.amountEUR, 'EUR')}
                  </span>
              }
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function CashFlowChart({ projection, bufferThreshold }: {
  projection: ProjectedMonth[]
  bufferThreshold: number
}) {
  const data: ChartPoint[] = projection.map(p => ({
    label: p.label,
    balance: Math.round(p.closingBalance),
    hasEvent: p.events.some(e => !e.bypassesCash || e.amountEUR !== 0),
    events: p.events,
    bufferThreshold,
  }))

  const minBalance = Math.min(...data.map(d => d.balance), 0)
  const maxBalance = Math.max(...data.map(d => d.balance))
  const yPad = (maxBalance - minBalance) * 0.12
  const endsLow = (data[data.length - 1]?.balance ?? Infinity) < bufferThreshold

  const eventMonths = data.filter(d => d.hasEvent).map(d => d.label)

  return (
    <ResponsiveContainer width="100%" height={200}>
      <ComposedChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id="cashGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={endsLow ? '#f59e0b' : '#22c55e'} stopOpacity={0.25} />
            <stop offset="95%" stopColor={endsLow ? '#f59e0b' : '#22c55e'} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <XAxis
          dataKey="label"
          tick={{ fontSize: 10, fill: '#9ca3af' }}
          tickLine={false}
          axisLine={false}
          interval={1}
        />
        <YAxis
          tick={{ fontSize: 10, fill: '#9ca3af' }}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v: number) => formatCompact(v, 'EUR')}
          domain={[Math.min(minBalance - yPad, 0), maxBalance + yPad]}
          width={52}
        />
        <Tooltip content={<CashFlowTooltip />} />
        {bufferThreshold > 0 && (
          <ReferenceLine
            y={bufferThreshold}
            stroke="#f59e0b"
            strokeDasharray="4 3"
            strokeWidth={1}
            label={{ value: '3-mo buffer', position: 'insideTopRight', fontSize: 9, fill: '#f59e0b' }}
          />
        )}
        {minBalance < 0 && (
          <ReferenceLine y={0} stroke="#ef4444" strokeWidth={1} strokeDasharray="3 2" />
        )}
        {eventMonths.map(label => (
          <ReferenceLine
            key={label}
            x={label}
            stroke="#6366f1"
            strokeWidth={1}
            strokeDasharray="3 2"
          />
        ))}
        <Area
          type="monotone"
          dataKey="balance"
          stroke={endsLow ? '#f59e0b' : '#22c55e'}
          strokeWidth={2}
          fill="url(#cashGrad)"
          dot={false}
          activeDot={{ r: 3, fill: endsLow ? '#f59e0b' : '#22c55e' }}
        />
      </ComposedChart>
    </ResponsiveContainer>
  )
}

// ─── Upcoming events table ────────────────────────────────────────────────────

function UpcomingEventsTable({ projection, bufferThreshold }: {
  projection: ProjectedMonth[]
  bufferThreshold: number
}) {
  const rows: Array<{ month: ProjectedMonth; isWarning: boolean }> = []
  let warnedOnce = false

  for (const month of projection) {
    const hasEvents = month.events.length > 0
    const isLow = month.closingBalance < bufferThreshold && month.closingBalance >= 0
    const isNeg = month.closingBalance < 0
    const showWarning = (isLow || isNeg) && !warnedOnce
    if (showWarning) warnedOnce = true
    if (hasEvents || showWarning) {
      rows.push({ month, isWarning: !hasEvents && showWarning })
    }
  }

  if (rows.length === 0) {
    return <p className="text-[12px] text-gray-400 py-2">No upcoming cash events in the next 12 months.</p>
  }

  return (
    <Table>
      <TableHead>
        <div className="grid grid-cols-[90px_1fr_110px_110px] gap-2 text-[11px]">
          <span>Date</span><span>Event</span><span className="text-right">Amount</span><span className="text-right">Balance after</span>
        </div>
      </TableHead>
      {rows.map(({ month, isWarning }) => {
        if (isWarning) {
          return (
            <TableRow key={`${month.year}-${month.month}-warn`}>
              <div className="grid grid-cols-[90px_1fr_110px_110px] gap-2 items-center text-[12px]">
                <span className="text-amber-600 font-medium">{month.label}</span>
                <span className="text-amber-600 italic">
                  {month.closingBalance < 0 ? 'Balance goes negative' : 'Below 3-month buffer'}
                </span>
                <span />
                <span className={`text-right font-medium ${month.closingBalance < 0 ? 'text-red-500' : 'text-amber-500'}`}>
                  {formatCurrency(month.closingBalance, 'EUR')}
                </span>
              </div>
            </TableRow>
          )
        }

        return month.events.map((ev, i) => {
          const style = EVENT_STYLE[ev.type] ?? EVENT_STYLE.one_time_expense
          return (
            <TableRow key={`${month.year}-${month.month}-${i}`}>
              <div className="grid grid-cols-[90px_1fr_110px_110px] gap-2 items-center text-[12px]">
                <span className="text-gray-500">{i === 0 ? month.label : ''}</span>
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded shrink-0 ${style.bg}`}>
                    {style.label}
                  </span>
                  <span className="truncate">{ev.label}</span>
                  {ev.accountNote && (
                    <span className="text-[10px] text-gray-400 shrink-0 truncate">{ev.accountNote}</span>
                  )}
                </div>
                <span className={`text-right font-medium tabular-nums ${
                  ev.bypassesCash ? 'text-gray-400 italic' :
                  ev.amountEUR >= 0 ? 'text-green-600' : 'text-red-500'
                }`}>
                  {ev.bypassesCash
                    ? `${ev.amountNative > 0 ? '+' : ''}${formatCurrency(Math.abs(ev.amountNative), ev.currency)} *`
                    : `${ev.amountEUR >= 0 ? '+' : ''}${formatCurrency(Math.abs(ev.amountNative), ev.currency)}`
                  }
                </span>
                {i === month.events.length - 1 ? (
                  <span className={`text-right font-medium tabular-nums ${
                    month.closingBalance < 0 ? 'text-red-500' :
                    month.closingBalance < bufferThreshold ? 'text-amber-500' : 'text-green-600'
                  }`}>
                    {formatCompact(month.closingBalance, 'EUR')}
                  </span>
                ) : <span />}
              </div>
            </TableRow>
          )
        })
      })}
    </Table>
  )
}

// ─── Funding gap alert ────────────────────────────────────────────────────────

function FundingGapAlert({ projection, bufferThreshold, cashAccounts }: {
  projection: ProjectedMonth[]
  bufferThreshold: number
  cashAccounts: Account[]
}) {
  const firstGapMonth = projection.find(p => p.closingBalance < bufferThreshold)
  if (!firstGapMonth) return null

  const shortage = bufferThreshold - firstGapMonth.closingBalance
  const isNeg = firstGapMonth.closingBalance < 0

  const sorted = [...cashAccounts]
    .filter(a => a.balance > 0)
    .sort((a, b) => (a.interestRate ?? 0) - (b.interestRate ?? 0))

  return (
    <Banner variant="warning" className="mt-3">
      <div className="space-y-1.5">
        <div className="font-medium">
          {isNeg
            ? `⚠ Cash goes negative in ${firstGapMonth.label} — top up before then.`
            : `⚠ Cash drops below 3-month buffer in ${firstGapMonth.label}.`}
          {' '}Need ~{formatCompact(Math.abs(shortage), 'EUR')} to restore buffer.
        </div>
        {sorted.length > 0 && (
          <div className="text-[11px] text-gray-600">
            <span className="font-medium">Consider drawing from: </span>
            {sorted.slice(0, 3).map((a, i) => (
              <span key={a.id}>
                {i > 0 && ' → '}
                {a.name} ({formatCompact(a.balance, a.currency)}{(a.interestRate ?? 0) > 0 ? `, ${a.interestRate}% APY` : ', 0%'})
              </span>
            ))}
            {sorted.length > 3 && ` + ${sorted.length - 3} more`}
          </div>
        )}
      </div>
    </Banner>
  )
}

// ─── Income & expense summary ─────────────────────────────────────────────────

function buildAnnualSummary(
  store: ReturnType<typeof useAppStore.getState>,
  year: number,
): { incomeByCategory: Record<string, number>; expenseByCategory: Record<string, number>; totalIncome: number; totalExpense: number } {
  const { expenses, medicalCoverages, medicalExpenses, pensions, windfalls, taxConfig, profile, accounts } = store
  const incomeByCategory: Record<string, number> = {}
  const expenseByCategory: Record<string, number> = {}

  function addIncome(cat: string, amtEUR: number) {
    incomeByCategory[cat] = (incomeByCategory[cat] ?? 0) + amtEUR
  }
  function addExpense(cat: string, amtEUR: number) {
    expenseByCategory[cat] = (expenseByCategory[cat] ?? 0) + amtEUR
  }

  // Pensions
  for (const p of pensions) {
    const personBY = p.person === 'self' ? profile.birthYear : profile.spouseBirthYear
    if (personBY + p.startAge <= year) {
      addIncome('Pension', toEUR(p.monthlyAmount * 12, p.currency))
    }
  }

  // Interest from cash accounts
  for (const acc of (accounts ?? [])) {
    if (!acc.interestRate || acc.interestRate <= 0 || acc.balance <= 0) continue
    addIncome('Interest', toEUR(acc.balance * acc.interestRate / 100, acc.currency))
  }

  // Dividends (projected)
  const annualDiv = projectedAnnualDividendsEUR(
    (accounts ?? []).filter(a => a.includedInPlanning !== false),
    DEFAULT_EUR_USD_RATE
  )
  if (annualDiv > 0) addIncome('Dividends', annualDiv)

  // Windfalls
  for (const w of windfalls) {
    if (parseInt(w.date.split('-')[0]) === year) {
      addIncome('Windfall', toEUR(w.amount, w.currency))
    }
  }

  // Expenses
  type ExpLike = { amount: number; currency: string; frequency: string; startDate: string; endDate: string | null; category: string }
  const allExp: ExpLike[] = [
    ...expenses,
    ...(medicalCoverages ?? []).map(c => ({ ...c, category: 'Medical coverage' })),
    ...(medicalExpenses ?? []).map(e => ({ ...e, category: e.category || 'Medical' })),
  ]
  for (const exp of allExp) {
    const startY = parseInt(exp.startDate.split('-')[0])
    const endY = exp.endDate ? parseInt(exp.endDate.split('-')[0]) : null
    if (endY !== null && endY < year) continue
    if (startY > year) continue
    let annualEUR = 0
    if (exp.frequency === 'monthly') annualEUR = toEUR(exp.amount * 12, exp.currency)
    else if (exp.frequency === 'yearly') annualEUR = toEUR(exp.amount, exp.currency)
    else if (exp.frequency === 'one_time' && startY === year) annualEUR = toEUR(exp.amount, exp.currency)
    if (annualEUR > 0) addExpense(exp.category || 'Other', annualEUR)
  }

  // Tax payments
  const Q_MONTH: Record<number, number> = { 1: 4, 2: 6, 3: 9, 4: 1 }
  for (const q of [...(taxConfig.quarterlyPayments ?? []), ...(taxConfig.stateQuarterlyPayments ?? [])]) {
    if (q.year !== year) continue
    const amount = q.amountPaid ?? q.estimatedDue
    if (!amount) continue
    const dueYear = q.quarter === 4 ? year + 1 : year
    if (dueYear !== year) continue
    void Q_MONTH  // used above for reference; keeping consistent
    addExpense('Tax', toEUR(amount, 'USD'))
  }

  const totalIncome = Object.values(incomeByCategory).reduce((s, v) => s + v, 0)
  const totalExpense = Object.values(expenseByCategory).reduce((s, v) => s + v, 0)
  return { incomeByCategory, expenseByCategory, totalIncome, totalExpense }
}

function AnnualSummaryCard() {
  const store = useAppStore()
  const currentYear = new Date().getFullYear()
  const [year, setYear] = useState(currentYear)
  const { incomeByCategory, expenseByCategory, totalIncome, totalExpense } = buildAnnualSummary(store, year)
  const net = totalIncome - totalExpense

  const yearOptions = [currentYear - 1, currentYear, currentYear + 1, currentYear + 2]

  return (
    <Card>
      <div className="flex items-center justify-between mb-3">
        <CardTitle>Annual income & expenses</CardTitle>
        <div className="flex gap-1">
          {yearOptions.map(y => (
            <button
              key={y}
              onClick={() => setYear(y)}
              className={`text-[10.5px] px-2 py-0.5 rounded-[4px] border transition-colors ${
                y === year
                  ? 'bg-gray-900 dark:bg-white text-white dark:text-gray-900 border-gray-900 dark:border-white font-medium'
                  : 'border-gray-300 dark:border-gray-600 text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800'
              }`}
            >{y}</button>
          ))}
        </div>
      </div>

      {/* Net summary bar */}
      <div className="flex items-center gap-5 pb-3 mb-3 border-b border-gray-100 dark:border-gray-800">
        <div>
          <div className="text-[10px] text-gray-400">Net {year}</div>
          <div className={`text-[18px] font-medium ${net >= 0 ? 'text-green-600' : 'text-red-500'}`}>
            {net >= 0 ? '+' : '−'}{formatCurrency(Math.abs(net), 'EUR')}
          </div>
        </div>
        <div className="w-px h-7 bg-gray-200 dark:bg-gray-700" />
        <div>
          <div className="text-[10px] text-gray-400">Income</div>
          <div className="text-[13px] font-medium text-green-600">+{formatCurrency(totalIncome, 'EUR')}</div>
        </div>
        <div className="w-px h-7 bg-gray-200 dark:bg-gray-700" />
        <div>
          <div className="text-[10px] text-gray-400">Expenses</div>
          <div className="text-[13px] font-medium text-red-500">−{formatCurrency(totalExpense, 'EUR')}</div>
        </div>
        <div className="flex-1" />
        <div className="text-[10px] text-gray-400 text-right">
          EUR equiv · USD at {DEFAULT_EUR_USD_RATE}
        </div>
      </div>

      {/* Category breakdown */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <div className="text-[11px] font-medium text-green-700 mb-1.5">Income</div>
          <div className="space-y-1">
            {Object.entries(incomeByCategory)
              .sort((a, b) => b[1] - a[1])
              .map(([cat, amt]) => (
                <div key={cat} className="flex justify-between items-baseline text-[12px]">
                  <span className="text-gray-600 dark:text-gray-400">{cat}</span>
                  <span className="text-green-600 font-medium tabular-nums">+{formatCurrency(amt, 'EUR')}</span>
                </div>
              ))
            }
            {Object.keys(incomeByCategory).length === 0 && (
              <div className="text-[11px] text-gray-400 italic">No income configured</div>
            )}
          </div>
        </div>
        <div>
          <div className="text-[11px] font-medium text-red-600 mb-1.5">Expenses</div>
          <div className="space-y-1">
            {Object.entries(expenseByCategory)
              .sort((a, b) => b[1] - a[1])
              .map(([cat, amt]) => (
                <div key={cat} className="flex justify-between items-baseline text-[12px]">
                  <span className="text-gray-600 dark:text-gray-400">{cat}</span>
                  <span className="text-red-500 font-medium tabular-nums">−{formatCurrency(amt, 'EUR')}</span>
                </div>
              ))
            }
            {Object.keys(expenseByCategory).length === 0 && (
              <div className="text-[11px] text-gray-400 italic">No expenses configured</div>
            )}
          </div>
        </div>
      </div>
    </Card>
  )
}

// ─── Per-currency column ──────────────────────────────────────────────────────

function AccountTable({ accounts }: { accounts: Account[] }) {
  return (
    <Table>
      <TableHead>
        <div className="grid grid-cols-[2fr_1fr_0.8fr] gap-2">
          <span>Account</span><span>Balance</span><span>APY</span>
        </div>
      </TableHead>
      {accounts.length > 0 ? accounts.map(acc => {
        const rate = acc.interestRate ?? 0
        const rateColor = rate >= 3 ? 'text-green-600' : rate >= 1 ? 'text-amber-500' : 'text-gray-400'
        return (
          <TableRow key={acc.id}>
            <div className="grid grid-cols-[2fr_1fr_0.8fr] gap-2 items-center">
              <span className="font-medium truncate">{acc.name}</span>
              <span className={`font-medium ${acc.balance >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                {acc.balance >= 0 ? '+' : ''}{formatCurrency(acc.balance, acc.currency)}
              </span>
              <span className={`text-[12px] font-medium ${rateColor}`}>
                {rate > 0 ? `${rate}%` : '—'}
              </span>
            </div>
          </TableRow>
        )
      }) : (
        <TableRow><div className="text-gray-400 text-[12px]">No accounts</div></TableRow>
      )}
    </Table>
  )
}

function CurrencyColumn({ currency, accounts, total, monthlyNetDrain }: {
  currency: 'USD' | 'EUR'
  accounts: Account[]
  total: number
  monthlyNetDrain: number
}) {
  const runway = monthlyNetDrain > 0 ? total / monthlyNetDrain : Infinity
  const zeroYield = accounts.filter(a => (a.interestRate ?? 0) === 0)
  const zeroYieldAmount = zeroYield.reduce((s, a) => s + a.balance, 0)
  const hasZeroYieldWarning = currency === 'EUR' && total > 0 && zeroYieldAmount / total > 0.3

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-[13px]">{currency === 'USD' ? '🇺🇸' : '🇪🇺'}</span>
        <h3 className="text-[13px] font-medium">{currency}</h3>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <MetricCard
          label={`Total (${currency})`}
          value={formatCompact(total, currency)}
          sub={`${accounts.length} account${accounts.length !== 1 ? 's' : ''}`}
        />
        <MetricCard
          label="Runway"
          value={monthlyNetDrain > 0 ? `~${Math.round(runway)} mo` : '—'}
          sub={monthlyNetDrain > 0 ? `net drain ${formatCurrency(monthlyNetDrain, 'EUR')}/mo` : 'No net outflow'}
        />
      </div>
      {hasZeroYieldWarning && (
        <Banner variant="warning">
          ⚠ {formatCurrency(zeroYieldAmount, 'EUR')} ({Math.round(zeroYieldAmount / total * 100)}% of EUR cash)
          earning 0% — consider a livret or high-yield account.
        </Banner>
      )}
      <AccountTable accounts={accounts} />
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function CashFlow() {
  const {
    accounts, expenses, medicalCoverages, medicalExpenses,
    pensions, profile, realEstateEvents, windfalls, taxConfig, transfers,
  } = useAppStore()

  const cashAccounts = accounts.filter(a => a.type === 'cash' && a.includedInPlanning !== false)
  const usdAccounts = cashAccounts.filter(a => a.currency.toUpperCase() === 'USD')
  const eurAccounts = cashAccounts.filter(a => a.currency.toUpperCase() === 'EUR')

  const usdCash = usdAccounts.reduce((s, a) => s + a.balance, 0)
  const eurCash = eurAccounts.reduce((s, a) => s + a.balance, 0)
  const totalEUR = eurCash + usdCash / DEFAULT_EUR_USD_RATE

  const monthlyBurnEUR = computeMonthlyBurn(expenses, medicalCoverages, medicalExpenses)
  const monthlyIncomeEUR = computeMonthlyIncome(pensions, profile)
  const monthlyNetDrainEUR = Math.max(0, monthlyBurnEUR - monthlyIncomeEUR)
  const monthlyNetDrainUSD = monthlyNetDrainEUR * DEFAULT_EUR_USD_RATE
  const totalRunway = monthlyNetDrainEUR > 0 ? totalEUR / monthlyNetDrainEUR : Infinity

  const runoutDate = monthlyNetDrainEUR > 0
    ? (() => {
        const d = new Date()
        d.setMonth(d.getMonth() + Math.round(totalEUR / monthlyNetDrainEUR))
        return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
      })()
    : null

  const projection = buildCashProjection({
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
    months: 12,
  })

  const burn = avgMonthlyBurn(projection)
  const bufferThreshold = burn * 3

  return (
    <div>
      <PageHeader title="Cash flow" />
      <div className="p-4 space-y-5">

        {/* Summary metrics */}
        <Card>
          <CardTitle>Liquidity overview</CardTitle>
          <div className="grid grid-cols-3 gap-3">
            <MetricCard
              label="Total cash (EUR equiv.)"
              value={formatCompact(totalEUR, 'EUR')}
              sub={`${formatCompact(usdCash, 'USD')} · ${formatCompact(eurCash, 'EUR')} · ${cashAccounts.length} accounts`}
              tooltip="Sum of all cash account balances converted to EUR at the default exchange rate."
            />
            <MetricCard
              label="Net monthly outflow"
              value={monthlyNetDrainEUR > 0 ? `−${formatCurrency(monthlyNetDrainEUR, 'EUR')}/mo` : monthlyBurnEUR > 0 ? 'Covered' : '—'}
              sub={monthlyBurnEUR > 0
                ? `${formatCurrency(monthlyBurnEUR, 'EUR')}/mo burn − ${formatCurrency(monthlyIncomeEUR, 'EUR')}/mo income`
                : 'No expenses configured'}
              tooltip="Monthly burn (all active recurring expenses) minus monthly income (pensions already started). Positive means cash is being depleted."
            />
            <MetricCard
              label="Cash runway"
              value={monthlyNetDrainEUR > 0 ? `~${Math.round(totalRunway)} months` : '—'}
              sub={runoutDate ? `Runs out ~${runoutDate}` : monthlyNetDrainEUR === 0 && monthlyBurnEUR > 0 ? 'Income covers burn' : 'Configure expenses'}
              valueClass={totalRunway < 12 ? 'text-red-500' : totalRunway < 24 ? 'text-amber-500' : undefined}
              tooltip="How many months total cash can cover the net monthly outflow, assuming no one-time events. Amber = under 24 months, red = under 12."
            />
          </div>
          {monthlyNetDrainEUR > 0 && totalRunway < 18 && (
            <Banner variant="warning" className="mt-3">
              ⚠ Less than 18 months of cash runway — consider funding your accounts or reducing expenses.
            </Banner>
          )}
        </Card>

        {/* 12-month projection chart */}
        <Card>
          <CardTitle>12-month cash projection</CardTitle>
          <p className="text-[11px] text-gray-400 mb-3">
            Month-by-month balance including all known events. Dashed amber = 3-month buffer. Dashed purple lines = months with one-time events.
            Starred amounts (*) in the table bypass cash and go directly to another account.
          </p>
          {projection.length > 0
            ? <CashFlowChart projection={projection} bufferThreshold={bufferThreshold} />
            : <p className="text-[12px] text-gray-400 py-4 text-center">Configure expenses to see projection.</p>
          }
          <FundingGapAlert projection={projection} bufferThreshold={bufferThreshold} cashAccounts={cashAccounts} />
        </Card>

        {/* Upcoming events */}
        <Card>
          <CardTitle>Upcoming cash events</CardTitle>
          <p className="text-[11px] text-gray-400 mb-3">
            One-time events in the next 12 months. Windfalls without a specific month appear in June of their year.
            Use the Income, Real Estate and Expenses config pages to assign source/target accounts.
          </p>
          <UpcomingEventsTable projection={projection} bufferThreshold={bufferThreshold} />
        </Card>

        {/* Annual income & expense summary */}
        <AnnualSummaryCard />

        {/* Per-currency breakdown */}
        <div className="grid grid-cols-2 gap-5">
          <CurrencyColumn currency="USD" accounts={usdAccounts} total={usdCash} monthlyNetDrain={monthlyNetDrainUSD} />
          <CurrencyColumn currency="EUR" accounts={eurAccounts} total={eurCash} monthlyNetDrain={monthlyNetDrainEUR} />
        </div>

      </div>
    </div>
  )
}
