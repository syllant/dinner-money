import type { Account, Currency } from '../types'
import { convertToBase } from './currency'
import { projectedAccountsBy } from './accountLifecycle'
import type {
  Expense, MedicalCoverage, MedicalExpense, PensionEstimate, RealEstateEvent, Transfer, Windfall,
} from '../types'

export function accountBaseValue(
  account: Account,
  baseCurrency: Currency,
  fxRate: number,
): number {
  if (account.holdings && account.holdings.length > 0) {
    return account.holdings.reduce(
      (sum, holding) => sum + convertToBase(holding.institutionValue, holding.currency, baseCurrency, fxRate),
      0,
    )
  }
  return convertToBase(account.balance, account.currency, baseCurrency, fxRate)
}

export function currentPlanningAccounts(args: {
  accounts: Account[]
  expenses: Expense[]
  medicalCoverages: MedicalCoverage[]
  medicalExpenses: MedicalExpense[]
  pensions: PensionEstimate[]
  realEstateEvents: RealEstateEvent[]
  transfers: Transfer[]
  windfalls: Windfall[]
}): Account[] {
  const today = new Date()
  const month = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`
  return projectedAccountsBy(month, args)
}

export function totalAccountValue(
  accounts: Account[],
  baseCurrency: Currency,
  fxRate: number,
): number {
  return accounts.reduce((sum, account) => sum + accountBaseValue(account, baseCurrency, fxRate), 0)
}

export function liquidAccountValue(
  accounts: Account[],
  baseCurrency: Currency,
  fxRate: number,
): number {
  return accounts
    .filter(account => account.type === 'cash' || account.type === 'investment')
    .reduce((sum, account) => sum + accountBaseValue(account, baseCurrency, fxRate), 0)
}

export function investmentAccountValue(
  accounts: Account[],
  baseCurrency: Currency,
  fxRate: number,
): number {
  return accounts
    .filter(account => account.type === 'investment' || account.type === 'retirement')
    .reduce((sum, account) => sum + accountBaseValue(account, baseCurrency, fxRate), 0)
}

export function aggregateNavHistory(accounts: Account[]): Array<{ date: string; value: number }> | null {
  const relevant = accounts.filter(
    account => (account.type === 'investment' || account.type === 'retirement') &&
      account.includedInPlanning !== false &&
      (account.navHistory?.length ?? 0) >= 2,
  )
  if (relevant.length === 0) return null
  const dateMap = new Map<string, number>()
  for (const account of relevant) {
    for (const point of account.navHistory ?? []) {
      dateMap.set(point.date, (dateMap.get(point.date) ?? 0) + point.value)
    }
  }
  return [...dateMap.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, value]) => ({ date, value }))
}

export function latestAccountSync(accounts: Account[]): Date | null {
  let latest: Date | null = null
  for (const account of accounts) {
    if (!account.syncedAt) continue
    const syncedAt = new Date(account.syncedAt)
    if (Number.isNaN(syncedAt.getTime())) continue
    if (!latest || syncedAt > latest) latest = syncedAt
  }
  return latest
}
