import { useAppStore } from '../store/useAppStore'
import { PageHeader } from '../components/ui/PageHeader'
import { MetricCard } from '../components/ui/MetricCard'
import { Card, CardTitle } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { formatCompact } from '../lib/format'
import { convertToBase, DEFAULT_EUR_USD_RATE } from '../lib/currency'

export default function Investments() {
  const { accounts, profile } = useAppStore()

  const invested = accounts
    .filter(a => a.type === 'investment' || a.type === 'retirement')
    .reduce((s, a) => s + convertToBase(a.balance, a.currency, profile.baseCurrency, DEFAULT_EUR_USD_RATE), 0)

  const totalBase = accounts.reduce((s, a) => s + convertToBase(a.balance, a.currency, profile.baseCurrency, DEFAULT_EUR_USD_RATE), 0)

  // Aggregate allocation weighted by balance
  let totalUnrealizedGains = 0
  let totalCostBasis = 0
  let plaidLinkedCount = 0
  const allHoldings: Array<{ ticker: string, name: string, value: number, gains: number | null }> = []

  let totalEq = 0, totalBd = 0, totalCash = 0

  for (const a of accounts) {
    const b = convertToBase(a.balance, a.currency, profile.baseCurrency, DEFAULT_EUR_USD_RATE)
    totalEq += b * a.allocation.equity / 100
    totalBd += b * a.allocation.bonds / 100
    totalCash += b * a.allocation.cash / 100

    if (a.holdings && a.holdings.length > 0) {
      plaidLinkedCount++
      for (const h of a.holdings) {
        const valBase = convertToBase(h.institutionValue, h.currency, profile.baseCurrency, DEFAULT_EUR_USD_RATE)
        let gainBase: number | null = null
        if (h.costBasis != null && h.costBasis > 0) {
          const costBase = convertToBase(h.costBasis, h.currency, profile.baseCurrency, DEFAULT_EUR_USD_RATE)
          totalCostBasis += costBase
          const gain = valBase - costBase
          totalUnrealizedGains += gain
          gainBase = gain
        }
        
        const existing = h.ticker !== null ? allHoldings.find(x => x.ticker === h.ticker) : null
        if (existing) {
          existing.value += valBase
          if (gainBase !== null) existing.gains = (existing.gains ?? 0) + gainBase
        } else {
          allHoldings.push({ ticker: h.ticker ?? '', name: h.name, value: valBase, gains: gainBase })
        }
      }
    }
  }
  
  allHoldings.sort((a, b) => b.value - a.value)

  const eqPct = totalBase > 0 ? (totalEq / totalBase * 100) : 0
  const bdPct = totalBase > 0 ? (totalBd / totalBase * 100) : 0
  const cashPct = totalBase > 0 ? (totalCash / totalBase * 100) : 0

  // Currency exposure
  const byCurrency = accounts.reduce<Record<string, number>>((acc, a) => {
    const c = a.currency.toUpperCase()
    const b = convertToBase(a.balance, a.currency, profile.baseCurrency, DEFAULT_EUR_USD_RATE)
    return { ...acc, [c]: (acc[c] ?? 0) + b }
  }, {})

  const projectedDividends = invested * 0.022 // rough 2.2% yield estimate

  return (
    <div>
      <PageHeader title="Investments" />
      <div className="p-4 space-y-4">
        <div className="grid grid-cols-4 gap-[9px]">
          <MetricCard label="Total invested" value={formatCompact(invested, profile.baseCurrency)}
            sub="excl. cash & real estate" />
          <MetricCard label="Dividends + interest (proj.)" value={formatCompact(projectedDividends, profile.baseCurrency)}
            sub="~2.2% yield estimate" valueClass="text-green-600" />
          <MetricCard label="Portfolio accounts" value={String(accounts.filter(a => a.type === 'investment' || a.type === 'retirement').length)}
            sub={`${plaidLinkedCount} synced via Plaid`} />
          <MetricCard label="Unrealized Gains" value={plaidLinkedCount > 0 ? formatCompact(totalUnrealizedGains, profile.baseCurrency) : '—'}
            sub={plaidLinkedCount > 0 ? "From Plaid synced accounts" : "Link Plaid to see gains"} 
            valueClass={totalUnrealizedGains >= 0 ? 'text-green-600' : 'text-red-500'} />
        </div>

        <div className="grid grid-cols-[1fr_1fr_1fr] gap-3">
          <Card>
            <CardTitle>Asset type breakdown</CardTitle>
            {[
              { label: 'Equities', pct: eqPct, color: '#22c55e' },
              { label: 'Bonds / fixed income', pct: bdPct, color: '#378ADD' },
              { label: 'Cash equivalents', pct: cashPct, color: '#94a3b8' },
            ].map(({ label, pct, color }) => (
              <div key={label} className="flex justify-between items-center py-[5px] border-b border-gray-100 dark:border-gray-700 last:border-0 text-[12.5px]">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full inline-block" style={{ background: color }} />
                  {label}
                </div>
                <span className="font-medium">{pct.toFixed(0)}%</span>
              </div>
            ))}
            <p className="text-[10.5px] text-gray-400 mt-2">Set allocation per account in Accounts config.</p>
          </Card>

          <Card>
            <CardTitle>Currency exposure</CardTitle>
            {Object.entries(byCurrency).map(([cur, amt]) => {
              const pct = totalBase > 0 ? amt / totalBase * 100 : 0
              return (
                <div key={cur} className="flex justify-between items-center py-[5px] border-b border-gray-100 dark:border-gray-700 last:border-0 text-[12.5px]">
                  <Badge variant={cur === 'EUR' ? 'eur' : 'usd'}>{cur}</Badge>
                  <div className="flex items-center gap-2">
                    <span className="text-gray-500 text-[11px]">{formatCompact(amt, profile.baseCurrency)}</span>
                    <span className="font-medium">{pct.toFixed(0)}%</span>
                  </div>
                </div>
              )
            })}
          </Card>

          <Card>
            <CardTitle>Top Holdings (Plaid)</CardTitle>
            {allHoldings.length === 0 ? (
              <div className="text-[11.5px] text-gray-500 dark:text-gray-400 py-2">
                Link your investment accounts to Plaid in the <a href="#/config/accounts" className="text-blue-600 underline">Accounts</a> page to see your holdings and unrealized gains.
              </div>
            ) : (
              <div className="space-y-1 mt-1 max-h-[150px] overflow-y-auto">
                {allHoldings.slice(0, 8).map((h, i) => {
                  return (
                    <div key={i} className="flex justify-between items-center py-[4px] border-b border-gray-100 dark:border-gray-700 last:border-0 text-[11px]">
                      <div className="min-w-0 flex-1 pr-2">
                        <div className="font-medium text-gray-900 dark:text-gray-100 truncate">{h.ticker || 'Cash/Other'}</div>
                        <div className="text-[10px] text-gray-400 truncate">{h.name}</div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="font-medium">{formatCompact(h.value, profile.baseCurrency)}</div>
                        <div className={`text-[10px] ${h.gains && h.gains >= 0 ? 'text-green-500' : h.gains ? 'text-red-500' : 'text-gray-400'}`}>
                          {h.gains != null ? `${h.gains >= 0 ? '+' : ''}${formatCompact(h.gains, profile.baseCurrency)}` : 'No cost basis'}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  )
}
