// ─── Currencies & basic helpers ───────────────────────────────────────────────

export type Currency = 'USD' | 'EUR'
export type Country = 'US' | 'FR'
export type Person = 'self' | 'spouse'

// ─── Profile ──────────────────────────────────────────────────────────────────

export interface ResidencyPeriod {
  id: string
  startDate: string        // YYYY-MM
  endDate: string | null   // null = ongoing
  country: Country
}

export interface UserProfile {
  birthYear: number
  spouseBirthYear: number
  projectionEndAge: number
  baseCurrency: Currency
  residencyPeriods: ResidencyPeriod[]
  cobraMonthlyUSD: number
  cobraEndDate: string     // YYYY-MM
}

// ─── Accounts (synced from LunchMoney) ────────────────────────────────────────

export interface AssetAllocation {
  equity: number   // 0–100, rest is bonds+cash
  bonds: number
  cash: number
}

export type AccountType = 'investment' | 'retirement' | 'cash' | 'real_estate' | 'loan' | 'credit' | 'other'

export interface PlaidHolding {
  ticker: string | null
  name: string
  quantity: number
  institutionPrice: number     // live price from broker
  institutionValue: number     // total value
  costBasis: number | null     // original cost, if provided
  currency: string
  securityType: string         // 'equity' | 'etf' | 'mutual fund' | 'fixed income' | 'cash' | etc.
  purchaseDate?: string        // YYYY-MM-DD, most recent buy transaction date (from investment history)
}

export interface PlaidDividend {
  securityName: string
  ticker: string | null
  amount: number
  currency: string
  date: string                 // YYYY-MM-DD
}

export interface Account {
  id: number             // LunchMoney account ID
  lmId: number
  name: string
  balance: number
  currency: string       // ISO 4217, e.g. "usd", "eur"
  type: AccountType
  typeOverridden?: boolean        // true when user manually set the type (preserved on re-sync)
  allocation: AssetAllocation
  syncedAt: string       // ISO timestamp
  isManual: boolean
  includedInPlanning?: boolean    // false to exclude from net worth / simulation (default true)
  interestRate?: number  // % APY, for cash/loan accounts
  dueDate?: number       // day of month (1–31), for credit accounts

  // Plaid Integration
  plaidItemId?: string
  plaidAccessToken?: string
  holdings?: PlaidHolding[]
  dividends?: PlaidDividend[]

  // Multi-currency override (e.g. IBKR reports all cash as CUR:USD but holds EUR too)
  fxSplitEUR?: number     // EUR amount held in this account (absolute, not a %)
  fxSplitEURRef?: number  // reference balance (CUR:USD value or total balance) when fxSplitEUR was last set — used to detect stale values
}

// ─── Pensions ─────────────────────────────────────────────────────────────────

export type PensionSource = 'US_SS' | 'FR_RETRAITE' | 'OTHER'

export interface PensionEstimate {
  id: string
  source: PensionSource
  label: string
  person: Person
  amount: number
  currency: Currency
  frequency: ExpenseFrequency
  startDate: string
  endDate: string | null
  startAge?: number // legacy or used as a hint
  targetAccountId?: number   // which account receives these deposits
}

// ─── Real estate ──────────────────────────────────────────────────────────────

export type RealEstateEventType = 'sell' | 'buy' | 'rent'

export interface RealEstateEvent {
  id: string
  eventType: RealEstateEventType
  date: string           // YYYY-MM
  amount: number         // net proceeds for sell/buy; monthly rent for rent
  currency: Currency
  isRecurring: boolean   // true for rent (monthly outflow)
  endDate: string | null // for rent periods
  notes: string
  targetAccountId?: number  // sell: where proceeds land; buy: n/a
  sourceAccountId?: number  // buy/rent: which account funds the payment
}

// ─── Expenses ─────────────────────────────────────────────────────────────────

export type ExpenseFrequency = 'monthly' | 'yearly' | 'one_time' | 'custom'

export interface ExpenseInstallment {
  date: string    // YYYY-MM
  amount: number
}

export interface Expense {
  id: string
  name: string
  amount: number          // total budget (reference); for custom, sum of installments
  frequency: ExpenseFrequency
  currency: Currency
  startDate: string      // YYYY-MM (first installment date for custom)
  endDate: string | null
  category: string
  sourceAccountId?: number
  installments?: ExpenseInstallment[]  // only for frequency === 'custom'
}

// ─── Windfalls ────────────────────────────────────────────────────────────────

export type TaxTreatment = 'CAPITAL_GAINS_LT' | 'CAPITAL_GAINS_ST' | 'ORDINARY_INCOME' | 'TAX_FREE'

export interface Windfall {
  id: string
  name: string
  date: string           // YYYY or YYYY-MM (startDate for recurring)
  endDate?: string | null
  frequency: ExpenseFrequency  // default 'one_time'
  amount: number
  currency: Currency
  taxTreatment: TaxTreatment
  category?: string      // e.g. 'Stock sale', 'Rental income', 'Gift'
  targetAccountId?: number  // which account receives the proceeds
}

// ─── Monte Carlo ──────────────────────────────────────────────────────────────

export interface MonteCarloConfig {
  equityMeanReturn: number    // % real return
  equityStdDev: number
  bondMeanReturn: number
  bondStdDev: number
  inflationEUR: number
  eurUsdDrift: number
  eurUsdVolatility: number
  numSimulations: number
  successThreshold: number   // 0–100
}

// ─── Tax ──────────────────────────────────────────────────────────────────────

export type PaymentStatus = 'paid' | 'todo' | 'none'

export interface QuarterlyPayment {
  year: number
  quarter: 1 | 2 | 3 | 4
  amountPaid: number | null
  estimatedDue: number | null
  status?: PaymentStatus
  fundAccountId?: number   // which account funds this payment (if non-cash, bypasses cash flow)
}

export interface TaxConfig {
  usFederalEffectiveRate: number
  usCaliforniaEffectiveRate: number
  frCombinedEffectiveRate: number
  /** Federal (IRS) quarterly estimated payments */
  quarterlyPayments: QuarterlyPayment[]
  /** California FTB quarterly estimated payments */
  stateQuarterlyPayments: QuarterlyPayment[]
}

// ─── Health ───────────────────────────────────────────────────────────────────

export interface MedicalCoverage {
  id: string
  name: string
  amount: number
  frequency: ExpenseFrequency
  currency: Currency
  startDate: string      // YYYY-MM
  endDate: string | null
  sourceAccountId?: number
  installments?: ExpenseInstallment[]
}

export interface MedicalExpense {
  id: string
  name: string
  amount: number
  frequency: ExpenseFrequency
  currency: Currency
  startDate: string      // YYYY-MM
  endDate: string | null
  category: string
  sourceAccountId?: number
  installments?: ExpenseInstallment[]
}

// ─── Transfers ────────────────────────────────────────────────────────────────

export type TransferFrequency = 'once' | 'monthly' | 'yearly'

export interface Transfer {
  id: string
  name: string
  fromAccountId: number
  toAccountId: number
  amount: number
  currency: Currency
  frequency: TransferFrequency
  startDate: string      // YYYY-MM
  endDate?: string | null  // for recurring transfers
}

// ─── Simulation results (runtime, not persisted) ──────────────────────────────

export interface SimulationResult {
  successRate: number                          // 0–100
  medianNetWorth: number[]                     // one per year
  p10NetWorth: number[]
  p90NetWorth: number[]
  years: number[]                              // calendar years
  safeMonthlySpend: number                     // in base currency
}
