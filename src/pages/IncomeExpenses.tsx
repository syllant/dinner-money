import { useState } from 'react'
import { useAppStore } from '../store/useAppStore'
import { PageHeader } from '../components/ui/PageHeader'
import { Badge } from '../components/ui/Badge'
import { FlowRow, recurrenceNote, monthLabel } from '../components/ui/FlowRow'
import { formatCurrency } from '../lib/format'
import { DEFAULT_EUR_USD_RATE } from '../lib/currency'

// ─── Types ────────────────────────────────────────────────────────────────────

interface LineItem {
  key: string
  date: string
  monthLabel: string
  description: string
  note: string
  category: string
  amount: number
  currency: string
  amountEUR: number
  kind: 'income' | 'expense'
  recurring: boolean
  tag?: 'tax' | 'windfall' | 'projected' | 'received'
}

function toEUR(amount: number, currency: string): number {
  return currency.toUpperCase() === 'USD' ? amount / DEFAULT_EUR_USD_RATE : amount
}

// ─── Item builders ────────────────────────────────────────────────────────────

function buildItems(
  store: ReturnType<typeof useAppStore.getState>,
  year: number,
): LineItem[] {
  const { expenses, medicalCoverages, medicalExpenses, pensions, windfalls, taxConfig, profile } = store
  const items: LineItem[] = []
  const now = new Date()
  const currentYear = now.getFullYear()
  const currentMonth = now.getMonth() + 1

  const isCurrentYear = year === currentYear

  type ExpLike = { id: string; name: string; amount: number; frequency: string; currency: string; startDate: string; endDate: string | null; category: string }
  const allExpenses: ExpLike[] = [
    ...expenses,
    ...(medicalCoverages ?? []).map(c => ({ ...c, category: 'Medical coverage' })),
    ...(medicalExpenses ?? []).map(e => ({ ...e, category: e.category || 'Medical' })),
  ]

  // ── Pensions (income) ──────────────────────────────────────────────────────
  for (const p of pensions) {
    const personBY = p.person === 'self' ? profile.birthYear : profile.spouseBirthYear
    const startYear = personBY + p.startAge
    if (startYear > year) continue

    for (let m = 1; m <= 12; m++) {
      if (startYear === year && m < 1) continue
      const ym = `${year}-${String(m).padStart(2, '0')}`
      const future = isCurrentYear && m > currentMonth
      const personLabel = p.person === 'self' ? 'You' : 'Spouse'
      items.push({
        key: `pension-${p.id}-${ym}`,
        date: ym,
        monthLabel: monthLabel(ym),
        description: `${p.label} (${personLabel})`,
        note: 'monthly pension',
        category: 'Pension',
        amount: p.monthlyAmount,
        currency: p.currency,
        amountEUR: toEUR(p.monthlyAmount, p.currency),
        kind: 'income',
        recurring: true,
        tag: future ? 'projected' : 'received',
      })
    }
  }

  // ── Expenses ──────────────────────────────────────────────────────────────
  for (const exp of allExpenses) {
    const startY = parseInt(exp.startDate.split('-')[0])
    const startM = parseInt(exp.startDate.split('-')[1] ?? '1')
    const endY = exp.endDate ? parseInt(exp.endDate.split('-')[0]) : null
    const endM = exp.endDate ? parseInt(exp.endDate.split('-')[1] ?? '12') : null

    if (endY !== null && endY < year) continue
    if (startY > year) continue

    const note = recurrenceNote(exp.frequency, exp.startDate, exp.endDate)

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
          note,
          category: exp.category,
          amount: exp.amount,
          currency: exp.currency,
          amountEUR: toEUR(exp.amount, exp.currency),
          kind: 'expense',
          recurring: true,
        })
      }
    } else if (exp.frequency === 'yearly') {
      const ym = `${year}-01`
      items.push({
        key: `exp-${exp.id}-${year}`,
        date: ym,
        monthLabel: `${year} (annual)`,
        description: exp.name,
        note,
        category: exp.category,
        amount: exp.amount,
        currency: exp.currency,
        amountEUR: toEUR(exp.amount, exp.currency),
        kind: 'expense',
        recurring: true,
      })
    } else if (exp.frequency === 'one_time' && startY === year) {
      const ym = exp.startDate
      items.push({
        key: `exp-${exp.id}-${year}`,
        date: ym,
        monthLabel: monthLabel(ym),
        description: exp.name,
        note: '',
        category: exp.category,
        amount: exp.amount,
        currency: exp.currency,
        amountEUR: toEUR(exp.amount, exp.currency),
        kind: 'expense',
        recurring: false,
      })
    }
  }

  // ── Windfalls (income) ─────────────────────────────────────────────────────
  for (const w of windfalls) {
    const wYear = parseInt(w.date.split('-')[0])
    if (wYear !== year) continue
    items.push({
      key: `windfall-${w.id}`,
      date: `${year}-01`,
      monthLabel: `${year}`,
      description: w.name,
      note: '',
      category: 'Windfall',
      amount: w.amount,
      currency: w.currency,
      amountEUR: toEUR(w.amount, w.currency),
      kind: 'income',
      recurring: false,
      tag: 'windfall',
    })
  }

  // ── Federal quarterly tax payments ─────────────────────────────────────────
  const Q_MONTH: Record<number, number> = { 1: 4, 2: 6, 3: 9, 4: 1 }
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
      note: '',
      category: 'Tax',
      amount,
      currency: 'USD',
      amountEUR: toEUR(amount, 'USD'),
      kind: 'expense',
      recurring: false,
      tag: 'tax',
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
      note: '',
      category: 'Tax',
      amount,
      currency: 'USD',
      amountEUR: toEUR(amount, 'USD'),
      kind: 'expense',
      recurring: false,
      tag: 'tax',
    })
  }

  return items.sort((a, b) => a.date.localeCompare(b.date))
}

// ─── Tag badge ────────────────────────────────────────────────────────────────

function TagBadge({ type }: { type: LineItem['tag'] }) {
  switch (type) {
    case 'received':  return <Badge variant="success">Received</Badge>
    case 'projected': return <Badge variant="purple">Projected</Badge>
    case 'tax':       return <Badge variant="neutral">Tax</Badge>
    case 'windfall':  return <Badge variant="purple">Windfall</Badge>
    default:          return null
  }
}

// ─── Column ───────────────────────────────────────────────────────────────────

function ItemColumn({
  title, items, totalEUR, sign, colorClass,
}: {
  title: string; items: LineItem[]; totalEUR: number; sign: '+' | '−'; colorClass: string
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
        <div className="px-3">
          {items.map(item => (
            <FlowRow
              key={item.key}
              dateLabel={item.monthLabel}
              description={item.description}
              note={item.note}
              recurring={item.recurring}
              amount={item.amount}
              currency={item.currency}
              colorClass={colorClass}
              sign={sign}
              tag={item.tag ? <TagBadge type={item.tag} /> : undefined}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function IncomeExpenses() {
  const store = useAppStore()
  const currentYear = new Date().getFullYear()
  const [year, setYear] = useState(currentYear)

  const { expenses, medicalCoverages, medicalExpenses, pensions, windfalls, taxConfig, profile } = store
  const reactiveItems = buildItems({ expenses, medicalCoverages, medicalExpenses, pensions, windfalls, taxConfig, profile } as ReturnType<typeof useAppStore.getState>, year)

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
          <ItemColumn title="Income" items={incomeItems} totalEUR={totalIncomeEUR} sign="+" colorClass="text-green-600" />
          <ItemColumn title="Expenses" items={expenseItems} totalEUR={totalExpenseEUR} sign="−" colorClass="text-red-500" />
        </div>
      </div>
    </div>
  )
}
