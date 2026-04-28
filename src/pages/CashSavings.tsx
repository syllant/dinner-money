import { useAppStore } from '../store/useAppStore'
import { PageHeader } from '../components/ui/PageHeader'
import { MetricCard } from '../components/ui/MetricCard'
import { Card, CardTitle } from '../components/ui/Card'
import { Table, TableHead, TableRow } from '../components/ui/Table'
import { Banner } from '../components/ui/Banner'
import { formatCurrency, formatCompact } from '../lib/format'
import { DEFAULT_EUR_USD_RATE } from '../lib/currency'
import type { Account, PensionEstimate, UserProfile } from '../types'

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
        <TableRow>
          <div className="text-gray-400 text-[12px]">No accounts</div>
        </TableRow>
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

export default function CashSavings() {
  const { accounts, expenses, medicalCoverages, medicalExpenses, pensions, profile } = useAppStore()

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

  return (
    <div>
      <PageHeader title="Cash & savings" />
      <div className="p-4 space-y-5">

        <Card>
          <CardTitle>Liquidity overview</CardTitle>
          <div className="grid grid-cols-3 gap-3">
            <MetricCard
              label="Total cash (EUR equiv.)"
              value={formatCompact(totalEUR, 'EUR')}
              sub={`${cashAccounts.length} cash accounts`}
            />
            <MetricCard
              label="Net monthly outflow"
              value={monthlyNetDrainEUR > 0 ? `−${formatCurrency(monthlyNetDrainEUR, 'EUR')}/mo` : monthlyBurnEUR > 0 ? 'Covered by income' : '—'}
              sub={monthlyBurnEUR > 0
                ? `${formatCurrency(monthlyBurnEUR, 'EUR')}/mo burn − ${formatCurrency(monthlyIncomeEUR, 'EUR')}/mo income`
                : 'No expenses configured'}
            />
            <MetricCard
              label="Cash runway"
              value={monthlyNetDrainEUR > 0 ? `~${Math.round(totalRunway)} months` : '—'}
              sub={runoutDate ? `Runs out ~${runoutDate}` : monthlyNetDrainEUR === 0 && monthlyBurnEUR > 0 ? 'Income covers burn' : 'Configure expenses'}
              valueClass={totalRunway < 12 ? 'text-red-500' : totalRunway < 24 ? 'text-amber-500' : undefined}
            />
          </div>
          {monthlyNetDrainEUR > 0 && totalRunway < 18 && (
            <Banner variant="warning" className="mt-3">
              ⚠ Less than 18 months of cash runway — consider funding your accounts or reducing expenses.
            </Banner>
          )}
        </Card>

        <div className="grid grid-cols-2 gap-5">
          <CurrencyColumn currency="USD" accounts={usdAccounts} total={usdCash} monthlyNetDrain={monthlyNetDrainUSD} />
          <CurrencyColumn currency="EUR" accounts={eurAccounts} total={eurCash} monthlyNetDrain={monthlyNetDrainEUR} />
        </div>

      </div>
    </div>
  )
}
