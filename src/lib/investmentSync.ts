import type { Account } from '../types'
import { computeAllocationFromHoldings, derivePlaidTaxLots, fetchPlaidHoldings, fetchPlaidInvestmentData } from './plaid'

export async function syncPlaidInvestmentAccount(account: Account, proxyUrl: string): Promise<Account> {
  if (!account.plaidAccessToken) return account
  const holdings = await fetchPlaidHoldings(proxyUrl, account.plaidAccessToken)
  const allocation = computeAllocationFromHoldings(holdings)
  let dividends = account.dividends
  let annotatedHoldings = holdings
  try {
    const txData = await fetchPlaidInvestmentData(proxyUrl, account.plaidAccessToken)
    dividends = txData.dividends
    annotatedHoldings = holdings.map(holding => ({
      ...holding,
      purchaseDate: holding.ticker ? txData.buyDates[holding.ticker] ?? undefined : undefined,
    }))
  } catch {
    // Holdings are still useful even if the brokerage does not expose transactions.
  }
  return {
    ...account,
    holdings: annotatedHoldings,
    taxLots: derivePlaidTaxLots(annotatedHoldings),
    allocation,
    dividends,
  }
}

export async function syncPlaidInvestmentAccounts(accounts: Account[], proxyUrl: string): Promise<Account[]> {
  const next = [...accounts]
  for (let i = 0; i < next.length; i++) {
    const account = next[i]
    if (account.includedInPlanning === false || !account.plaidAccessToken) continue
    if (account.type !== 'investment' && account.type !== 'retirement') continue
    next[i] = await syncPlaidInvestmentAccount(account, proxyUrl)
  }
  return next
}
