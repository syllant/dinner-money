import type { Account } from '../types'
import { computeAllocationFromHoldings, derivePlaidTaxLots, fetchPlaidHoldings, fetchPlaidInvestmentData, fetchPlaidItemInstitutionBrand } from './plaid'

export async function syncPlaidInvestmentAccount(account: Account, proxyUrl: string): Promise<Account> {
  if (!account.plaidAccessToken) return account
  const holdings = await fetchPlaidHoldings(proxyUrl, account.plaidAccessToken)
  const allocation = computeAllocationFromHoldings(holdings)
  let dividends = account.dividends
  let investmentEvents = account.investmentEvents
  let annotatedHoldings = holdings
  try {
    const txData = await fetchPlaidInvestmentData(proxyUrl, account.plaidAccessToken)
    dividends = txData.dividends
    investmentEvents = txData.investmentEvents
    annotatedHoldings = holdings.map(holding => ({
      ...holding,
      purchaseDate: holding.ticker ? txData.buyDates[holding.ticker] ?? undefined : undefined,
    }))
  } catch {
    // Holdings are still useful even if the brokerage does not expose transactions.
  }
  let brandPatch: Partial<Account> = {}
  if (account.logoSource !== 'manual' && !account.institutionLogoDataUrl) {
    try {
      const brand = await fetchPlaidItemInstitutionBrand(proxyUrl, account.plaidAccessToken)
      if (brand) {
        brandPatch = {
          institutionId: brand.institutionId ?? account.institutionId,
          institutionName: brand.institutionName ?? account.institutionName,
          institutionLogoDataUrl: brand.logoDataUrl ?? account.institutionLogoDataUrl,
          institutionPrimaryColor: brand.primaryColor ?? account.institutionPrimaryColor,
          logoSource: brand.logoDataUrl ? 'plaid' : account.logoSource,
        }
      }
    } catch {
      // Branding is cosmetic; keep investment sync resilient when Plaid omits metadata.
    }
  }
  // Use Plaid's reported value as balance — more current than LunchMoney's cached value.
  const balance = annotatedHoldings.reduce((sum, h) => sum + h.institutionValue, 0)
  return {
    ...account,
    ...brandPatch,
    balance: balance > 0 ? balance : account.balance,
    holdings: annotatedHoldings,
    taxLots: derivePlaidTaxLots(annotatedHoldings),
    allocation,
    dividends,
    investmentEvents,
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
