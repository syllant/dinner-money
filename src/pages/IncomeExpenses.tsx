import { useAppStore } from '../store/useAppStore'
import { PageHeader } from '../components/ui/PageHeader'
import { Badge } from '../components/ui/Badge'
import { formatCurrency } from '../lib/format'
import { DEFAULT_EUR_USD_RATE } from '../lib/currency'

type TxType = 'received' | 'projected' | 'recurring' | 'planned' | 'one_time'

interface Tx {
  id: string
  date: string     // for sorting
  dateLabel: string
  description: string
  category: string
  amount: number
  currency: string
  txType: TxType
  future: boolean
}

function txBadge(type: TxType) {
  switch (type) {
    case 'received':  return <Badge variant="success">Received</Badge>
    case 'projected': return <Badge variant="purple">Projected</Badge>
    case 'recurring': return <Badge variant="warning">Recurring</Badge>
    case 'planned':   return <Badge variant="purple">Planned</Badge>
    case 'one_time':  return <Badge variant="warning">One-time</Badge>
  }
}

export default function IncomeExpenses() {
  const { expenses, pensions, profile } = useAppStore()
  const now = new Date()
  const currentYear = now.getFullYear()

  // Build income list (pensions + placeholder dividends)
  const incomeTxs: Tx[] = []
  for (const p of pensions) {
    const personBY = p.person === 'self' ? profile.birthYear : profile.spouseBirthYear
    const startYear = personBY + p.startAge
    if (startYear <= currentYear) {
      incomeTxs.push({
        id: p.id, date: `${currentYear}-01`, dateLabel: `${currentYear} (annual)`,
        description: `${p.label} — ${p.person}`, category: 'Pension',
        amount: p.monthlyAmount * 12, currency: p.currency, txType: 'received', future: false,
      })
    } else {
      incomeTxs.push({
        id: p.id, date: `${startYear}-01`, dateLabel: `Starts ${startYear}`,
        description: `${p.label} — ${p.person}`, category: 'Pension',
        amount: p.monthlyAmount * 12, currency: p.currency, txType: 'projected', future: true,
      })
    }
  }
  incomeTxs.sort((a, b) => a.date.localeCompare(b.date))

  // Build expense list from configured expenses
  const expenseTxs: Tx[] = expenses.flatMap(exp => {
    const startYear = parseInt(exp.startDate.split('-')[0])
    const endYear = exp.endDate ? parseInt(exp.endDate.split('-')[0]) : null
    if (endYear && endYear < currentYear) return []
    const isFuture = startYear > currentYear
    return [{
      id: exp.id, date: exp.startDate, dateLabel: exp.endDate ? `${exp.startDate} → ${exp.endDate}` : `${exp.startDate} →`,
      description: exp.name, category: exp.category,
      amount: exp.amount, currency: exp.currency,
      txType: (exp.frequency === 'one_time' ? 'one_time' : 'recurring') as TxType,
      future: isFuture,
    }]
  }).sort((a, b) => a.date.localeCompare(b.date))

  const ytdIncome = incomeTxs.filter(t => !t.future).reduce((s, t) => {
    return s + (t.currency === 'EUR' ? t.amount : t.amount / DEFAULT_EUR_USD_RATE)
  }, 0)
  const ytdExpense = expenseTxs.filter(t => !t.future).reduce((s, t) => {
    const annual = t.txType === 'recurring' ? t.amount * 12 : t.amount
    return s + (t.currency === 'EUR' ? annual : annual / DEFAULT_EUR_USD_RATE)
  }, 0)

  return (
    <div>
      <PageHeader title="Income & expenses">
        <div className="flex gap-2">
          <button className="text-[11.5px] px-3 py-1 border border-gray-300 dark:border-gray-600 rounded-[5px] font-medium">{currentYear}</button>
          <button className="text-[11.5px] px-3 py-1 border border-gray-300 dark:border-gray-600 rounded-[5px]">All</button>
        </div>
      </PageHeader>
      <div className="p-4">
        <div className="grid grid-cols-2 gap-4">

          {/* INCOME */}
          <div>
            <div className="flex justify-between items-center pb-[7px] border-b border-gray-200 dark:border-gray-700 mb-2">
              <span className="text-[12.5px] font-medium">Income</span>
              <span className="text-[12px] font-medium text-green-600">+{formatCurrency(ytdIncome, 'EUR')} YTD</span>
            </div>
            <div className="border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
              {incomeTxs.length === 0 && (
                <div className="px-3 py-4 text-[12px] text-gray-400">
                  No income configured yet. Add pensions in Configuration → Pensions.
                </div>
              )}
              {incomeTxs.map(tx => (
                <div key={tx.id} className={`px-3 py-[7px] border-b border-gray-100 dark:border-gray-700 last:border-0 ${tx.future ? 'opacity-60' : ''}`}>
                  <div className="flex justify-between items-baseline gap-2">
                    <span className={`text-[12px] truncate ${tx.future ? 'text-gray-400' : 'text-gray-900 dark:text-white'}`}>
                      {tx.description}
                    </span>
                    <span className="text-[12px] font-medium text-green-600 shrink-0">
                      {tx.future ? '~' : '+'}{formatCurrency(tx.amount, tx.currency)}/yr
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mt-[2px]">
                    <span className="text-[10px] text-gray-400">{tx.dateLabel}</span>
                    {txBadge(tx.txType)}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* EXPENSES */}
          <div>
            <div className="flex justify-between items-center pb-[7px] border-b border-gray-200 dark:border-gray-700 mb-2">
              <span className="text-[12.5px] font-medium">Expenses</span>
              <span className="text-[12px] font-medium text-red-500">−{formatCurrency(ytdExpense, 'EUR')} est. annual</span>
            </div>
            <div className="border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
              {expenseTxs.length === 0 && (
                <div className="px-3 py-4 text-[12px] text-gray-400">
                  No expenses configured yet. Add them in Configuration → Expenses.
                </div>
              )}
              {expenseTxs.map(tx => (
                <div key={tx.id} className={`px-3 py-[7px] border-b border-gray-100 dark:border-gray-700 last:border-0 ${tx.future ? 'opacity-60' : ''}`}>
                  <div className="flex justify-between items-baseline gap-2">
                    <span className={`text-[12px] truncate ${tx.future ? 'text-gray-400' : 'text-gray-900 dark:text-white'}`}>
                      {tx.description}
                    </span>
                    <span className="text-[12px] font-medium text-red-500 shrink-0">
                      −{formatCurrency(tx.amount, tx.currency)}{tx.txType === 'recurring' ? '/mo' : ''}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mt-[2px]">
                    <span className="text-[10px] text-gray-400">{tx.dateLabel}</span>
                    {txBadge(tx.txType)}
                  </div>
                </div>
              ))}
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}
