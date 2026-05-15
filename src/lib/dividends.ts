import { convertToBase } from './currency'
import type { Account } from '../types'
import { DEFAULT_EUR_USD_RATE } from './currency'
import { projectDividends, type TickerDividend } from './tiingo'

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

export function computeAnnualDividendsEUR(
  accounts: Account[],
  dividendHistory: Record<string, TickerDividend[]>,
  fxRate: number = DEFAULT_EUR_USD_RATE,
): number {
  const invAccounts = accounts.filter(
    account => (account.type === 'investment' || account.type === 'retirement') &&
      account.includedInPlanning !== false,
  )
  const today = new Date()
  const todayStr = today.toISOString().slice(0, 10)
  const yearLater = new Date(today)
  yearLater.setFullYear(yearLater.getFullYear() + 1)
  const yearLaterStr = yearLater.toISOString().slice(0, 10)

  let tiingoTotal = 0
  let hasTiingo = false
  for (const account of invAccounts) {
    for (const holding of account.holdings ?? []) {
      if (!holding.ticker || /^CUR:/.test(holding.ticker)) continue
      const history = dividendHistory[holding.ticker]
      if (!history?.length) continue
      hasTiingo = true
      const projected = projectDividends(holding.ticker, history, holding.quantity, 13)
        .filter(dividend => dividend.paymentDate >= todayStr && dividend.paymentDate <= yearLaterStr)
      for (const dividend of projected) {
        tiingoTotal += convertToBase(dividend.totalAmount, holding.currency, 'EUR', fxRate)
      }
    }
  }
  return hasTiingo && tiingoTotal > 0 ? tiingoTotal : projectedAnnualDividendsEUR(invAccounts, fxRate)
}
