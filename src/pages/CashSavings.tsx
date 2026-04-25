import { useAppStore } from '../store/useAppStore'
import { PageHeader } from '../components/ui/PageHeader'
import { MetricCard } from '../components/ui/MetricCard'
import { Card, CardTitle } from '../components/ui/Card'
import { Table, TableHead, TableRow } from '../components/ui/Table'
import { Badge } from '../components/ui/Badge'
import { Banner } from '../components/ui/Banner'
import { formatCurrency, formatCompact } from '../lib/format'

export default function CashSavings() {
  const { accounts, profile } = useAppStore()

  const cashAccounts = accounts.filter(a => a.type === 'cash')
  const usdCash = cashAccounts.filter(a => a.currency.toUpperCase() === 'USD').reduce((s, a) => s + a.balance, 0)
  const eurCash = cashAccounts.filter(a => a.currency.toUpperCase() === 'EUR').reduce((s, a) => s + a.balance, 0)

  // Monthly burn from profile (rough — expenses module feeds this properly)
  const monthlyBurnEUR = 7200 // placeholder until expenses feed this
  const usdRunway = usdCash / (monthlyBurnEUR * 1.08) // rough
  const eurRunway = eurCash / monthlyBurnEUR

  // Count zero-yield accounts
  const zeroYield = cashAccounts.filter(a => a.allocation.cash === 100 && a.currency.toUpperCase() === 'EUR')
  const zeroYieldAmount = zeroYield.reduce((s, a) => s + a.balance, 0)
  const hasZeroYieldWarning = eurCash > 0 && zeroYieldAmount / eurCash > 0.3

  // Mock interest rates — in future these come from account metadata
  const rateMap: Record<string, number> = {}
  const getRateHealth = (rate: number): 'good' | 'warn' | 'bad' =>
    rate >= 3 ? 'good' : rate >= 1 ? 'warn' : 'bad'

  return (
    <div>
      <PageHeader title="Cash & savings" />
      <div className="p-4 space-y-4">
        <div className="grid grid-cols-2 gap-[9px]">
          <MetricCard label="Total liquidity (USD)" value={formatCompact(usdCash, 'USD')}
            sub={`${accounts.filter(a => a.currency.toUpperCase() === 'USD' && a.type === 'cash').length} USD accounts`} />
          <MetricCard label="Total liquidity (EUR)" value={formatCompact(eurCash, 'EUR')}
            sub={`${accounts.filter(a => a.currency.toUpperCase() === 'EUR' && a.type === 'cash').length} EUR accounts`} />
        </div>

        {hasZeroYieldWarning && (
          <Banner variant="warning">
            ⚠ {formatCurrency(zeroYieldAmount, 'EUR')} ({Math.round(zeroYieldAmount / eurCash * 100)}% of EUR cash)
            is earning 0% interest. Consider moving to a livret or high-yield account.
          </Banner>
        )}

        <Table>
          <TableHead>
            <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1.2fr] gap-2">
              <span>Account</span><span>Balance</span><span>Currency</span><span>Rate</span><span>Health</span>
            </div>
          </TableHead>
          {cashAccounts.length > 0 ? cashAccounts.map(acc => {
            const rate = rateMap[acc.id] ?? 0
            const health = getRateHealth(rate)
            return (
              <TableRow key={acc.id}>
                <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1.2fr] gap-2 items-center">
                  <span className="font-medium">{acc.name}</span>
                  <span>{formatCurrency(acc.balance, acc.currency)}</span>
                  <Badge variant={acc.currency.toUpperCase() === 'EUR' ? 'eur' : 'usd'}>{acc.currency.toUpperCase()}</Badge>
                  <span className="text-[12px] text-gray-500">{rate > 0 ? `${rate}%` : '—'}</span>
                  <div className="flex items-center gap-2">
                    <div className="h-[4px] w-16 rounded-full bg-gray-100 dark:bg-gray-700 overflow-hidden">
                      <div className="h-full rounded-full" style={{
                        width: `${Math.min(100, rate / 5 * 100)}%`,
                        background: health === 'good' ? '#22c55e' : health === 'warn' ? '#f59e0b' : '#ef4444'
                      }} />
                    </div>
                    <Badge variant={health === 'good' ? 'success' : health === 'warn' ? 'warning' : 'neutral'}>
                      {health === 'good' ? 'Good' : health === 'warn' ? 'Low' : 'No yield'}
                    </Badge>
                  </div>
                </div>
              </TableRow>
            )
          }) : (
            <TableRow>
              <div className="text-gray-400 text-[12px]">No cash accounts — sync from LunchMoney in Accounts</div>
            </TableRow>
          )}
        </Table>

        <Card>
          <CardTitle>Liquidity runway</CardTitle>
          <p className="text-[12px] text-gray-500 mb-3">
            At ~{formatCurrency(monthlyBurnEUR, 'EUR')}/mo burn rate, liquid cash covers:
          </p>
          <div className="grid grid-cols-2 gap-2">
            <MetricCard label="USD liquidity runway" value={`~${Math.round(usdRunway)} months`} />
            <MetricCard label="EUR liquidity runway" value={`~${Math.round(eurRunway)} months`} />
          </div>
        </Card>

        {profile.baseCurrency && (
          <p className="text-[11px] text-gray-400">
            Interest rate data is not yet available from LunchMoney. You can manually annotate rates by editing account names to include the rate (e.g. "Livret A — 3%") — automatic parsing coming in a future update.
          </p>
        )}
      </div>
    </div>
  )
}
