import { useState } from 'react'
import { useAppStore } from '../store/useAppStore'
import { PageHeader } from '../components/ui/PageHeader'
import { Badge } from '../components/ui/Badge'
import { formatCurrency } from '../lib/format'
import { DEFAULT_EUR_USD_RATE } from '../lib/currency'

// ─── Types ────────────────────────────────────────────────────────────────────

interface LineItem {
  key: string
  date: string        // YYYY-MM for sorting
  monthLabel: string  // "Jan 2026"
  description: string
  category: string
  amount: number      // in original currency
  currency: string
  amountEUR: number   // converted to EUR for totals
  kind: 'income' | 'expense'
  badge?: 'received' | 'projected' | 'recurring' | 'one_time' | 'tax' | 'windfall'
}

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function toEUR(amount: number, currency: string): number {
  return currency.toUpperCase() === 'USD' ? amount / DEFAULT_EUR_USD_RATE : amount
}

function monthLabel(ym: string): string {
  const [y, m] = ym.split('-')
  return `${MONTH_NAMES[parseInt(m) - 1]} ${y}`
}

function BadgeEl({ type }: { type: LineItem['badge'] }) {
  switch (type) {
    case 'received':  return <Badge variant="success">Received</Badge>
    case 'projected': return <Badge variant="purple">Projected</Badge>
    case 'recurring': return <Badge variant="warning">Recurring</Badge>
    case 'one_time':  return <Badge variant="warning">One-time</Badge>
    case 'tax':       return <Badge variant="neutral">Tax</Badge>
    case 'windfall':  return <Badge variant="purple">Windfall</Badge>
    default:          return null
  }
}

// ─── Item builders ────────────────────────────────────────────────────────────

function buildItems(
  store: ReturnType<typeof useAppStore.getState>,
  year: number,
): LineItem[] {
  const { expenses, pensions, windfalls, taxConfig, profile } = store
  const items: LineItem[] = []
  const now = new Date()
  const currentYear = now.getFullYear()
  const currentMonth = now.getMonth() + 1 // 1–12

  const isCurrentYear = year === currentYear

  // ── Pensions (income) ──────────────────────────────────────────────────────
  for (const p of pensions) {
    const personBY = p.person === 'self' ? profile.birthYear : profile.spouseBirthYear
    const startYear = personBY + p.startAge
    if (startYear > year) continue // not active yet this year

    for (let m = 1; m <= 12; m++) {
      // Skip months before pension start
      if (startYear === year) {
        const startMonth = 1 // assume Jan if same year — pension startAge is year-level
        if (m < startMonth) continue
      }
      const ym = `${year}-${String(m).padStart(2, '0')}`
      const future = isCurrentYear && m > currentMonth
      items.push({
        key: `pension-${p.id}-${ym}`,
        date: ym,
        monthLabel: monthLabel(ym),
        description: `${p.label} (${p.person})`,
        category: 'Pension',
        amount: p.monthlyAmount,
        currency: p.currency,
        amountEUR: toEUR(p.monthlyAmount, p.currency),
        kind: 'income',
        badge: future ? 'projected' : 'received',
      })
    }
  }

  // ── Expenses ───────────────────────────────────────────────────────────────
  for (const exp of expenses) {
    const startY = parseInt(exp.startDate.split('-')[0])
    const startM = parseInt(exp.startDate.split('-')[1] ?? '1')
    const endY = exp.endDate ? parseInt(exp.endDate.split('-')[0]) : null
    const endM = exp.endDate ? parseInt(exp.endDate.split('-')[1] ?? '12') : null

    // Skip if completely outside year
    if (endY !== null && endY < year) continue
    if (startY > year) continue

    if (exp.frequency === 'monthly') {
      for (let m = 1; m <= 12; m++) {
        if (startY === year && m < startM) continue
        if (endY === year && m > (endM ?? 12)) continue
        const ym = `${year}-${String(m).padStart(2, '0')}`
        items.push({
          key: `exp-${exp.id}-${ym}`,
          date: ym,
          monthLabel: monthLabel(ym),
          description: exp.name,
          category: exp.category,
          amount: exp.amount,
          currency: exp.currency,
          amountEUR: toEUR(exp.amount, exp.currency),
          kind: 'expense',
          badge: 'recurring',
        })
      }
    } else if (exp.frequency === 'yearly') {
      const ym = `${year}-01`
      items.push({
        key: `exp-${exp.id}-${year}`,
        date: ym,
        monthLabel: `${year} (annual)`,
        description: exp.name,
        category: exp.category,
        amount: exp.amount,
        currency: exp.currency,
        amountEUR: toEUR(exp.amount, exp.currency),
        kind: 'expense',
        badge: 'recurring',
      })
    } else if (exp.frequency === 'one_time' && startY === year) {
      const ym = exp.startDate
      items.push({
        key: `exp-${exp.id}-${year}`,
        date: ym,
        monthLabel: monthLabel(ym),
        description: exp.name,
        category: exp.category,
        amount: exp.amount,
        currency: exp.currency,
        amountEUR: toEUR(exp.amount, exp.currency),
        kind: 'expense',
        badge: 'one_time',
      })
    }
  }

  // ── Windfalls (income) ─────────────────────────────────────────────────────
  for (const w of windfalls) {
    if (parseInt(w.date) !== year) continue
    items.push({
      key: `windfall-${w.id}`,
      date: `${year}-01`,
      monthLabel: `${year}`,
      description: w.name,
      category: 'Windfall',
      amount: w.amount,
      currency: w.currency,
      amountEUR: toEUR(w.amount, w.currency),
      kind: 'income',
      badge: 'windfall',
    })
  }

  // ── Federal quarterly tax payments (expense) ───────────────────────────────
  const Q_MONTH: Record<number, number> = { 1: 4, 2: 6, 3: 9, 4: 1 } // Q1=Apr, Q2=Jun, Q3=Sep, Q4=Jan(next)
  for (const q of taxConfig.quarterlyPayments.filter(p => p.year === year)) {
    const m = Q_MONTH[q.quarter]
    const qYear = q.quarter === 4 ? year + 1 : year
    const ym = `${qYear}-${String(m).padStart(2, '0')}`
    const amount = q.amountPaid ?? q.estimatedDue
    if (!amount) continue
    items.push({
      key: `fed-tax-${year}-${q.quarter}`,
      date: ym,
      monthLabel: monthLabel(ym),
      description: `IRS Q${q.quarter} ${year} — Federal`,
      category: 'Tax',
      amount,
      currency: 'USD',
      amountEUR: toEUR(amount, 'USD'),
      kind: 'expense',
      badge: 'tax',
    })
  }
  for (const q of (taxConfig.stateQuarterlyPayments ?? []).filter(p => p.year === year)) {
    const m = Q_MONTH[q.quarter]
    const qYear = q.quarter === 4 ? year + 1 : year
    const ym = `${qYear}-${String(m).padStart(2, '0')}`
    const amount = q.amountPaid ?? q.estimatedDue
    if (!amount) continue
    items.push({
      key: `ca-tax-${year}-${q.quarter}`,
      date: ym,
      monthLabel: monthLabel(ym),
      description: `FTB Q${q.quarter} ${year} — California`,
      category: 'Tax',
      amount,
      currency: 'USD',
      amountEUR: toEUR(amount, 'USD'),
      kind: 'expense',
      badge: 'tax',
    })
  }

  return items.sort((a, b) => a.date.localeCompare(b.date))
}

// ─── Column ───────────────────────────────────────────────────────────────────

function ItemColumn({
  title,
  items,
  totalEUR,
  sign,
  colorClass,
}: {
  title: string
  items: LineItem[]
  totalEUR: number
  sign: '+' | '−'
  colorClass: string
}) {
  return (
    <div>
      <div className="flex justify-between items-center pb-[7px] border-b border-gray-200 dark:border-gray-700 mb-2">
        <span className="text-[12.5px] font-medium">{title}</span>
        <span className={`text-[12px] font-medium ${colorClass}`}>
          {sign}{formatCurrency(totalEUR, 'EUR')}
        </span>
      </div>
      <div className="border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
        {items.length === 0 && (
          <div className="px-3 py-4 text-[12px] text-gray-400">Nothing configured for this year.</div>
        )}
        {items.map(item => (
          <div
            key={item.key}
            className="px-3 py-[6px] border-b border-gray-100 dark:border-gray-700 last:border-0"
          >
            <div className="flex justify-between items-baseline gap-2">
              <span className="text-[12px] text-gray-900 dark:text-white truncate">{item.description}</span>
              <span className={`text-[12px] font-medium shrink-0 ${colorClass}`}>
                {sign}{formatCurrency(item.amount, item.currency)}
              </span>
            </div>
            <div className="flex items-center gap-2 mt-[1px]">
              <span className="text-[10px] text-gray-400">{item.monthLabel}</span>
              <BadgeEl type={item.badge} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function IncomeExpenses() {
  const store = useAppStore()
  const currentYear = new Date().getFullYear()
  const [year, setYear] = useState(currentYear)

  const allItems = buildItems(useAppStore.getState(), year)
  // Re-build on every render (store is reactive via useAppStore())
  const { expenses, pensions, windfalls, taxConfig, profile } = store
  void expenses; void pensions; void windfalls; void taxConfig; void profile // track reactivity

  const reactiveItems = buildItems({ expenses, pensions, windfalls, taxConfig, profile } as ReturnType<typeof useAppStore.getState>, year)

  const incomeItems = reactiveItems.filter(i => i.kind === 'income')
  const expenseItems = reactiveItems.filter(i => i.kind === 'expense')

  const totalIncomeEUR = incomeItems.reduce((s, i) => s + i.amountEUR, 0)
  const totalExpenseEUR = expenseItems.reduce((s, i) => s + i.amountEUR, 0)
  const netEUR = totalIncomeEUR - totalExpenseEUR

  const yearOptions = [currentYear - 1, currentYear, currentYear + 1, currentYear + 2]

  return (
    <div>
      <PageHeader title="Income & expenses">
        <div className="flex items-center gap-2">
          {yearOptions.map(y => (
            <button
              key={y}
              onClick={() => setYear(y)}
              className={`text-[11.5px] px-3 py-1 rounded-[5px] border transition-colors ${
                y === year
                  ? 'bg-gray-900 dark:bg-white text-white dark:text-gray-900 border-gray-900 dark:border-white font-medium'
                  : 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800'
              }`}
            >
              {y}
            </button>
          ))}
        </div>
      </PageHeader>

      <div className="p-4 space-y-4">

        {/* Net summary */}
        <div className="border border-gray-200 dark:border-gray-700 rounded-xl px-4 py-3 flex items-center gap-6">
          <div>
            <div className="text-[10.5px] text-gray-500 mb-0.5">Net {year}</div>
            <div className={`text-[20px] font-medium ${netEUR >= 0 ? 'text-green-600' : 'text-red-500'}`}>
              {netEUR >= 0 ? '+' : '−'}{formatCurrency(Math.abs(netEUR), 'EUR')}
            </div>
          </div>
          <div className="w-px h-8 bg-gray-200 dark:bg-gray-700" />
          <div>
            <div className="text-[10.5px] text-gray-500 mb-0.5">Income</div>
            <div className="text-[14px] font-medium text-green-600">+{formatCurrency(totalIncomeEUR, 'EUR')}</div>
          </div>
          <div className="w-px h-8 bg-gray-200 dark:bg-gray-700" />
          <div>
            <div className="text-[10.5px] text-gray-500 mb-0.5">Expenses</div>
            <div className="text-[14px] font-medium text-red-500">−{formatCurrency(totalExpenseEUR, 'EUR')}</div>
          </div>
          <div className="flex-1" />
          <div className="text-[10.5px] text-gray-400">
            All amounts in EUR. USD converted at {DEFAULT_EUR_USD_RATE}.
          </div>
        </div>

        {/* Two columns */}
        <div className="grid grid-cols-2 gap-4">
          <ItemColumn
            title="Income"
            items={incomeItems}
            totalEUR={totalIncomeEUR}
            sign="+"
            colorClass="text-green-600"
          />
          <ItemColumn
            title="Expenses"
            items={expenseItems}
            totalEUR={totalExpenseEUR}
            sign="−"
            colorClass="text-red-500"
          />
        </div>
      </div>
    </div>
  )
}
