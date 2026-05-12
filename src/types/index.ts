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
  spouseProjectionEndAge: number
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

export interface TaxLot {
  id: string
  ticker: string | null
  name: string
  quantity: number
  marketValue: number
  costBasis: number | null
  currency: string
  acquiredDate?: string
  source: 'plaid' | 'ibkr-flex'
}

export interface PlaidDividend {
  securityName: string
  ticker: string | null
  amount: number
  currency: string
  date: string                 // YYYY-MM-DD
}

export type InvestmentEventType = 'buy' | 'sell' | 'transfer_in' | 'transfer_out'

export interface InvestmentEvent {
  date: string           // YYYY-MM-DD
  type: InvestmentEventType
  ticker: string | null
  name: string
  amount: number         // absolute amount in account native currency
  currency: string
  quantity?: number
}

export interface Account {
  id: number             // LunchMoney account ID
  lmId: number
  name: string
  institutionName?: string
  balance: number
  currency: string       // ISO 4217, e.g. "usd", "eur"
  type: AccountType
  typeOverridden?: boolean        // true when user manually set the type (preserved on re-sync)
  allocation: AssetAllocation
  syncedAt: string       // ISO timestamp
  isManual: boolean
  includedInPlanning?: boolean    // false to exclude from net worth / simulation (default true)
  taxCountry?: Country            // Account domicile/source country for tax modeling; user-controlled
  interestRate?: number  // % APY, for cash/loan accounts
  dueDate?: number       // day of month (1–31), for credit accounts

  // Plaid Integration
  plaidItemId?: string
  plaidAccessToken?: string
  ibkrAccountId?: string
  holdings?: PlaidHolding[]
  dividends?: PlaidDividend[]
  investmentEvents?: InvestmentEvent[]
  taxLots?: TaxLot[]
  navHistory?: Array<{ date: string; value: number }>  // daily NAV from IBKR EquitySummaryByReportDateInBase

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
  targetAccountId?: number             // sell: where proceeds land; buy: n/a
  sourceAccountId?: number             // buy/rent: which account funds the payment
  sourceRealEstateAccountId?: number   // sell: the RE account representing the property being sold
  sourceMortgageAccountId?: number     // sell: the mortgage account being paid off at closing
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

export interface RealizedGainLot {
  id: string
  description: string
  proceeds: number
  costBasis: number
  currency: Currency
  acquiredDate?: string
}

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
  sourceAccountId?: number  // account/holding source for tax domicile and basis tracking
  realizedLots?: RealizedGainLot[]
}

// ─── Success simulation ───────────────────────────────────────────────────────

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
  frenchTaxRate: number      // % effective rate on taxable portfolio withdrawals
  taxableWithdrawalShare: number // 0-100, rough share of withdrawals exposed to FR tax
  annualTaxAllowanceEUR: number
  cashYieldMultiplier: number // 0-100, share of Treasury yield credited to cash
  fallbackUsdEurRate: number  // USD per EUR when no FRED FX series exists
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

export interface TaxSettlement {
  id: string
  jurisdiction?: 'federal' | 'state' | 'france'
  taxYear: number
  date: string
  amount: number
  currency: Currency
  kind: 'payment' | 'refund'
  accountId?: number
}

export type TaxFilingStatus = 'single' | 'married_joint' | 'head_household'

export interface TaxProfile {
  federalFilingStatus: TaxFilingStatus
  stateFilingStatus: TaxFilingStatus
  federalItemizedDeductionsUSD: number
  stateItemizedDeductionsUSD: number
  franceHouseholdParts: number
  franceDeductionEUR: number
  franceSocialRate: number
}

export interface TaxConfig {
  usFederalEffectiveRate: number
  usCaliforniaEffectiveRate: number
  frCombinedEffectiveRate: number
  taxProfile: TaxProfile
  /** Federal (IRS) quarterly estimated payments */
  quarterlyPayments: QuarterlyPayment[]
  /** California FTB quarterly estimated payments */
  stateQuarterlyPayments: QuarterlyPayment[]
  /** Cash tax payments/refunds filed for prior years */
  settlements: TaxSettlement[]
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
  liquidSuccessRate: number                    // 0-100 (liquid NW > 0)
  medianNetWorth: number[]                     // one per year
  p10NetWorth: number[]
  p90NetWorth: number[]
  realEstateNetWorth: number[]                 // one per year
  years: number[]                              // calendar years
  safeMonthlySpend: number                     // in base currency
  cohortCount?: number
  historicalStartMonth?: string
  historicalEndMonth?: string
  worstCohortStart?: string
  firstFailureMonth?: number | null
  engine?: 'historical-sequential'
  dataSources?: string[]
  warnings?: string[]
  durationMonths?: number
  cohortSummaries?: Array<{
    startMonth: string
    survived: boolean
    firstFailureMonth: number | null
    endingNetWorth: number
    yearlyInputs: Array<{
      year: number
      cohortYear: number
      liquidNetWorth: number
      netFlowEUR: number
      inflationPct: number
      equityReturnPct: number
      portfolioReturnPct: number
      treasuryYieldAnnual: number
    }>
  }>
  historicalInputs?: Array<{
    month: string
    cpi: number
    equityReturn: number
    treasuryYieldAnnual: number
    usdPerEur: number | null
  }>
}

export interface HistoricalMonthlyPoint {
  month: string
  etfReturns?: Record<string, number>
  treasuryYieldAnnual?: number
  usdPerEur?: number
  cpiByCountry?: Partial<Record<Country, number>>
}

export interface HistoricalMarketData {
  monthly: HistoricalMonthlyPoint[]
  dataSources: string[]
  warnings: string[]
}
