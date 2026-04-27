import { useState } from 'react'
import { useAppStore } from '../store/useAppStore'
import { PageHeader } from '../components/ui/PageHeader'
import { Badge } from '../components/ui/Badge'
import { FlowRow, recurrenceNote, monthLabel } from '../components/ui/FlowRow'
import { formatCurrency } from '../lib/format'
import { DEFAULT_EUR_USD_RATE } from '../lib/currency'
import { projectedAnnualDividendsEUR, DIVIDEND_MONTHS } from '../lib/dividends'

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
  isPast: boolean
  tag?: 'tax' | 'windfall'
}

function toEUR(amount: number, currency: string): number {
  return currency.toUpperCase() === 'USD' ? amount / DEFAULT_EUR_USD_RATE : amount
}

// ─── Item builders ────────────────────────────────────────────────────────────

function buildItems(
  store: ReturnType<typeof useAppStore.getState>,
  year: number,
): LineItem[] {
  const { expenses, medicalCoverages, medicalExpenses, pensions, windfalls, taxConfig, profile, accounts } = store
  const items: LineItem[] = []
  const now = new Date()
  const currentYear = now.getFullYear()
  const currentMonth = now.getMonth() + 1
  const currentYM = `${currentYear}-${String(currentMonth).padStart(2, '0')}`

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
        isPast: ym < currentYM,
      })
    }
  }

  // ── Interest income ────────────────────────────────────────────────────────
  for (const acc of (accounts ?? [])) {
    if (!acc.interestRate || acc.interestRate <= 0 || acc.balance <= 0) continue
    const monthly = acc.balance * acc.interestRate / 100 / 12
    for (let m = 1; m <= 12; m++) {
      const ym = `${year}-${String(m).padStart(2, '0')}`
      items.push({
        key: `interest-${acc.id}-${ym}`,
        date: ym,
        monthLabel: monthLabel(ym),
        description: `${acc.name} interest`,
        note: `${acc.interestRate}% APY`,
        category: 'Interest',
        amount: monthly,
        currency: acc.currency,
        amountEUR: toEUR(monthly, acc.currency),
        kind: 'income',
        recurring: true,
        isPast: ym < currentYM,
      })
    }
  }

  // ── Dividend income (from Plaid) ───────────────────────────────────────────
  for (const acc of (accounts ?? [])) {
    if (!acc.dividends) continue
    for (const div of acc.dividends) {
      const dYear = parseInt(div.date.split('-')[0])
      if (dYear !== year) continue
      const ym = div.date.slice(0, 7)
      items.push({
        key: `div-${acc.id}-${div.date}-${div.securityName}`,
        date: ym,
        monthLabel: monthLabel(ym),
        description: `${div.securityName} dividend`,
        note: acc.name,
        category: 'Dividends',
        amount: div.amount,
        currency: div.currency,
        amountEUR: toEUR(div.amount, div.currency),
        kind: 'income',
        recurring: false,
        isPast: ym < currentYM,
      })
    }
  }

  // ── Projected quarterly dividend income (Q1=Mar, Q2=Jun, Q3=Sep, Q4=Dec) ──
  if (year >= currentYear) {
    const quarterlyDiv = projectedAnnualDividendsEUR(accounts ?? [], DEFAULT_EUR_USD_RATE) / 4
    if (quarterlyDiv > 0) {
      for (let m = 1; m <= 12; m++) {
        if (!DIVIDEND_MONTHS.has(m)) continue
        const ym = `${year}-${String(m).padStart(2, '0')}`
        if (ym < currentYM) continue
        items.push({
          key: `div-proj-${ym}`,
          date: ym,
          monthLabel: monthLabel(ym),
          description: 'Dividends (est.)',
          note: 'quarterly projection',
          category: 'Dividends',
          amount: quarterlyDiv,
          currency: 'EUR',
          amountEUR: quarterlyDiv,
          kind: 'income',
          recurring: false,
          isPast: false,
        })
      }
    }
  }

  // ── Windfalls (income) ─────────────────────────────────────────────────────
  for (const w of windfalls) {
    const wYear = parseInt(w.date.split('-')[0])
    if (wYear !== year) continue
    const ym = `${year}-01`
    items.push({
      key: `windfall-${w.id}`,
      date: ym,
      monthLabel: `${year}`,
      description: w.name,
      note: '',
      category: 'Windfall',
      amount: w.amount,
      currency: w.currency,
      amountEUR: toEUR(w.amount, w.currency),
      kind: 'income',
      recurring: false,
      isPast: ym < currentYM,
      tag: 'windfall',
    })
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
          isPast: ym < currentYM,
        })
      }
    } else if (exp.frequency === 'yearly') {
      const ym = `${year}-${String(startM).padStart(2, '0')}`
      items.push({
        key: `exp-${exp.id}-${year}`,
        date: ym,
        monthLabel: isCurrentYear ? `${year} (annual)` : String(year),
        description: exp.name,
        note,
        category: exp.category,
        amount: exp.amount,
        currency: exp.currency,
        amountEUR: toEUR(exp.amount, exp.currency),
        kind: 'expense',
        recurring: true,
        isPast: ym < currentYM,
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
        isPast: ym < currentYM,
      })
    }
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
      isPast: ym < currentYM,
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
      isPast: ym < currentYM,
      tag: 'tax',
    })
  }

  return items.sort((a, b) => a.date.localeCompare(b.date))
}

// ─── Tag badge ────────────────────────────────────────────────────────────────

function TagBadge({ type }: { type: LineItem['tag'] }) {
  switch (type) {
    case 'tax':       return <Badge variant="neutral">Tax</Badge>
    case 'windfall':  return <Badge variant="purple">Windfall</Badge>
    default:          return null
  }
}

// ─── Column ───────────────────────────────────────────────────────────────────

function ItemColumn({
  title, items, totalEUR, sign, colorClass, minEUR,
}: {
  title: string; items: LineItem[]; totalEUR: number; sign: '+' | '−'; colorClass: string; minEUR: number
}) {
  const visible = items.filter(i => i.amountEUR >= minEUR)

  const byCategory = visible.reduce<Record<string, number>>((acc, i) => {
    acc[i.category] = (acc[i.category] ?? 0) + i.amountEUR
    return acc
  }, {})
  const categories = Object.entries(byCategory).sort((a, b) => b[1] - a[1])

  return (
    <div>
      <div className="flex justify-between items-center pb-[7px] border-b border-gray-200 dark:border-gray-700 mb-2">
        <span className="text-[12.5px] font-medium">{title}</span>
        <span className={`text-[12px] font-medium ${colorClass}`}>
          {sign}{formatCurrency(totalEUR, 'EUR')}
        </span>
      </div>

      {/* Category breakdown */}
      {categories.length > 1 && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 mb-3 pb-2 border-b border-gray-100 dark:border-gray-800">
          {categories.map(([cat, amt]) => (
            <div key={cat} className="flex items-baseline gap-1.5 text-[11px]">
              <span className="text-gray-500 dark:text-gray-400">{cat}</span>
              <span className={`font-medium ${colorClass}`}>{sign}{formatCurrency(amt, 'EUR')}</span>
            </div>
          ))}
        </div>
      )}

      <div className="border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
        {visible.length === 0 && (
          <div className="px-3 py-4 text-[12px] text-gray-400">Nothing configured for this year.</div>
        )}
        <div className="px-3">
          {visible.map(item => (
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
              dimmed={item.isPast}
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

  const { expenses, medicalCoverages, medicalExpenses, pensions, windfalls, taxConfig, profile, accounts, minTransactionEUR } = store
  const reactiveItems = buildItems({ expenses, medicalCoverages, medicalExpenses, pensions, windfalls, taxConfig, profile, accounts } as ReturnType<typeof useAppStore.getState>, year)

  const incomeItems = reactiveItems.filter(i => i.kind === 'income')
  const expenseItems = reactiveItems.filter(i => i.kind === 'expense')

  const totalIncomeEUR = incomeItems.filter(i => i.amountEUR >= minTransactionEUR).reduce((s, i) => s + i.amountEUR, 0)
  const totalExpenseEUR = expenseItems.filter(i => i.amountEUR >= minTransactionEUR).reduce((s, i) => s + i.amountEUR, 0)
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
          <div className="text-[10.5px] text-gray-400 text-right">
            <div>All amounts in EUR · USD at {DEFAULT_EUR_USD_RATE}</div>
            <div className="mt-0.5">Hiding items below {formatCurrency(minTransactionEUR, 'EUR')}</div>
          </div>
        </div>

        {/* Two columns */}
        <div className="grid grid-cols-2 gap-4">
          <ItemColumn title="Income" items={incomeItems} totalEUR={totalIncomeEUR} sign="+" colorClass="text-green-600" minEUR={minTransactionEUR} />
          <ItemColumn title="Expenses" items={expenseItems} totalEUR={totalExpenseEUR} sign="−" colorClass="text-red-500" minEUR={minTransactionEUR} />
        </div>
      </div>
    </div>
  )
}
