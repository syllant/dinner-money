import { useAppStore } from '../store/useAppStore'
import { PageHeader } from '../components/ui/PageHeader'
import { MetricCard } from '../components/ui/MetricCard'
import { Card, CardTitle } from '../components/ui/Card'
import { Table, TableHead, TableRow } from '../components/ui/Table'
import { Badge } from '../components/ui/Badge'
import { Banner } from '../components/ui/Banner'
import { formatCurrency, formatCompact } from '../lib/format'
import { DEFAULT_EUR_USD_RATE } from '../lib/currency'
import type { Account } from '../types'

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

function AccountTable({ accounts }: { accounts: Account[] }) {
  return (
    <Table>
      <TableHead>
        <div className="grid grid-cols-[2fr_1fr_60px] gap-2">
          <span>Account</span><span>Balance</span><span></span>
        </div>
      </TableHead>
      {accounts.length > 0 ? accounts.map(acc => (
        <TableRow key={acc.id}>
          <div className="grid grid-cols-[2fr_1fr_60px] gap-2 items-center">
            <span className="font-medium truncate">{acc.name}</span>
            <span className={`font-medium ${acc.balance >= 0 ? 'text-green-600' : 'text-red-500'}`}>
              {acc.balance >= 0 ? '+' : ''}{formatCurrency(acc.balance, acc.currency)}
            </span>
            <Badge variant={acc.currency.toUpperCase() === 'EUR' ? 'eur' : 'usd'}>{acc.currency.toUpperCase()}</Badge>
          </div>
        </TableRow>
      )) : (
        <TableRow>
          <div className="text-gray-400 text-[12px]">No accounts</div>
        </TableRow>
      )}
    </Table>
  )
}

function CurrencyColumn({ currency, accounts, total, monthlyBurn }: {
  currency: 'USD' | 'EUR'
  accounts: Account[]
  total: number
  monthlyBurn: number
}) {
  const runway = monthlyBurn > 0 ? total / monthlyBurn : 0
  const zeroYield = accounts.filter(a => a.allocation.cash === 100)
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
          label="Liquidity runway"
          value={monthlyBurn > 0 ? `~${Math.round(runway)} mo` : '—'}
          sub={monthlyBurn > 0 ? `at ${formatCurrency(monthlyBurn, 'EUR')}/mo burn` : 'No expenses configured'}
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

export default function CashSavings() {
  const { accounts, expenses, medicalCoverages, medicalExpenses } = useAppStore()

  const cashAccounts = accounts.filter(a => a.type === 'cash')
  const usdAccounts = cashAccounts.filter(a => a.currency.toUpperCase() === 'USD')
  const eurAccounts = cashAccounts.filter(a => a.currency.toUpperCase() === 'EUR')

  const usdCash = usdAccounts.reduce((s, a) => s + a.balance, 0)
  const eurCash = eurAccounts.reduce((s, a) => s + a.balance, 0)
  const totalEUR = eurCash + usdCash / DEFAULT_EUR_USD_RATE

  const monthlyBurnEUR = computeMonthlyBurn(expenses, medicalCoverages, medicalExpenses)
  const monthlyBurnUSD = monthlyBurnEUR * DEFAULT_EUR_USD_RATE
  const totalRunway = monthlyBurnEUR > 0 ? totalEUR / monthlyBurnEUR : 0

  return (
    <div>
      <PageHeader title="Cash & savings" />
      <div className="p-4 space-y-5">

        {/* Consolidated top */}
        <Card>
          <CardTitle>Total liquidity (consolidated)</CardTitle>
          <div className="grid grid-cols-3 gap-3">
            <MetricCard
              label="Total liquidity (EUR)"
              value={formatCompact(totalEUR, 'EUR')}
              sub={`${cashAccounts.length} cash accounts`}
            />
            <MetricCard
              label="Liquidity runway"
              value={monthlyBurnEUR > 0 ? `~${Math.round(totalRunway)} months` : '—'}
              sub={monthlyBurnEUR > 0 ? `at ${formatCurrency(monthlyBurnEUR, 'EUR')}/mo burn` : 'Configure expenses for burn rate'}
            />
            <div className="flex items-center justify-center text-[11px] text-gray-400 border border-dashed border-gray-200 dark:border-gray-700 rounded-xl px-3 py-4 text-center leading-relaxed">
              Historical balance chart coming in a future update
            </div>
          </div>
        </Card>

        {/* Per-currency columns */}
        <div className="grid grid-cols-2 gap-5">
          <CurrencyColumn
            currency="USD"
            accounts={usdAccounts}
            total={usdCash}
            monthlyBurn={monthlyBurnUSD}
          />
          <CurrencyColumn
            currency="EUR"
            accounts={eurAccounts}
            total={eurCash}
            monthlyBurn={monthlyBurnEUR}
          />
        </div>

      </div>
    </div>
  )
}
