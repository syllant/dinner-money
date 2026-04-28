import type {
  Account, Expense, PensionEstimate, RealEstateEvent, Windfall,
  UserProfile, TaxConfig, MedicalCoverage, MedicalExpense, Transfer,
} from '../types'
import { DEFAULT_EUR_USD_RATE } from './currency'

function toEUR(amount: number, currency: string): number {
  return currency.toUpperCase() === 'USD' ? amount / DEFAULT_EUR_USD_RATE : amount
}

/** Returns true when accountId is unset or points to a cash-type account */
function affectsCash(accountId: number | undefined, accounts: Account[]): boolean {
  if (accountId == null) return true
  const acc = accounts.find(a => a.id === accountId)
  return !acc || acc.type === 'cash'
}

export type CashEventType = 'real_estate' | 'windfall' | 'one_time_expense' | 'tax_payment' | 'transfer'

export interface CashEvent {
  label: string
  type: CashEventType
  amountEUR: number       // positive = inflow, negative = outflow
  currency: string
  amountNative: number    // positive = inflow, negative = outflow
  accountNote?: string    // "→ Brokerage" when proceeds bypass cash
  bypassesCash: boolean
}

export interface ProjectedMonth {
  year: number
  month: number
  label: string
  openingBalance: number
  recurringNetEUR: number
  events: CashEvent[]
  closingBalance: number
}

function quarterDueDate(year: number, quarter: 1 | 2 | 3 | 4): { year: number; month: number } {
  if (quarter === 4) return { year: year + 1, month: 1 }
  const months: Record<number, number> = { 1: 4, 2: 6, 3: 9 }
  return { year, month: months[quarter] }
}

/** Parse YYYY or YYYY-MM into { year, month } — month defaults to 6 when absent */
function parseYearMonth(date: string): { year: number; month: number } {
  const parts = date.split('-')
  return {
    year: parseInt(parts[0]),
    month: parts[1] != null ? parseInt(parts[1]) : 6,
  }
}

export interface BuildCashProjectionArgs {
  accounts: Account[]
  expenses: Expense[]
  medicalCoverages: MedicalCoverage[]
  medicalExpenses: MedicalExpense[]
  pensions: PensionEstimate[]
  realEstateEvents: RealEstateEvent[]
  windfalls: Windfall[]
  transfers: Transfer[]
  taxConfig: TaxConfig
  profile: UserProfile
  months?: number
}

export function buildCashProjection({
  accounts,
  expenses,
  medicalCoverages,
  medicalExpenses,
  pensions,
  realEstateEvents,
  windfalls,
  transfers,
  taxConfig,
  profile,
  months = 12,
}: BuildCashProjectionArgs): ProjectedMonth[] {
  const today = new Date()
  const startYear = today.getFullYear()
  const startMonth = today.getMonth() + 1

  const cashAccounts = accounts.filter(a => a.type === 'cash' && a.includedInPlanning !== false)
  let balance = cashAccounts.reduce((s, a) => s + toEUR(a.balance, a.currency), 0)

  const allExpenses = [...expenses, ...(medicalCoverages ?? []), ...(medicalExpenses ?? [])]

  const allQuarterlyPayments = [
    ...(taxConfig.quarterlyPayments ?? []).map(p => ({ ...p, source: 'IRS' as const })),
    ...(taxConfig.stateQuarterlyPayments ?? []).map(p => ({ ...p, source: 'CA' as const })),
  ]

  const result: ProjectedMonth[] = []

  for (let i = 0; i < months; i++) {
    const d = new Date(startYear, startMonth - 1 + i)
    const y = d.getFullYear()
    const m = d.getMonth() + 1

    const opening = balance

    // Recurring burn (skip custom — handled as one-time events below)
    let monthlyBurn = 0
    for (const exp of allExpenses) {
      if (exp.frequency === 'one_time' || exp.frequency === 'custom') continue
      if (!affectsCash((exp as Expense).sourceAccountId, accounts)) continue
      const [eY, eM] = exp.startDate.split('-').map(Number)
      const endY = exp.endDate ? parseInt(exp.endDate.split('-')[0]) : null
      const endM = exp.endDate ? parseInt(exp.endDate.split('-')[1] ?? '12') : null
      const afterStart = y > eY || (y === eY && m >= eM)
      const beforeEnd = endY === null || y < endY || (y === endY && m <= (endM ?? 12))
      if (!afterStart || !beforeEnd) continue
      if (exp.frequency === 'monthly') monthlyBurn += toEUR(exp.amount, exp.currency)
      else if (exp.frequency === 'yearly') monthlyBurn += toEUR(exp.amount / 12, exp.currency)
    }

    // Recurring real estate rent outflows
    for (const re of realEstateEvents) {
      if (!re.isRecurring) continue
      if (!affectsCash(re.sourceAccountId, accounts)) continue
      const [reY, reM] = re.date.split('-').map(Number)
      const endY = re.endDate ? parseInt(re.endDate.split('-')[0]) : null
      const endM = re.endDate ? parseInt(re.endDate.split('-')[1] ?? '12') : null
      const afterStart = y > reY || (y === reY && m >= reM)
      const beforeEnd = endY === null || y < endY || (y === endY && m <= (endM ?? 12))
      if (afterStart && beforeEnd) monthlyBurn += toEUR(re.amount, re.currency)
    }

    // Recurring transfers that move cash out
    for (const tr of transfers) {
      if (tr.frequency === 'once') continue
      const [trY, trM] = tr.startDate.split('-').map(Number)
      const endY = tr.endDate ? parseInt(tr.endDate.split('-')[0]) : null
      const endM = tr.endDate ? parseInt(tr.endDate.split('-')[1] ?? '12') : null
      const afterStart = y > trY || (y === trY && m >= trM)
      const beforeEnd = endY === null || y < endY || (y === endY && m <= (endM ?? 12))
      if (!afterStart || !beforeEnd) continue

      const fromAcc = accounts.find(a => a.id === tr.fromAccountId)
      const toAcc = accounts.find(a => a.id === tr.toAccountId)
      const fromCash = fromAcc?.type === 'cash'
      const toCash = toAcc?.type === 'cash'

      const amtEUR = toEUR(tr.amount, tr.currency)
      let monthly = 0
      if (tr.frequency === 'monthly') monthly = amtEUR
      else if (tr.frequency === 'yearly') monthly = amtEUR / 12

      if (fromCash && !toCash) monthlyBurn += monthly
      else if (!fromCash && toCash) monthlyBurn -= monthly  // inflow
    }

    // Pension income routed to cash
    let monthlyIncome = 0
    for (const p of pensions) {
      if (!affectsCash(p.targetAccountId, accounts)) continue
      const personBY = p.person === 'self' ? profile.birthYear : profile.spouseBirthYear
      if (personBY + p.startAge <= y) monthlyIncome += toEUR(p.monthlyAmount, p.currency)
    }

    const recurringNetEUR = monthlyIncome - monthlyBurn

    // One-time events
    const events: CashEvent[] = []

    // Real estate one-time
    for (const re of realEstateEvents) {
      if (re.isRecurring) continue
      const [reY, reM] = re.date.split('-').map(Number)
      if (reY !== y || reM !== m) continue
      const sign = re.eventType === 'sell' ? 1 : -1
      const relevantId = re.eventType === 'sell' ? re.targetAccountId : re.sourceAccountId
      const bypasses = !affectsCash(relevantId, accounts)
      const relAcc = relevantId != null ? accounts.find(a => a.id === relevantId) : undefined
      const eventTypeLabel = re.eventType === 'sell' ? 'Property sale' : re.eventType === 'buy' ? 'Property purchase' : 'Rent'
      events.push({
        label: re.notes?.trim() || eventTypeLabel,
        type: 'real_estate',
        amountEUR: bypasses ? 0 : toEUR(re.amount, re.currency) * sign,
        currency: re.currency,
        amountNative: bypasses ? 0 : re.amount * sign,
        accountNote: relAcc ? `${re.eventType === 'sell' ? '→' : '←'} ${relAcc.name}` : undefined,
        bypassesCash: bypasses,
      })
    }

    // Windfalls
    for (const wf of windfalls) {
      const { year: wfYear, month: wfMonth } = parseYearMonth(wf.date)
      if (wfYear !== y || wfMonth !== m) continue
      const bypasses = !affectsCash(wf.targetAccountId, accounts)
      const targetAcc = wf.targetAccountId != null ? accounts.find(a => a.id === wf.targetAccountId) : undefined
      events.push({
        label: wf.name,
        type: 'windfall',
        amountEUR: bypasses ? 0 : toEUR(wf.amount, wf.currency),
        currency: wf.currency,
        amountNative: bypasses ? 0 : wf.amount,
        accountNote: targetAcc ? `→ ${targetAcc.name}` : undefined,
        bypassesCash: bypasses,
      })
    }

    // One-time and custom installment expenses
    for (const exp of allExpenses) {
      const bypasses = !affectsCash((exp as Expense).sourceAccountId, accounts)
      const sourceAcc = (exp as Expense).sourceAccountId != null
        ? accounts.find(a => a.id === (exp as Expense).sourceAccountId) : undefined

      if (exp.frequency === 'one_time') {
        const [eY, eM] = exp.startDate.split('-').map(Number)
        if (eY !== y || eM !== m) continue
        events.push({
          label: exp.name,
          type: 'one_time_expense',
          amountEUR: bypasses ? 0 : -toEUR(exp.amount, exp.currency),
          currency: exp.currency,
          amountNative: bypasses ? 0 : -exp.amount,
          accountNote: sourceAcc ? `← ${sourceAcc.name}` : undefined,
          bypassesCash: bypasses,
        })
      } else if (exp.frequency === 'custom' && exp.installments) {
        for (const inst of exp.installments) {
          const [iY, iM] = inst.date.split('-').map(Number)
          if (iY !== y || iM !== m) continue
          events.push({
            label: `${exp.name} (installment)`,
            type: 'one_time_expense',
            amountEUR: bypasses ? 0 : -toEUR(inst.amount, exp.currency),
            currency: exp.currency,
            amountNative: bypasses ? 0 : -inst.amount,
            accountNote: sourceAcc ? `← ${sourceAcc.name}` : undefined,
            bypassesCash: bypasses,
          })
        }
      }
    }

    // Quarterly tax payments
    for (const qp of allQuarterlyPayments) {
      if (qp.status === 'paid') continue
      if (!qp.estimatedDue || qp.estimatedDue <= 0) continue
      const due = quarterDueDate(qp.year, qp.quarter as 1 | 2 | 3 | 4)
      if (due.year !== y || due.month !== m) continue
      events.push({
        label: `${qp.source} estimated tax Q${qp.quarter} ${qp.year}`,
        type: 'tax_payment',
        amountEUR: -toEUR(qp.estimatedDue, 'USD'),
        currency: 'USD',
        amountNative: -qp.estimatedDue,
        bypassesCash: false,
      })
    }

    // One-time transfers
    for (const tr of transfers) {
      if (tr.frequency !== 'once') continue
      const [trY, trM] = tr.startDate.split('-').map(Number)
      if (trY !== y || trM !== m) continue

      const fromAcc = accounts.find(a => a.id === tr.fromAccountId)
      const toAcc = accounts.find(a => a.id === tr.toAccountId)
      const fromCash = fromAcc?.type === 'cash'
      const toCash = toAcc?.type === 'cash'

      if (!fromCash && !toCash) continue  // investment-to-investment, no cash impact

      const sign = toCash && !fromCash ? 1 : fromCash && !toCash ? -1 : 0
      if (sign === 0) continue  // cash-to-cash, neutral in total

      const amtEUR = toEUR(tr.amount, tr.currency)
      events.push({
        label: tr.name || `Transfer ${fromAcc?.name ?? '?'} → ${toAcc?.name ?? '?'}`,
        type: 'transfer',
        amountEUR: amtEUR * sign,
        currency: tr.currency,
        amountNative: tr.amount * sign,
        accountNote: sign > 0 ? `← ${fromAcc?.name ?? '?'}` : `→ ${toAcc?.name ?? '?'}`,
        bypassesCash: false,
      })
    }

    balance = opening + recurringNetEUR + events.reduce((s, e) => s + e.amountEUR, 0)

    result.push({
      year: y,
      month: m,
      label: new Date(y, m - 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
      openingBalance: opening,
      recurringNetEUR,
      events,
      closingBalance: balance,
    })
  }

  return result
}

export function avgMonthlyBurn(projection: ProjectedMonth[]): number {
  const first3 = projection.slice(0, 3)
  if (first3.length === 0) return 0
  return first3.reduce((s, p) => s + Math.max(0, -p.recurringNetEUR), 0) / first3.length
}
