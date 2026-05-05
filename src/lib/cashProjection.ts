import type {
  Account, Expense, PensionEstimate, RealEstateEvent, Windfall,
  UserProfile, TaxConfig, MedicalCoverage, MedicalExpense, Transfer,
} from '../types'
import { DEFAULT_EUR_USD_RATE } from './currency'
import { projectedAnnualDividendsEUR } from './dividends'

function toEUR(amount: number, currency: string): number {
  return currency.toUpperCase() === 'USD' ? amount / DEFAULT_EUR_USD_RATE : amount
}

/** Returns true when accountId is unset or points to a cash-type account */
function affectsCash(accountId: number | undefined, accounts: Account[]): boolean {
  if (accountId == null) return true
  const acc = accounts.find(a => a.id === accountId && a.includedInPlanning !== false)
  return !acc || acc.type === 'cash'
}

export type CashEventType = 'real_estate' | 'windfall' | 'one_time_expense' | 'tax_payment' | 'transfer' | 'dividend' | 'other'

export interface CashEvent {
  label: string
  type: CashEventType
  category?: string       // display category for badge (e.g. expense category, windfall category)
  amountEUR: number       // positive = inflow, negative = outflow; 0 when bypassesCash
  currency: string
  amountNative: number    // positive = inflow, negative = outflow; always the real amount
  accountNote?: string    // e.g. "→ Brokerage" or "Chase → IBKR"
  bypassesCash: boolean
  installmentNote?: string  // e.g. "installment 2/4"
}

export interface AccountBalance {
  id: number
  name: string
  currency: string       // uppercase ISO
  balanceEUR: number     // projected EUR-equivalent balance
}

export interface ProjectedMonth {
  year: number
  month: number
  label: string
  openingBalance: number
  recurringNetEUR: number
  recurringBurnEUR: number    // monthly expense outflow (before one-time events)
  recurringIncomeEUR: number  // monthly recurring income: pension + interest
  recurringItems: Array<{ category: string; name: string; amountEUR: number; currency: string; amountNative: number }>  // individual expense rows
  recurringIncomeItems: Array<{ category: string; name: string; amountEUR: number; currency: string; amountNative: number }>  // individual income rows
  events: CashEvent[]
  closingBalance: number
  openingAccountBalances: AccountBalance[]  // per-account at start of month; month[0] = current balances
  accountBalances: AccountBalance[]
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
  annualDivEUR?: number  // override from caller (e.g. Tiingo-based); falls back to formula
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
  months = 12,
  annualDivEUR: annualDivEUROverride,
}: BuildCashProjectionArgs): ProjectedMonth[] {
  const today = new Date()
  const startYear = today.getFullYear()
  const startMonth = today.getMonth() + 1

  const cashAccounts = accounts.filter(a => a.type === 'cash' && a.includedInPlanning !== false)
  let balance = cashAccounts.reduce((s, a) => s + toEUR(a.balance, a.currency), 0)

  // Per-account balance tracking (proportional distribution)
  const perAccountEUR = new Map<number, number>()
  for (const acc of cashAccounts) {
    perAccountEUR.set(acc.id, toEUR(acc.balance, acc.currency))
  }

  // Dividends shown as quarterly events (not in recurring net)
  const annualDivEUR = annualDivEUROverride ?? projectedAnnualDividendsEUR(
    accounts.filter(a => a.includedInPlanning !== false), DEFAULT_EUR_USD_RATE
  )
  const divInvAccounts = accounts.filter(
    a => (a.type === 'investment' || a.type === 'retirement') &&
    a.includedInPlanning !== false &&
    (a.holdings ?? []).some(h => h.ticker && !/^CUR:/.test(h.ticker))
  )
  const divAccountNote = divInvAccounts.length === 0
    ? '→ Investments'
    : `→ ${divInvAccounts.map(a => a.name).join(', ')}`
  // Monthly interest from cash accounts added to recurring net
  const monthlyInterestEUR = cashAccounts
    .filter(a => (a.interestRate ?? 0) > 0 && a.balance > 0)
    .reduce((s, a) => s + toEUR(a.balance * (a.interestRate ?? 0) / 100 / 12, a.currency), 0)

  // Pre-compute interest income items (same each month; uses opening balances)
  const interestIncomeItems = cashAccounts
    .filter(a => (a.interestRate ?? 0) > 0 && a.balance > 0)
    .map(a => ({
      category: 'Interest',
      name: a.name,
      amountEUR: toEUR(a.balance * (a.interestRate ?? 0) / 100 / 12, a.currency),
      currency: a.currency.toUpperCase(),
      amountNative: a.balance * (a.interestRate ?? 0) / 100 / 12,
    }))
    .filter(x => x.amountEUR > 0)

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
    const openingAccountBalances: AccountBalance[] = cashAccounts.map(acc => ({
      id: acc.id, name: acc.name, currency: acc.currency.toUpperCase(),
      balanceEUR: perAccountEUR.get(acc.id) ?? 0,
    }))

    // Events array declared early so yearly items (transfers, expenses) can push to it
    const events: CashEvent[] = []
    const accountDeltaEUR = new Map<number, number>()
    const addAccountDelta = (accountId: number | undefined, amount: number, currency: string) => {
      if (accountId == null || amount === 0) return
      const acc = accounts.find(a => a.id === accountId)
      if (!acc || acc.type !== 'cash') return
      accountDeltaEUR.set(accountId, (accountDeltaEUR.get(accountId) ?? 0) + toEUR(amount, currency))
    }

    // ── Recurring burn: monthly expenses only (yearly handled as events below) ──
    let monthlyBurn = 0
    const recurringItems: Array<{ category: string; name: string; amountEUR: number; currency: string; amountNative: number }> = []

    for (const exp of allExpenses) {
      // yearly and one_time/custom are handled separately
      if (exp.frequency === 'one_time' || exp.frequency === 'custom' || exp.frequency === 'yearly') continue
      if (!affectsCash((exp as Expense).sourceAccountId, accounts)) continue
      const [eY, eM] = exp.startDate.split('-').map(Number)
      const endY = exp.endDate ? parseInt(exp.endDate.split('-')[0]) : null
      const endM = exp.endDate ? parseInt(exp.endDate.split('-')[1] ?? '12') : null
      const afterStart = y > eY || (y === eY && m >= eM)
      const beforeEnd = endY === null || y < endY || (y === endY && m <= (endM ?? 12))
      if (!afterStart || !beforeEnd) continue
      const cat = (exp as { category?: string }).category || 'Medical'
      if (exp.frequency === 'monthly') {
        const amt = toEUR(exp.amount, exp.currency)
        monthlyBurn += amt
        addAccountDelta((exp as Expense).sourceAccountId, -exp.amount, exp.currency)
        recurringItems.push({ category: cat, name: exp.name, amountEUR: amt, currency: exp.currency.toUpperCase(), amountNative: exp.amount })
      }
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
      if (afterStart && beforeEnd) {
        const amt = toEUR(re.amount, re.currency)
        monthlyBurn += amt
        addAccountDelta(re.sourceAccountId, -re.amount, re.currency)
        recurringItems.push({ category: 'Real estate', name: re.notes?.trim() || 'Rent', amountEUR: amt, currency: re.currency.toUpperCase(), amountNative: re.amount })
      }
    }

    // Recurring transfers
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

      if (tr.frequency === 'yearly') {
        // Fire as one-time event only in the anniversary month
        if (m !== trM) continue
        if (fromCash) addAccountDelta(tr.fromAccountId, -tr.amount, tr.currency)
        if (toCash) addAccountDelta(tr.toAccountId, tr.amount, tr.currency)
        const sign = toCash && !fromCash ? 1 : fromCash && !toCash ? -1 : 0
        if (sign === 0) continue
        const amtEUR = toEUR(tr.amount, tr.currency)
        events.push({
          label: tr.name || 'Transfer',
          type: 'transfer',
          category: 'Transfer',
          amountEUR: amtEUR * sign,
          currency: tr.currency,
          amountNative: tr.amount * sign,
          accountNote: `${fromAcc?.name ?? '?'} → ${toAcc?.name ?? '?'}`,
          bypassesCash: false,
        })
        continue
      }

      // monthly
      const amtEUR = toEUR(tr.amount, tr.currency)
      if (fromCash && !toCash) {
        monthlyBurn += amtEUR
        addAccountDelta(tr.fromAccountId, -tr.amount, tr.currency)
        recurringItems.push({ category: 'Transfer', name: tr.name || 'Transfer', amountEUR: amtEUR, currency: tr.currency.toUpperCase(), amountNative: tr.amount })
      } else if (!fromCash && toCash) {
        monthlyBurn -= amtEUR  // inflow (shown in income items)
        addAccountDelta(tr.toAccountId, tr.amount, tr.currency)
      } else if (fromCash && toCash) {
        addAccountDelta(tr.fromAccountId, -tr.amount, tr.currency)
        addAccountDelta(tr.toAccountId, tr.amount, tr.currency)
      }
    }

    // Pension income routed to cash
    let monthlyIncome = monthlyInterestEUR
    const recurringIncomeItems: Array<{ category: string; name: string; amountEUR: number; currency: string; amountNative: number }> = [
      ...interestIncomeItems,
    ]
    for (const p of pensions) {
      if (!affectsCash(p.targetAccountId, accounts)) continue
      
      const [stY, stM] = p.startDate.split('-').map(Number)
      const afterStart = y > stY || (y === stY && m >= stM)
      
      let beforeEnd = true
      if (p.endDate) {
        const [enY, enM] = p.endDate.split('-').map(Number)
        beforeEnd = y < enY || (y === enY && m <= enM)
      }

      if (!afterStart || !beforeEnd) continue

      const amtEUR = toEUR(p.amount, p.currency)
      const srcLabel = p.source === 'US_SS' ? 'Soc. Security' : p.source === 'FR_RETRAITE' ? 'Retraite' : 'Pension'
      const personLabel = p.person === 'self' ? 'Self' : 'Spouse'
      const nameLabel = `${p.label} (${personLabel})`

      if (p.frequency === 'yearly' || p.frequency === 'one_time') {
        if (m !== stM) continue // only trigger on anniversary month
        if (p.frequency === 'one_time' && y !== stY) continue
        
        events.push({
          label: nameLabel,
          type: 'other',
          category: srcLabel,
          amountEUR: amtEUR,
          currency: p.currency,
          amountNative: p.amount,
          bypassesCash: false,
        })
        addAccountDelta(p.targetAccountId, p.amount, p.currency)
      } else {
        // Monthly
        monthlyIncome += amtEUR
        addAccountDelta(p.targetAccountId, p.amount, p.currency)
        recurringIncomeItems.push({
          category: srcLabel,
          name: nameLabel,
          amountEUR: amtEUR,
          currency: p.currency.toUpperCase(),
          amountNative: p.amount
        })
      }
    }

    // ── One-time events ──

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
        category: 'Real estate',
        amountEUR: bypasses ? 0 : toEUR(re.amount, re.currency) * sign,
        currency: re.currency,
        amountNative: re.amount * sign,
        accountNote: relAcc ? `${re.eventType === 'sell' ? '→' : '←'} ${relAcc.name}` : undefined,
        bypassesCash: bypasses,
      })
      if (!bypasses) addAccountDelta(relevantId, re.amount * sign, re.currency)
    }

    // Windfalls (income)
    for (const wf of windfalls) {
      const freq = wf.frequency ?? 'one_time'
      const bypasses = !affectsCash(wf.targetAccountId, accounts)
      const targetAcc = wf.targetAccountId != null ? accounts.find(a => a.id === wf.targetAccountId) : undefined
      const accountNote = targetAcc ? `→ ${targetAcc.name}` : undefined
      const cat = wf.category || 'Income'
      const amtEUR = toEUR(wf.amount, wf.currency)

      if (freq === 'monthly') {
        // Recurring monthly income: add to recurring income items
        const { year: sY, month: sM } = parseYearMonth(wf.date)
        const endY = wf.endDate ? parseInt(wf.endDate.split('-')[0]) : null
        const endM = wf.endDate ? parseInt(wf.endDate.split('-')[1] ?? '12') : null
        const afterStart = y > sY || (y === sY && m >= sM)
        const beforeEnd = endY === null || y < endY || (y === endY && m <= (endM ?? 12))
        if (afterStart && beforeEnd && !bypasses) {
          monthlyIncome += amtEUR
          addAccountDelta(wf.targetAccountId, wf.amount, wf.currency)
          recurringIncomeItems.push({ category: cat, name: wf.name, amountEUR: amtEUR, currency: wf.currency.toUpperCase(), amountNative: wf.amount })
        }
      } else if (freq === 'yearly') {
        const { year: sY, month: sM } = parseYearMonth(wf.date)
        const endY = wf.endDate ? parseInt(wf.endDate.split('-')[0]) : null
        const endM = wf.endDate ? parseInt(wf.endDate.split('-')[1] ?? '12') : null
        const afterStart = y > sY || (y === sY && m >= sM)
        const beforeEnd = endY === null || y < endY || (y === endY && m <= (endM ?? 12))
        if (afterStart && beforeEnd && m === sM) {
          events.push({
            label: wf.name, type: 'windfall', category: cat,
            amountEUR: bypasses ? 0 : amtEUR, currency: wf.currency,
            amountNative: wf.amount, accountNote, bypassesCash: bypasses,
          })
          if (!bypasses) addAccountDelta(wf.targetAccountId, wf.amount, wf.currency)
        }
      } else {
        // one_time
        const { year: wfYear, month: wfMonth } = parseYearMonth(wf.date)
        if (wfYear !== y || wfMonth !== m) continue
        events.push({
          label: wf.name, type: 'windfall', category: cat,
          amountEUR: bypasses ? 0 : amtEUR, currency: wf.currency,
          amountNative: wf.amount, accountNote, bypassesCash: bypasses,
        })
        if (!bypasses) addAccountDelta(wf.targetAccountId, wf.amount, wf.currency)
      }
    }

    // One-time and custom installment expenses
    for (const exp of allExpenses) {
      const bypasses = !affectsCash((exp as Expense).sourceAccountId, accounts)
      const sourceAcc = (exp as Expense).sourceAccountId != null
        ? accounts.find(a => a.id === (exp as Expense).sourceAccountId) : undefined
      const cat = (exp as { category?: string }).category || 'Medical'

      if (exp.frequency === 'one_time') {
        const [eY, eM] = exp.startDate.split('-').map(Number)
        if (eY !== y || eM !== m) continue
        events.push({
          label: exp.name,
          type: 'one_time_expense',
          category: cat,
          amountEUR: bypasses ? 0 : -toEUR(exp.amount, exp.currency),
          currency: exp.currency,
          amountNative: -exp.amount,
          accountNote: sourceAcc ? `← ${sourceAcc.name}` : undefined,
          bypassesCash: bypasses,
        })
        if (!bypasses) addAccountDelta((exp as Expense).sourceAccountId, -exp.amount, exp.currency)
      } else if (exp.frequency === 'yearly') {
        // Fire once per year in the anniversary month
        const [eY, eM] = exp.startDate.split('-').map(Number)
        const endY = exp.endDate ? parseInt(exp.endDate.split('-')[0]) : null
        const endM = exp.endDate ? parseInt(exp.endDate.split('-')[1] ?? '12') : null
        const afterStart = y > eY || (y === eY && m >= eM)
        const beforeEnd = endY === null || y < endY || (y === endY && m <= (endM ?? 12))
        if (!afterStart || !beforeEnd || m !== eM) continue
        if (!affectsCash((exp as Expense).sourceAccountId, accounts)) continue
        events.push({
          label: exp.name,
          type: 'one_time_expense',
          category: cat,
          amountEUR: bypasses ? 0 : -toEUR(exp.amount, exp.currency),
          currency: exp.currency,
          amountNative: -exp.amount,
          accountNote: sourceAcc ? `← ${sourceAcc.name}` : undefined,
          bypassesCash: bypasses,
        })
        if (!bypasses) addAccountDelta((exp as Expense).sourceAccountId, -exp.amount, exp.currency)
      } else if (exp.frequency === 'custom' && exp.installments) {
        const total = exp.installments.length
        for (let instIdx = 0; instIdx < total; instIdx++) {
          const inst = exp.installments[instIdx]
          const [iY, iM] = inst.date.split('-').map(Number)
          if (iY !== y || iM !== m) continue
          events.push({
            label: exp.name,
            type: 'one_time_expense',
            category: cat,
            amountEUR: bypasses ? 0 : -toEUR(inst.amount, exp.currency),
            currency: exp.currency,
            amountNative: -inst.amount,
            accountNote: sourceAcc ? `← ${sourceAcc.name}` : undefined,
            bypassesCash: bypasses,
            installmentNote: `installment ${instIdx + 1}/${total}`,
          })
          if (!bypasses) addAccountDelta((exp as Expense).sourceAccountId, -inst.amount, exp.currency)
        }
      }
    }

    // Quarterly tax payments
    for (const qp of allQuarterlyPayments) {
      if (qp.status === 'paid') continue
      if (!qp.estimatedDue || qp.estimatedDue <= 0) continue
      const due = quarterDueDate(qp.year, qp.quarter as 1 | 2 | 3 | 4)
      if (due.year !== y || due.month !== m) continue
      const bypasses = !affectsCash(qp.fundAccountId, accounts)
      events.push({
        label: `${qp.source} estimated tax Q${qp.quarter} ${qp.year}`,
        type: 'tax_payment',
        category: 'Tax',
        amountEUR: bypasses ? 0 : -toEUR(qp.estimatedDue, 'USD'),
        currency: 'USD',
        amountNative: -qp.estimatedDue,
        bypassesCash: bypasses,
      })
      if (!bypasses) addAccountDelta(qp.fundAccountId, -qp.estimatedDue, 'USD')
    }

    for (const settlement of taxConfig.settlements ?? []) {
      const [settleY, settleM] = settlement.date.split('-').map(Number)
      if (settleY !== y || settleM !== m) continue
      const sign = settlement.kind === 'refund' ? 1 : -1
      const bypasses = !affectsCash(settlement.accountId, accounts)
      const jurisdiction = settlement.jurisdiction === 'state'
        ? 'State'
        : settlement.jurisdiction === 'france'
          ? 'France'
          : 'Federal'
      events.push({
        label: `${jurisdiction} ${settlement.kind === 'refund' ? 'tax refund' : 'tax paid'} for ${settlement.taxYear}`,
        type: 'tax_payment',
        category: 'Tax',
        amountEUR: bypasses ? 0 : toEUR(settlement.amount, settlement.currency) * sign,
        currency: settlement.currency,
        amountNative: settlement.amount * sign,
        bypassesCash: bypasses,
      })
      if (!bypasses) addAccountDelta(settlement.accountId, settlement.amount * sign, settlement.currency)
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
      if (fromCash) addAccountDelta(tr.fromAccountId, -tr.amount, tr.currency)
      if (toCash) addAccountDelta(tr.toAccountId, tr.amount, tr.currency)

      const sign = toCash && !fromCash ? 1 : fromCash && !toCash ? -1 : 0
      if (sign === 0) continue  // cash-to-cash, neutral in total

      const amtEUR = toEUR(tr.amount, tr.currency)
      events.push({
        label: tr.name || 'Transfer',
        type: 'transfer',
        category: 'Transfer',
        amountEUR: amtEUR * sign,
        currency: tr.currency,
        amountNative: tr.amount * sign,
        accountNote: `${fromAcc?.name ?? '?'} → ${toAcc?.name ?? '?'}`,
        bypassesCash: false,
      })
    }

    // Quarterly dividend income (Mar, Jun, Sep, Dec) — reinvested in investment accounts, never hits cash
    if (annualDivEUR > 0 && [3, 6, 9, 12].includes(m)) {
      events.push({
        label: 'Dividends',
        type: 'dividend',
        category: 'Dividends',
        amountEUR: 0,
        currency: 'EUR',
        amountNative: annualDivEUR / 4,
        accountNote: divAccountNote,
        bypassesCash: true,
      })
    }

    const recurringNetEUR = monthlyIncome - monthlyBurn
    const netChange = recurringNetEUR + events.reduce((s, e) => s + e.amountEUR, 0)
    balance = opening + netChange

    let assignedDelta = 0
    for (const [id, delta] of accountDeltaEUR) {
      perAccountEUR.set(id, (perAccountEUR.get(id) ?? 0) + delta)
      assignedDelta += delta
    }
    const unassignedChange = netChange - assignedDelta

    // Distribute only flows without a configured account proportionally.
    if (opening > 0 && unassignedChange !== 0) {
      for (const [id, bal] of perAccountEUR) {
        perAccountEUR.set(id, bal + (bal / opening) * unassignedChange)
      }
    } else if (cashAccounts.length > 0 && unassignedChange !== 0) {
      const share = unassignedChange / cashAccounts.length
      for (const [id, bal] of perAccountEUR) {
        perAccountEUR.set(id, bal + share)
      }
    }

    const accountBalances: AccountBalance[] = cashAccounts.map(acc => ({
      id: acc.id,
      name: acc.name,
      currency: acc.currency.toUpperCase(),
      balanceEUR: perAccountEUR.get(acc.id) ?? 0,
    }))

    result.push({
      year: y,
      month: m,
      label: new Date(y, m - 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
      openingBalance: opening,
      recurringNetEUR,
      recurringBurnEUR: monthlyBurn,
      recurringIncomeEUR: monthlyIncome,
      recurringItems: recurringItems.sort((a, b) => b.amountEUR - a.amountEUR),
      recurringIncomeItems,
      events,
      closingBalance: balance,
      openingAccountBalances,
      accountBalances,
    })
  }

  return result
}

export function avgMonthlyBurn(projection: ProjectedMonth[]): number {
  const first3 = projection.slice(0, 3)
  if (first3.length === 0) return 0
  return first3.reduce((s, p) => s + Math.max(0, -p.recurringNetEUR), 0) / first3.length
}
