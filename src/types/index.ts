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
}

// ─── Pensions ─────────────────────────────────────────────────────────────────

export type PensionSource = 'US_SS' | 'FR_CNAV' | 'FR_AGIRC' | 'OTHER'

export interface PensionEstimate {
  id: string
  source: PensionSource
  label: string
  person: Person
  monthlyAmount: number
  currency: Currency
  startAge: number
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
}

// ─── Expenses ─────────────────────────────────────────────────────────────────

export type ExpenseFrequency = 'monthly' | 'yearly' | 'one_time'

export interface Expense {
  id: string
  name: string
  amount: number
  frequency: ExpenseFrequency
  currency: Currency
  startDate: string      // YYYY-MM
  endDate: string | null
  category: string
}

// ─── Windfalls ────────────────────────────────────────────────────────────────

export type TaxTreatment = 'CAPITAL_GAINS_LT' | 'CAPITAL_GAINS_ST' | 'ORDINARY_INCOME' | 'TAX_FREE'

export interface Windfall {
  id: string
  name: string
  date: string           // YYYY
  amount: number
  currency: Currency
  taxTreatment: TaxTreatment
  notes: string
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
