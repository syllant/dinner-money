import { convertToBase } from './currency'
import type { Account } from '../types'

// US equities typically pay dividends quarterly in these months
export const DIVIDEND_MONTHS = new Set([3, 6, 9, 12])

// Estimated annual dividend yield by Plaid security type (%)
function holdingYield(securityType: string): number {
  switch (securityType.toLowerCase()) {
    case 'fixed income': return 3.5
    case 'etf':          return 2.0
    case 'mutual fund':  return 1.8
    case 'equity':       return 1.8
    case 'cash':         return 0    // cash earns interest, not dividends
    default:             return 1.5
  }
}

// Annual projected dividend income in EUR for investment/retirement accounts.
// Uses per-holding security-type yield when Plaid holdings are available;
// falls back to a flat 2% on account balance otherwise.
export function projectedAnnualDividendsEUR(accounts: Account[], eurUsdRate: number): number {
  return accounts
    .filter(a => a.type === 'investment' || a.type === 'retirement')
    .reduce((sum, acc) => {
      if (acc.holdings && acc.holdings.length > 0) {
        return sum + acc.holdings.reduce((hs, h) => {
          const y = holdingYield(h.securityType)
          if (y === 0) return hs
          return hs + convertToBase(h.institutionValue, h.currency, 'EUR', eurUsdRate) * y / 100
        }, 0)
      }
      return sum + convertToBase(acc.balance, acc.currency, 'EUR', eurUsdRate) * 0.02
    }, 0)
}
