import type {
  Account,
  Country,
  PensionEstimate,
  TaxConfig,
  TaxFilingStatus,
  TaxTreatment,
  UserProfile,
  Windfall,
} from '../types'
import { DEFAULT_EUR_USD_RATE, convertToBase } from './currency'

const MONTHS_PER_YEAR = 12

export interface TaxLineItem {
  label: string
  amount: number
  currency: 'USD' | 'EUR'
  treatment: TaxTreatment
  sourceCountry?: Country
  sourceKind: 'pension' | 'income' | 'investment' | 'withdrawal'
  treatyExemptFR?: boolean
}

export interface TaxEstimate {
  totalEUR: number
  federalUSD: number
  stateUSD: number
  franceEUR: number
  federalEffectiveRate: number
  stateEffectiveRate: number
  franceEffectiveRate: number
  items: Array<{ label: string; amount: number; currency: 'USD' | 'EUR' }>
}

interface TaxBracket {
  upTo: number
  rate: number
}

const FEDERAL_2026_STANDARD_DEDUCTION: Record<TaxFilingStatus, number> = {
  single: 16_100,
  married_joint: 32_200,
  head_household: 24_150,
}

const FEDERAL_2026_ORDINARY: Record<TaxFilingStatus, TaxBracket[]> = {
  single: [
    { upTo: 12_400, rate: 0.10 },
    { upTo: 50_400, rate: 0.12 },
    { upTo: 105_700, rate: 0.22 },
    { upTo: 201_775, rate: 0.24 },
    { upTo: 256_225, rate: 0.32 },
    { upTo: 640_600, rate: 0.35 },
    { upTo: Infinity, rate: 0.37 },
  ],
  married_joint: [
    { upTo: 24_800, rate: 0.10 },
    { upTo: 100_800, rate: 0.12 },
    { upTo: 211_400, rate: 0.22 },
    { upTo: 403_550, rate: 0.24 },
    { upTo: 512_450, rate: 0.32 },
    { upTo: 768_700, rate: 0.35 },
    { upTo: Infinity, rate: 0.37 },
  ],
  head_household: [
    { upTo: 17_700, rate: 0.10 },
    { upTo: 67_450, rate: 0.12 },
    { upTo: 105_700, rate: 0.22 },
    { upTo: 201_775, rate: 0.24 },
    { upTo: 256_200, rate: 0.32 },
    { upTo: 640_600, rate: 0.35 },
    { upTo: Infinity, rate: 0.37 },
  ],
}

const FEDERAL_2026_LTCG: Record<TaxFilingStatus, TaxBracket[]> = {
  single: [
    { upTo: 49_450, rate: 0 },
    { upTo: 545_500, rate: 0.15 },
    { upTo: Infinity, rate: 0.20 },
  ],
  married_joint: [
    { upTo: 98_900, rate: 0 },
    { upTo: 613_700, rate: 0.15 },
    { upTo: Infinity, rate: 0.20 },
  ],
  head_household: [
    { upTo: 66_200, rate: 0 },
    { upTo: 579_600, rate: 0.15 },
    { upTo: Infinity, rate: 0.20 },
  ],
}

const CA_2026_STANDARD_DEDUCTION: Record<TaxFilingStatus, number> = {
  single: 5_706,
  married_joint: 11_412,
  head_household: 11_412,
}

// 2026 Form 540-ES instructs taxpayers to compute estimated tax using the 2025
// Form 540/540NR tax table. These are the official 2025 rate schedules.
const CA_2026_ORDINARY: Record<TaxFilingStatus, TaxBracket[]> = {
  single: [
    { upTo: 11_079, rate: 0.01 },
    { upTo: 26_264, rate: 0.02 },
    { upTo: 41_452, rate: 0.04 },
    { upTo: 57_542, rate: 0.06 },
    { upTo: 72_724, rate: 0.08 },
    { upTo: 371_479, rate: 0.093 },
    { upTo: 445_771, rate: 0.103 },
    { upTo: 742_953, rate: 0.113 },
    { upTo: 1_000_000, rate: 0.123 },
    { upTo: Infinity, rate: 0.133 },
  ],
  married_joint: [
    { upTo: 22_158, rate: 0.01 },
    { upTo: 52_528, rate: 0.02 },
    { upTo: 82_904, rate: 0.04 },
    { upTo: 115_084, rate: 0.06 },
    { upTo: 145_448, rate: 0.08 },
    { upTo: 742_958, rate: 0.093 },
    { upTo: 891_542, rate: 0.103 },
    { upTo: 1_000_000, rate: 0.113 },
    { upTo: 1_485_906, rate: 0.123 },
    { upTo: Infinity, rate: 0.133 },
  ],
  head_household: [
    { upTo: 22_173, rate: 0.01 },
    { upTo: 52_530, rate: 0.02 },
    { upTo: 67_716, rate: 0.04 },
    { upTo: 83_805, rate: 0.06 },
    { upTo: 98_990, rate: 0.08 },
    { upTo: 505_208, rate: 0.093 },
    { upTo: 606_251, rate: 0.103 },
    { upTo: 1_010_417, rate: 0.113 },
    { upTo: Infinity, rate: 0.123 },
  ],
}

const FR_2026_IR: TaxBracket[] = [
  { upTo: 11_600, rate: 0 },
  { upTo: 29_579, rate: 0.11 },
  { upTo: 84_577, rate: 0.30 },
  { upTo: 181_917, rate: 0.41 },
  { upTo: Infinity, rate: 0.45 },
]

function taxBreakdownItems(federalUSD: number, stateUSD: number, franceEUR: number): TaxEstimate['items'] {
  const items: TaxEstimate['items'] = [
    { label: 'US federal estimated tax', amount: federalUSD, currency: 'USD' },
    { label: 'California estimated tax', amount: stateUSD, currency: 'USD' },
    { label: 'France estimated tax', amount: franceEUR, currency: 'EUR' },
  ]
  return items.filter(item => item.amount > 0)
}

function progressiveTax(income: number, brackets: TaxBracket[]): number {
  let tax = 0
  let floor = 0
  const taxable = Math.max(0, income)
  for (const bracket of brackets) {
    const width = Math.max(0, Math.min(taxable, bracket.upTo) - floor)
    tax += width * bracket.rate
    if (taxable <= bracket.upTo) break
    floor = bracket.upTo
  }
  return tax
}

function longTermCapitalGainTax(gains: number, ordinaryTaxableIncome: number, brackets: TaxBracket[]): number {
  let tax = 0
  let taxedGain = 0
  let floor = 0
  const taxableGains = Math.max(0, gains)
  for (const bracket of brackets) {
    const bandStart = Math.max(floor, ordinaryTaxableIncome)
    const bandEnd = bracket.upTo
    const capacity = Math.max(0, bandEnd - bandStart)
    const amount = Math.min(capacity, taxableGains - taxedGain)
    tax += amount * bracket.rate
    taxedGain += amount
    if (taxedGain >= taxableGains) break
    floor = bracket.upTo
  }
  return tax
}

function defaultTaxProfile(taxConfig: TaxConfig): TaxConfig['taxProfile'] {
  const base: TaxConfig['taxProfile'] = {
    federalFilingStatus: 'married_joint',
    stateFilingStatus: 'married_joint',
    federalItemizedDeductionsUSD: 0,
    stateItemizedDeductionsUSD: 0,
    franceHouseholdParts: 2,
    franceDeductionEUR: 0,
    franceSocialRate: taxConfig.frCombinedEffectiveRate,
  }
  return { ...base, ...(taxConfig.taxProfile ?? {}) }
}

function federalDeduction(profile: TaxConfig['taxProfile']): number {
  return Math.max(FEDERAL_2026_STANDARD_DEDUCTION[profile.federalFilingStatus], profile.federalItemizedDeductionsUSD ?? 0)
}

function stateDeduction(profile: TaxConfig['taxProfile']): number {
  return Math.max(CA_2026_STANDARD_DEDUCTION[profile.stateFilingStatus], profile.stateItemizedDeductionsUSD ?? 0)
}

function isLongTermCapital(item: TaxLineItem): boolean {
  return item.treatment === 'CAPITAL_GAINS_LT'
}

function isOrdinaryTaxable(item: TaxLineItem): boolean {
  return item.treatment === 'ORDINARY_INCOME' || item.treatment === 'CAPITAL_GAINS_ST'
}

function emptyEstimate(): TaxEstimate {
  return {
    totalEUR: 0,
    federalUSD: 0,
    stateUSD: 0,
    franceEUR: 0,
    federalEffectiveRate: 0,
    stateEffectiveRate: 0,
    franceEffectiveRate: 0,
    items: [],
  }
}

function californiaMentalHealthTax(taxableIncome: number): number {
  return Math.max(0, taxableIncome - 1_000_000) * 0.01
}

function estimateTaxFromItems(
  items: TaxLineItem[],
  residency: Country,
  taxConfig: TaxConfig,
  usdPerEur: number,
): TaxEstimate {
  if (items.length === 0) return emptyEstimate()
  const profile = defaultTaxProfile(taxConfig)
  let usOrdinaryUSD = 0
  let usLongTermUSD = 0
  let stateTaxableUSD = 0
  let franceOrdinaryEUR = 0
  let franceInvestmentEUR = 0

  for (const item of items) {
    const amountUSD = Math.max(0, convertToBase(item.amount, item.currency, 'USD', usdPerEur))
    const amountEUR = Math.max(0, convertToBase(item.amount, item.currency, 'EUR', usdPerEur))
    if (isTaxableForUS(item)) {
      if (isLongTermCapital(item)) usLongTermUSD += amountUSD
      else if (isOrdinaryTaxable(item)) usOrdinaryUSD += amountUSD
    }
    if (residency === 'US' && isTaxableForUS(item)) {
      stateTaxableUSD += amountUSD
    }
    if (residency === 'FR' && isTaxableForFrance(item)) {
      if (item.sourceKind === 'investment') franceInvestmentEUR += amountEUR
      else franceOrdinaryEUR += amountEUR
    }
  }

  const totalUSTaxableUSD = usOrdinaryUSD + usLongTermUSD
  const totalFranceTaxableEUR = franceOrdinaryEUR + franceInvestmentEUR
  const federalOrdinaryTaxable = Math.max(0, usOrdinaryUSD - federalDeduction(profile))
  const federalUSD = progressiveTax(federalOrdinaryTaxable, FEDERAL_2026_ORDINARY[profile.federalFilingStatus])
    + longTermCapitalGainTax(usLongTermUSD, federalOrdinaryTaxable, FEDERAL_2026_LTCG[profile.federalFilingStatus])

  const stateTaxableAfterDeduction = Math.max(0, stateTaxableUSD - stateDeduction(profile))
  const stateUSD = residency === 'US'
    ? progressiveTax(stateTaxableAfterDeduction, CA_2026_ORDINARY[profile.stateFilingStatus])
      + californiaMentalHealthTax(stateTaxableAfterDeduction)
    : 0

  const parts = Math.max(1, profile.franceHouseholdParts || 1)
  const franceOrdinaryTaxable = Math.max(0, franceOrdinaryEUR - Math.max(0, profile.franceDeductionEUR ?? 0))
  const franceIR = progressiveTax(franceOrdinaryTaxable / parts, FR_2026_IR) * parts
  const franceSocial = franceInvestmentEUR * Math.max(0, profile.franceSocialRate ?? 0) / 100
  const franceEUR = residency === 'FR' ? franceIR + franceSocial : 0

  return {
    totalEUR: federalUSD / usdPerEur + stateUSD / usdPerEur + franceEUR,
    federalUSD,
    stateUSD,
    franceEUR,
    federalEffectiveRate: totalUSTaxableUSD > 0 ? federalUSD / totalUSTaxableUSD * 100 : 0,
    stateEffectiveRate: stateTaxableUSD > 0 ? stateUSD / stateTaxableUSD * 100 : 0,
    franceEffectiveRate: totalFranceTaxableEUR > 0 ? franceEUR / totalFranceTaxableEUR * 100 : 0,
    items: taxBreakdownItems(federalUSD, stateUSD, franceEUR),
  }
}

export function monthStart(date: string): string {
  return date.length >= 7 ? date.slice(0, 7) : `${date.slice(0, 4)}-01`
}

export function activeInMonth(startDate: string, endDate: string | null | undefined, month: string): boolean {
  const start = monthStart(startDate)
  const end = endDate ? monthStart(endDate) : '9999-12'
  return month >= start && month <= end
}

export function residencyCountryForMonth(profile: UserProfile, month: string): Country {
  const match = [...(profile.residencyPeriods ?? [])]
    .sort((a, b) => b.startDate.localeCompare(a.startDate))
    .find(period => activeInMonth(period.startDate, period.endDate, month))
  return match?.country ?? 'US'
}

export function annualResidencyShare(profile: UserProfile, year: number, country: Country): number {
  let months = 0
  for (let month = 1; month <= MONTHS_PER_YEAR; month++) {
    const ym = `${year}-${String(month).padStart(2, '0')}`
    if (residencyCountryForMonth(profile, ym) === country) months++
  }
  return months / MONTHS_PER_YEAR
}

function monthlyAmount(amount: number, frequency: string, eventMonth: string, currentMonth: string): number {
  if (frequency === 'monthly') return amount
  if (frequency === 'yearly') return currentMonth.endsWith(eventMonth.slice(5, 7)) ? amount : 0
  return currentMonth === eventMonth ? amount : 0
}

function sourceCountryFromCurrency(currency: string): Country {
  return currency.toUpperCase() === 'EUR' ? 'FR' : 'US'
}

function isCapitalGainTreatment(treatment: TaxTreatment): boolean {
  return treatment === 'CAPITAL_GAINS_LT' || treatment === 'CAPITAL_GAINS_ST'
}

function lotTreatment(acquiredDate: string | undefined, soldMonth: string, fallback: TaxTreatment): TaxTreatment {
  if (!acquiredDate || !isCapitalGainTreatment(fallback)) return fallback
  const acquired = new Date(acquiredDate)
  const sold = new Date(`${soldMonth}-01`)
  if (Number.isNaN(acquired.getTime()) || Number.isNaN(sold.getTime())) return fallback
  const oneYearMs = 365 * 24 * 60 * 60 * 1000
  return sold.getTime() - acquired.getTime() > oneYearMs ? 'CAPITAL_GAINS_LT' : 'CAPITAL_GAINS_ST'
}

function projectedAnnualDividendEURForAccount(account: Account, eurUsdRate: number): number {
  if (account.type !== 'investment' && account.type !== 'retirement') return 0
  if (account.holdings && account.holdings.length > 0) {
    return account.holdings.reduce((sum, holding) => {
      const securityType = holding.securityType.toLowerCase()
      const yieldPct = securityType === 'fixed income'
        ? 3.5
        : securityType === 'etf'
          ? 2
          : securityType === 'mutual fund' || securityType === 'equity'
            ? 1.8
            : securityType === 'cash'
              ? 0
              : 1.5
      return sum + convertToBase(holding.institutionValue, holding.currency, 'EUR', eurUsdRate) * yieldPct / 100
    }, 0)
  }
  return convertToBase(account.balance, account.currency, 'EUR', eurUsdRate) * 0.02
}

function isTaxableForUS(item: TaxLineItem): boolean {
  return item.treatment !== 'TAX_FREE'
}

function isTaxableForFrance(item: TaxLineItem): boolean {
  if (item.treatment === 'TAX_FREE' || item.treatyExemptFR) return false
  if (item.sourceKind === 'investment' && item.sourceCountry === 'US') return false
  return true
}

export function estimateMonthlyTaxEUR(
  items: TaxLineItem[],
  month: string,
  profile: UserProfile,
  taxConfig: TaxConfig,
  usdPerEur = DEFAULT_EUR_USD_RATE,
): TaxEstimate {
  const residency = residencyCountryForMonth(profile, month)
  return estimateTaxFromItems(items, residency, taxConfig, usdPerEur)
}

export function taxablePensionItemsForMonth(pensions: PensionEstimate[], month: string): TaxLineItem[] {
  const items: TaxLineItem[] = []
  for (const pension of pensions) {
    if (!activeInMonth(pension.startDate, pension.endDate, month)) continue
    const amount = monthlyAmount(pension.amount, pension.frequency, monthStart(pension.startDate), month)
    if (amount <= 0) continue
    items.push({
      label: pension.label,
      amount,
      currency: pension.currency,
      treatment: 'ORDINARY_INCOME',
      sourceCountry: pension.source === 'FR_RETRAITE' ? 'FR' : sourceCountryFromCurrency(pension.currency),
      sourceKind: 'pension',
      treatyExemptFR: pension.source === 'US_SS',
    })
  }
  return items
}

export function taxableWindfallItemsForMonth(windfalls: Windfall[], month: string, accounts: Account[] = []): TaxLineItem[] {
  const items: TaxLineItem[] = []
  const accountById = new Map(accounts.map(account => [account.id, account]))
  for (const windfall of windfalls) {
    if (!activeInMonth(windfall.date, windfall.endDate, month)) continue
    const amount = monthlyAmount(windfall.amount, windfall.frequency ?? 'one_time', monthStart(windfall.date), month)
    if (amount <= 0) continue
    const category = (windfall.category ?? '').toLowerCase()
    const sourceKind = category.includes('stock') || category.includes('dividend') || category.includes('interest')
      ? 'investment'
      : 'income'
    const sourceAccount = windfall.sourceAccountId != null ? accountById.get(windfall.sourceAccountId) : undefined
    if (isCapitalGainTreatment(windfall.taxTreatment) && windfall.realizedLots && windfall.realizedLots.length > 0) {
      for (const lot of windfall.realizedLots) {
        const gain = Math.max(0, lot.proceeds - lot.costBasis)
        if (gain <= 0) continue
        items.push({
          label: `${windfall.name}${lot.description ? ` - ${lot.description}` : ''}`,
          amount: gain,
          currency: lot.currency,
          treatment: lotTreatment(lot.acquiredDate, monthStart(windfall.date), windfall.taxTreatment),
          sourceCountry: sourceAccount?.taxCountry,
          sourceKind: 'investment',
        })
      }
      continue
    }
    items.push({
      label: windfall.name,
      amount,
      currency: windfall.currency,
      treatment: windfall.taxTreatment,
      sourceCountry: sourceAccount?.taxCountry ?? sourceCountryFromCurrency(windfall.currency),
      sourceKind,
    })
  }
  return items
}

export function estimateAnnualIncomeTaxes({
  year,
  profile,
  taxConfig,
  pensions,
  windfalls,
  accounts,
  usdPerEur = DEFAULT_EUR_USD_RATE,
}: {
  year: number
  profile: UserProfile
  taxConfig: TaxConfig
  pensions: PensionEstimate[]
  windfalls: Windfall[]
  accounts: Account[]
  usdPerEur?: number
}): TaxEstimate {
  const annualItems: TaxLineItem[] = []

  for (let month = 1; month <= MONTHS_PER_YEAR; month++) {
    const ym = `${year}-${String(month).padStart(2, '0')}`
    annualItems.push(
        ...taxablePensionItemsForMonth(pensions, ym),
        ...taxableWindfallItemsForMonth(windfalls, ym, accounts),
    )
  }

  for (const account of accounts) {
    const annualDividendsEUR = projectedAnnualDividendEURForAccount(account, usdPerEur)
    if (annualDividendsEUR <= 0) continue
    annualItems.push({
      label: `${account.name} dividends (est.)`,
      amount: annualDividendsEUR,
      currency: 'EUR',
      treatment: 'CAPITAL_GAINS_LT',
      sourceCountry: account.taxCountry,
      sourceKind: 'investment',
    })
  }

  for (const account of accounts) {
    if (!account.interestRate || account.interestRate <= 0 || account.balance <= 0) continue
    const amount = account.balance * account.interestRate / 100
    annualItems.push({
      label: `${account.name} interest`,
      amount,
      currency: account.currency.toUpperCase() === 'EUR' ? 'EUR' : 'USD',
      treatment: 'ORDINARY_INCOME',
      sourceCountry: account.taxCountry,
      sourceKind: 'investment',
    })
  }

  const residency = annualResidencyShare(profile, year, 'FR') >= 0.5 ? 'FR' : 'US'
  return estimateTaxFromItems(annualItems, residency, taxConfig, usdPerEur)
}
