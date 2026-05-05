import type {
  Account,
  Expense,
  MedicalCoverage,
  MedicalExpense,
  PensionEstimate,
  RealEstateEvent,
  Transfer,
  TaxSettlement,
  Windfall,
} from '../types'
import { DEFAULT_EUR_USD_RATE } from './currency'

function monthIndex(date: string): number {
  const [year, month = '12'] = date.split('-')
  return parseInt(year) * 12 + parseInt(month)
}

function startOfMonth(date: string): string {
  const [year, month = '01'] = date.split('-')
  return `${year}-${month.padStart(2, '0')}`
}

function monthFromIndex(index: number): string {
  const zeroBased = index - 1
  const year = Math.floor(zeroBased / 12)
  const month = zeroBased % 12 + 1
  return `${year}-${String(month).padStart(2, '0')}`
}

function convertAmount(amount: number, fromCurrency: string, toCurrency: string): number {
  const from = fromCurrency.toUpperCase()
  const to = toCurrency.toUpperCase()
  if (from === to) return amount
  if (from === 'USD' && to === 'EUR') return amount / DEFAULT_EUR_USD_RATE
  if (from === 'EUR' && to === 'USD') return amount * DEFAULT_EUR_USD_RATE
  return amount
}

function activeInMonth(startDate: string, endDate: string | null | undefined, month: string): boolean {
  const m = monthIndex(month)
  return m >= monthIndex(startOfMonth(startDate)) && (endDate == null || m <= monthIndex(startOfMonth(endDate)))
}

function datedAmount(amount: number, frequency: string, startDate: string, month: string, installments?: Array<{ date: string; amount: number }>): number {
  const start = startOfMonth(startDate)
  if (frequency === 'custom') {
    return installments?.filter(item => startOfMonth(item.date) === month).reduce((sum, item) => sum + item.amount, 0) ?? 0
  }
  if (frequency === 'monthly') return activeInMonth(start, null, month) ? amount : 0
  if (frequency === 'yearly') return activeInMonth(start, null, month) && month.slice(5, 7) === start.slice(5, 7) ? amount : 0
  return month === start ? amount : 0
}

function transferOccursInMonth(transfer: Transfer, month: string): boolean {
  const start = startOfMonth(transfer.startDate)
  if (transfer.frequency === 'once') return month === start
  if (!activeInMonth(start, transfer.endDate, month)) return false
  return transfer.frequency === 'monthly' || month.slice(5, 7) === start.slice(5, 7)
}

function cloneAccount(account: Account): Account {
  return {
    ...account,
    allocation: { ...account.allocation },
    holdings: account.holdings?.map(holding => ({ ...holding })),
    dividends: account.dividends?.map(dividend => ({ ...dividend })),
  }
}

function addSyntheticCashHolding(account: Account, deltaNative: number): void {
  if (!account.holdings || account.holdings.length === 0 || deltaNative === 0) return
  const currency = account.currency.toUpperCase()
  const ticker = `CUR:${currency}`
  const existing = account.holdings.find(holding => holding.ticker === ticker)
  if (existing) {
    existing.institutionValue += deltaNative
    return
  }
  account.holdings.push({
    ticker,
    name: `${currency} Cash`,
    quantity: 0,
    institutionPrice: 1,
    institutionValue: deltaNative,
    costBasis: null,
    currency,
    securityType: 'cash',
  })
}

function adjustAccount(accountsById: Map<number, Account>, accountId: number | undefined, amount: number, currency: string): void {
  if (accountId == null || amount === 0) return
  const account = accountsById.get(accountId)
  if (!account) return
  const deltaNative = convertAmount(amount, currency, account.currency)
  account.balance += deltaNative
  addSyntheticCashHolding(account, deltaNative)
}

function virtualAccountId(eventId: string): number {
  let hash = 0
  for (let i = 0; i < eventId.length; i++) {
    hash = (hash * 31 + eventId.charCodeAt(i)) >>> 0
  }
  return -1_000_000_000 - (hash % 900_000_000)
}

export function soldAccountIdsBy(asOf: string, realEstateEvents: RealEstateEvent[]): Set<number> {
  const asOfMonth = monthIndex(asOf)
  const ids = new Set<number>()

  for (const event of realEstateEvents) {
    if (event.eventType !== 'sell' || monthIndex(event.date) > asOfMonth) continue
    if (event.sourceRealEstateAccountId != null) ids.add(event.sourceRealEstateAccountId)
    if (event.sourceMortgageAccountId != null) ids.add(event.sourceMortgageAccountId)
  }

  return ids
}

export function virtualRealEstateAccountsBy(asOf: string, realEstateEvents: RealEstateEvent[]): Account[] {
  const asOfMonth = monthIndex(asOf)

  return realEstateEvents
    .filter(event => event.eventType === 'buy' && !event.isRecurring && monthIndex(event.date) <= asOfMonth)
    .map(event => ({
      id: virtualAccountId(event.id),
      lmId: virtualAccountId(event.id),
      name: event.notes?.trim() || `Property bought ${event.date}`,
      balance: event.amount,
      currency: event.currency.toLowerCase(),
      type: 'real_estate',
      allocation: { equity: 0, bonds: 0, cash: 100 },
      syncedAt: event.date,
      isManual: true,
      includedInPlanning: true,
    }))
}

export function planningAccountsBy(
  asOf: string,
  accounts: Account[],
  realEstateEvents: RealEstateEvent[],
): Account[] {
  const soldIds = soldAccountIdsBy(asOf, realEstateEvents)
  const baseAccounts = accounts.filter(a => a.includedInPlanning !== false && !soldIds.has(a.id))
  return [...baseAccounts, ...virtualRealEstateAccountsBy(asOf, realEstateEvents)]
}

export interface AccountProjectionInputs {
  accounts: Account[]
  realEstateEvents?: RealEstateEvent[]
  transfers?: Transfer[]
  expenses?: Expense[]
  medicalCoverages?: MedicalCoverage[]
  medicalExpenses?: MedicalExpense[]
  pensions?: PensionEstimate[]
  windfalls?: Windfall[]
  taxSettlements?: TaxSettlement[]
  fromMonth?: string
}

export function projectedAccountsBy(asOf: string, inputs: AccountProjectionInputs): Account[] {
  const fromMonth = inputs.fromMonth ?? startOfMonth(new Date().toISOString().slice(0, 7))
  const fromIndex = monthIndex(fromMonth)
  const toIndex = monthIndex(asOf)
  const accountsById = new Map<number, Account>()
  for (const account of inputs.accounts) {
    if (account.includedInPlanning !== false) accountsById.set(account.id, cloneAccount(account))
  }

  const virtualAccounts: Account[] = []
  const allExpenses = [
    ...(inputs.expenses ?? []),
    ...(inputs.medicalCoverages ?? []),
    ...(inputs.medicalExpenses ?? []),
  ]

  for (let idx = fromIndex + 1; idx <= toIndex; idx++) {
    const month = monthFromIndex(idx)

    for (const event of inputs.realEstateEvents ?? []) {
      if (event.isRecurring) {
        if (event.eventType === 'rent' && activeInMonth(event.date, event.endDate, month)) {
          adjustAccount(accountsById, event.sourceAccountId, -event.amount, event.currency)
        }
        continue
      }
      if (startOfMonth(event.date) !== month) continue
      if (event.eventType === 'sell') {
        adjustAccount(accountsById, event.targetAccountId, event.amount, event.currency)
        if (event.sourceRealEstateAccountId != null) accountsById.delete(event.sourceRealEstateAccountId)
        if (event.sourceMortgageAccountId != null) accountsById.delete(event.sourceMortgageAccountId)
      } else if (event.eventType === 'buy') {
        adjustAccount(accountsById, event.sourceAccountId, -event.amount, event.currency)
        virtualAccounts.push({
          id: virtualAccountId(event.id),
          lmId: virtualAccountId(event.id),
          name: event.notes?.trim() || `Property bought ${event.date}`,
          balance: event.amount,
          currency: event.currency.toLowerCase(),
          type: 'real_estate',
          allocation: { equity: 0, bonds: 0, cash: 100 },
          syncedAt: event.date,
          isManual: true,
          includedInPlanning: true,
        })
      }
    }

    for (const transfer of inputs.transfers ?? []) {
      if (!transferOccursInMonth(transfer, month)) continue
      adjustAccount(accountsById, transfer.fromAccountId, -transfer.amount, transfer.currency)
      adjustAccount(accountsById, transfer.toAccountId, transfer.amount, transfer.currency)
    }

    for (const windfall of inputs.windfalls ?? []) {
      if (!activeInMonth(windfall.date, windfall.endDate, month)) continue
      const amount = datedAmount(windfall.amount, windfall.frequency ?? 'one_time', windfall.date, month)
      adjustAccount(accountsById, windfall.targetAccountId, amount, windfall.currency)
    }

    for (const pension of inputs.pensions ?? []) {
      if (!activeInMonth(pension.startDate, pension.endDate, month)) continue
      const amount = datedAmount(pension.amount, pension.frequency, pension.startDate, month)
      adjustAccount(accountsById, pension.targetAccountId, amount, pension.currency)
    }

    for (const expense of allExpenses) {
      if (!activeInMonth(expense.startDate, expense.endDate, month)) continue
      const amount = datedAmount(expense.amount, expense.frequency, expense.startDate, month, expense.installments)
      adjustAccount(accountsById, expense.sourceAccountId, -amount, expense.currency)
    }

    for (const settlement of inputs.taxSettlements ?? []) {
      if (startOfMonth(settlement.date) !== month) continue
      const sign = settlement.kind === 'refund' ? 1 : -1
      adjustAccount(accountsById, settlement.accountId, settlement.amount * sign, settlement.currency)
    }
  }

  return [...accountsById.values(), ...virtualAccounts]
}
