// Historical sequential backtesting engine.
// Keeps the old worker filename/API so the Overview page can swap engines cleanly.

import shillerCsv from '../data/shiller-data-table-1.csv?raw'
import type {
  Account,
  Expense,
  HistoricalMarketData,
  MonteCarloConfig,
  PensionEstimate,
  RealEstateEvent,
  Transfer,
  UserProfile,
  Windfall,
  Country,
  TaxConfig,
} from '../types'
import { soldAccountIdsBy } from '../lib/accountLifecycle'
import {
  estimateMonthlyTaxEUR,
  residencyCountryForMonth,
  taxablePensionItemsForMonth,
  taxableWindfallItemsForMonth,
} from '../lib/tax'

export interface MCInput {
  config: MonteCarloConfig
  taxConfig: TaxConfig
  profile: UserProfile
  accounts: Account[]
  expenses: Expense[]
  pensions: PensionEstimate[]
  windfalls: Windfall[]
  realEstateEvents: RealEstateEvent[]
  transfers: Transfer[]
  eurUsdSpot: number
  historicalMarketData?: HistoricalMarketData
}

export interface MCOutput {
  successRate: number
  liquidSuccessRate: number
  medianNetWorth: number[]
  p10NetWorth: number[]
  p90NetWorth: number[]
  realEstateNetWorth: number[]
  years: number[]
  safeMonthlySpend: number
  cohortCount: number
  historicalStartMonth: string
  historicalEndMonth: string
  worstCohortStart: string
  firstFailureMonth: number | null
  engine: 'historical-sequential'
  dataSources: string[]
  warnings: string[]
  durationMonths: number
  cohortSummaries: Array<{
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
  historicalInputs: Array<{
    month: string
    cpi: number
    equityReturn: number
    treasuryYieldAnnual: number
    usdPerEur: number | null
  }>
}

interface HistoricalMonth {
  month: string
  cpi: number
  equityReturn: number
  treasuryYieldAnnual: number
  usdPerEur?: number
  etfReturns?: Record<string, number>
  cpiByCountry?: Partial<Record<Country, number>>
}

interface StartingState {
  liquidUSD: number
  cashEUR: number
  cashUSD: number
  realEstateEUR: number
  equityWeight: number
  bondWeight: number
  cashWeight: number
  tickerWeights: Record<string, number>
}

interface CohortRun {
  startMonth: string
  survived: boolean
  firstFailureMonth: number | null
  endingNetWorth: number
  yearlyNetWorth: number[]
  yearlyRealEstate: number[]
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
}

const MONTHS_PER_YEAR = 12

function parseNumber(raw: string | undefined): number | null {
  if (!raw) return null
  const cleaned = raw.replace(/"/g, '').replace(/\t/g, '').trim()
  if (!cleaned || cleaned === 'NA') return null
  const value = Number(cleaned.replace(/,/g, ''))
  return Number.isFinite(value) ? value : null
}

function parseMonth(raw: string): string | null {
  const cleaned = raw.replace(/"/g, '').trim()
  const [yearPart, monthPart] = cleaned.split('.')
  const year = Number(yearPart)
  if (!Number.isFinite(year) || !monthPart) return null
  const month = monthPart.length === 1 ? Number(monthPart) * 10 : Number(monthPart)
  if (!Number.isFinite(month) || month < 1 || month > 12) return null
  return `${year}-${String(month).padStart(2, '0')}`
}

function parseCsvLine(line: string): string[] {
  const cols: string[] = []
  let current = ''
  let quoted = false

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"'
        i++
      } else {
        quoted = !quoted
      }
    } else if (ch === ',' && !quoted) {
      cols.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  cols.push(current)
  return cols
}

function parseShillerData(csv: string): HistoricalMonth[] {
  const lines = csv.split(/\r?\n/)
  const headerIndex = lines.findIndex(line => line.startsWith('Date,P,D,E,CPI'))
  if (headerIndex < 0) return []

  const rows: Array<{ month: string; cpi: number; trPrice: number; treasuryYieldAnnual: number }> = []
  for (const line of lines.slice(headerIndex + 1)) {
    if (!line.trim()) continue
    const cols = parseCsvLine(line)
    const month = parseMonth(cols[0] ?? '')
    const cpi = parseNumber(cols[4])
    const treasuryYieldAnnual = parseNumber(cols[6])
    const trPrice = parseNumber(cols[9])
    if (!month || cpi == null || trPrice == null || treasuryYieldAnnual == null) continue
    rows.push({ month, cpi, trPrice, treasuryYieldAnnual })
  }

  return rows.slice(1).map((row, index) => {
    const prev = rows[index]
    return {
      month: row.month,
      cpi: row.cpi,
      equityReturn: prev.trPrice > 0 ? row.trPrice / prev.trPrice - 1 : 0,
      treasuryYieldAnnual: row.treasuryYieldAnnual,
    }
  })
}

function composeHistory(
  shillerHistory: HistoricalMonth[],
  overrides?: HistoricalMarketData,
): { history: HistoricalMonth[]; dataSources: string[]; warnings: string[] } {
  const overrideByMonth = new Map((overrides?.monthly ?? []).map(point => [point.month, point]))
  const hasEtfReturns = (overrides?.monthly ?? []).some(point => point.etfReturns && Object.keys(point.etfReturns).length > 0)
  const hasTreasury = (overrides?.monthly ?? []).some(point => point.treasuryYieldAnnual != null)
  const hasFx = (overrides?.monthly ?? []).some(point => point.usdPerEur != null)
  const dataSources = [...(overrides?.dataSources ?? []), 'Shiller CPI']
  const warnings = [...(overrides?.warnings ?? [])]

  const history = shillerHistory
    .map(row => {
      const override = overrideByMonth.get(row.month)
      return {
        ...row,
        cpi: override?.cpiByCountry?.FR ?? override?.cpiByCountry?.US ?? row.cpi,
        cpiByCountry: override?.cpiByCountry,
        treasuryYieldAnnual: override?.treasuryYieldAnnual ?? row.treasuryYieldAnnual,
        usdPerEur: override?.usdPerEur,
        etfReturns: override?.etfReturns,
      }
    })

  if (hasEtfReturns) dataSources.push('Tiingo adjusted-close monthly total returns')
  else warnings.push('Equity returns use Shiller S&P total-return proxy.')
  if (hasTreasury) dataSources.push('FRED DGS10 Treasury yield')
  else warnings.push('Treasury yields use Shiller GS10.')
  if (hasFx) dataSources.push('FRED EXUSEU USD/EUR exchange rate')
  else warnings.push('FX uses fallback USD/EUR spot plus configured drift.')

  return { history, dataSources: [...new Set(dataSources)], warnings: [...new Set(warnings)] }
}

function configWithDefaults(config: MonteCarloConfig, eurUsdSpot: number): MonteCarloConfig {
  return {
    ...config,
    inflationEUR: config.inflationEUR ?? 2.5,
    eurUsdDrift: config.eurUsdDrift ?? 0,
    successThreshold: config.successThreshold ?? 90,
    frenchTaxRate: config.frenchTaxRate ?? 17.2,
    taxableWithdrawalShare: config.taxableWithdrawalShare ?? 60,
    annualTaxAllowanceEUR: config.annualTaxAllowanceEUR ?? 0,
    cashYieldMultiplier: config.cashYieldMultiplier ?? 75,
    fallbackUsdEurRate: config.fallbackUsdEurRate ?? eurUsdSpot,
  }
}

function toEUR(amount: number, currency: string, usdPerEur: number): number {
  return currency.toUpperCase() === 'USD' ? amount / usdPerEur : amount
}

function toUSD(amount: number, currency: string, usdPerEur: number): number {
  return currency.toUpperCase() === 'EUR' ? amount * usdPerEur : amount
}

function startOfMonth(date: string): string {
  return date.length >= 7 ? date.slice(0, 7) : `${date.slice(0, 4)}-01`
}

function addMonths(month: string, offset: number): string {
  const [year, monthNum] = month.split('-').map(Number)
  const date = new Date(year, monthNum - 1 + offset, 1)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function activeInMonth(startDate: string, endDate: string | null | undefined, month: string): boolean {
  const start = startOfMonth(startDate)
  const end = endDate ? startOfMonth(endDate) : '9999-12'
  return month >= start && month <= end
}

function cpiForCountry(hist: HistoricalMonth | null | undefined, country: Country): number | null {
  if (!hist) return null
  return hist.cpiByCountry?.[country] ?? hist.cpi
}

function monthlyAmount(amount: number, frequency: string, eventMonth: string, currentMonth: string): number {
  if (frequency === 'monthly') return amount
  if (frequency === 'yearly') return currentMonth.endsWith(eventMonth.slice(5, 7)) ? amount : 0
  return currentMonth === eventMonth ? amount : 0
}

function transferActiveInMonth(transfer: Transfer, month: string): boolean {
  if (transfer.frequency === 'once') return month === startOfMonth(transfer.startDate)
  return activeInMonth(transfer.startDate, transfer.endDate, month) &&
    (transfer.frequency === 'monthly' || month.endsWith(startOfMonth(transfer.startDate).slice(5, 7)))
}

function applyBucketDelta(
  account: Account | undefined,
  amount: number,
  currency: string,
  usdPerEur: number,
  state: { liquidUSD: number; cashEUR: number; cashUSD: number; realEstateEUR: number },
) {
  if (!account || amount === 0) {
    state.liquidUSD += toUSD(amount, currency, usdPerEur)
    return
  }
  const accountCurrency = account.currency.toUpperCase()
  if (account.type === 'cash') {
    if (accountCurrency === 'EUR') state.cashEUR += toEUR(amount, currency, usdPerEur)
    else state.cashUSD += toUSD(amount, currency, usdPerEur)
  } else if (account.type === 'real_estate') {
    state.realEstateEUR += toEUR(amount, currency, usdPerEur)
  } else if (account.type !== 'credit' && account.type !== 'loan') {
    state.liquidUSD += toUSD(amount, currency, usdPerEur)
  }
}

function buildStartingState(accounts: Account[], realEstateEvents: RealEstateEvent[], startYear: number, usdPerEur: number): StartingState {
  const currentMonth = `${startYear}-${String(new Date().getMonth() + 1).padStart(2, '0')}`
  const soldIds = soldAccountIdsBy(currentMonth, realEstateEvents)
  let liquidUSD = 0
  let cashEUR = 0
  let cashUSD = 0
  let realEstateEUR = 0
  let weightedEquity = 0
  let weightedBonds = 0
  let weightedCash = 0
  let allocBaseUSD = 0
  const tickerValues: Record<string, number> = {}

  for (const acc of accounts) {
    if (soldIds.has(acc.id) || acc.type === 'credit' || acc.type === 'loan') continue
    const currency = acc.currency.toUpperCase()
    if (acc.type === 'real_estate') {
      realEstateEUR += toEUR(acc.balance, currency, usdPerEur)
      continue
    }

    if (acc.type === 'cash') {
      if (currency === 'EUR') cashEUR += acc.balance
      else cashUSD += toUSD(acc.balance, currency, usdPerEur)
      continue
    }

    const valueUSD = toUSD(acc.balance, currency, usdPerEur)
    liquidUSD += valueUSD
    allocBaseUSD += Math.max(0, valueUSD)
    weightedEquity += Math.max(0, valueUSD) * ((acc.allocation?.equity ?? 70) / 100)
    weightedBonds += Math.max(0, valueUSD) * ((acc.allocation?.bonds ?? 20) / 100)
    weightedCash += Math.max(0, valueUSD) * ((acc.allocation?.cash ?? 10) / 100)

    if (['investment', 'retirement'].includes(acc.type)) {
      for (const holding of acc.holdings ?? []) {
        const ticker = holding.ticker?.toUpperCase()
        if (!ticker || ticker.startsWith('CUR:')) continue
        tickerValues[ticker] = (tickerValues[ticker] ?? 0) + Math.max(0, toUSD(holding.institutionValue, holding.currency, usdPerEur))
      }
    }
  }

  const equityWeight = allocBaseUSD > 0 ? weightedEquity / allocBaseUSD : 0.7
  const bondWeight = allocBaseUSD > 0 ? weightedBonds / allocBaseUSD : 0.2
  const cashWeight = Math.max(0, 1 - equityWeight - bondWeight) || (allocBaseUSD > 0 ? weightedCash / allocBaseUSD : 0.1)
  const tickerTotal = Object.values(tickerValues).reduce((sum, value) => sum + value, 0)
  const tickerWeights = Object.fromEntries(
    Object.entries(tickerValues).map(([ticker, value]) => [ticker, tickerTotal > 0 ? value / tickerTotal : 0]),
  )

  return { liquidUSD, cashEUR, cashUSD, realEstateEUR, equityWeight, bondWeight, cashWeight, tickerWeights }
}

function applyTaxGrossUp(deficitEUR: number, input: MCInput, simMonth: string): number {
  if (deficitEUR <= 0) return 0
  if (residencyCountryForMonth(input.profile, simMonth) !== 'FR') return deficitEUR
  const taxableShare = Math.min(1, Math.max(0, input.config.taxableWithdrawalShare / 100))
  const configuredRate = input.taxConfig.taxProfile?.franceSocialRate ?? input.taxConfig.frCombinedEffectiveRate
  const rate = Math.min(0.95, Math.max(0, configuredRate / 100))
  const allowance = Math.max(0, input.config.annualTaxAllowanceEUR / MONTHS_PER_YEAR)
  const taxableDeficit = Math.max(0, deficitEUR - allowance) * taxableShare
  return deficitEUR + taxableDeficit * rate
}

function monthlyFlowsEUR(input: MCInput, simMonth: string, usdPerEur: number, cpiFactor: number, extraSpendEUR: number): number {
  const { expenses, pensions, windfalls, realEstateEvents } = input
  let flow = -extraSpendEUR * cpiFactor

  for (const pension of pensions) {
    if (!activeInMonth(pension.startDate, pension.endDate, simMonth)) continue
    const amount = monthlyAmount(pension.amount, pension.frequency, startOfMonth(pension.startDate), simMonth)
    flow += toEUR(amount, pension.currency, usdPerEur)
  }

  for (const windfall of windfalls) {
    const eventMonth = startOfMonth(windfall.date)
    if (simMonth === eventMonth) flow += toEUR(windfall.amount, windfall.currency, usdPerEur)
  }

  for (const event of realEstateEvents) {
    if (event.eventType === 'rent' && event.isRecurring && activeInMonth(event.date, event.endDate, simMonth)) {
      flow -= toEUR(event.amount, event.currency, usdPerEur) * cpiFactor
    }
  }

  for (const expense of expenses) {
    if (!activeInMonth(expense.startDate, expense.endDate, simMonth)) continue
    const eventMonth = startOfMonth(expense.startDate)
    const amount = monthlyAmount(expense.amount, expense.frequency, eventMonth, simMonth)
    flow -= toEUR(amount, expense.currency, usdPerEur) * cpiFactor
  }

  for (const settlement of input.taxConfig.settlements ?? []) {
    if (startOfMonth(settlement.date) !== simMonth) continue
    const sign = settlement.kind === 'refund' ? 1 : -1
    flow += toEUR(settlement.amount, settlement.currency, usdPerEur) * sign
  }

  const taxSourceMonth = addMonths(simMonth, -MONTHS_PER_YEAR)
  const taxEstimate = estimateMonthlyTaxEUR(
    [
      ...taxablePensionItemsForMonth(pensions, taxSourceMonth),
      ...taxableWindfallItemsForMonth(windfalls, taxSourceMonth, input.accounts),
    ],
    taxSourceMonth,
    input.profile,
    input.taxConfig,
    usdPerEur,
  )
  flow -= taxEstimate.totalEUR

  return flow
}

function applyAccountEvents(
  input: MCInput,
  simMonth: string,
  usdPerEur: number,
  liquidUSD: number,
  cashEUR: number,
  cashUSD: number,
  realEstateEUR: number,
): { liquidUSD: number; cashEUR: number; cashUSD: number; realEstateEUR: number; liquidEventFlowEUR: number } {
  const accountById = new Map(input.accounts.map(account => [account.id, account]))
  const beforeLiquidEUR = liquidUSD / usdPerEur + cashUSD / usdPerEur + cashEUR

  for (const event of input.realEstateEvents) {
    if (startOfMonth(event.date) !== simMonth) continue
    if (event.eventType === 'sell') {
      const source = event.sourceRealEstateAccountId != null ? accountById.get(event.sourceRealEstateAccountId) : undefined
      const target = event.targetAccountId != null ? accountById.get(event.targetAccountId) : undefined
      const sourceValueEUR = source ? toEUR(source.balance, source.currency, usdPerEur) : toEUR(event.amount, event.currency, usdPerEur)
      realEstateEUR = Math.max(0, realEstateEUR - sourceValueEUR)
      const state = { liquidUSD, cashEUR, cashUSD, realEstateEUR }
      applyBucketDelta(target, event.amount, event.currency, usdPerEur, state)
      liquidUSD = state.liquidUSD
      cashEUR = state.cashEUR
      cashUSD = state.cashUSD
      realEstateEUR = state.realEstateEUR
    } else if (event.eventType === 'buy') {
      const source = event.sourceAccountId != null ? accountById.get(event.sourceAccountId) : undefined
      const state = { liquidUSD, cashEUR, cashUSD, realEstateEUR }
      applyBucketDelta(source, -event.amount, event.currency, usdPerEur, state)
      state.realEstateEUR += toEUR(event.amount, event.currency, usdPerEur)
      liquidUSD = state.liquidUSD
      cashEUR = state.cashEUR
      cashUSD = state.cashUSD
      realEstateEUR = state.realEstateEUR
    }
  }

  for (const transfer of input.transfers ?? []) {
    if (!transferActiveInMonth(transfer, simMonth)) continue
    const from = accountById.get(transfer.fromAccountId)
    const to = accountById.get(transfer.toAccountId)
    const state = { liquidUSD, cashEUR, cashUSD, realEstateEUR }
    applyBucketDelta(from, -transfer.amount, transfer.currency, usdPerEur, state)
    applyBucketDelta(to, transfer.amount, transfer.currency, usdPerEur, state)
    liquidUSD = state.liquidUSD
    cashEUR = state.cashEUR
    cashUSD = state.cashUSD
    realEstateEUR = Math.max(0, state.realEstateEUR)
  }

  const afterLiquidEUR = liquidUSD / usdPerEur + cashUSD / usdPerEur + cashEUR
  return { liquidUSD, cashEUR, cashUSD, realEstateEUR, liquidEventFlowEUR: afterLiquidEUR - beforeLiquidEUR }
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * p)))]
}

function equityReturnForMonth(hist: HistoricalMonth, startingState: StartingState): number {
  const entries = Object.entries(startingState.tickerWeights)
  if (!hist.etfReturns || entries.length === 0) return hist.equityReturn

  let coveredWeight = 0
  let weightedReturn = 0
  for (const [ticker, weight] of entries) {
    const tickerReturn = hist.etfReturns[ticker]
    if (tickerReturn == null || !Number.isFinite(tickerReturn)) continue
    coveredWeight += weight
    weightedReturn += weight * tickerReturn
  }

  return weightedReturn + Math.max(0, 1 - coveredWeight) * hist.equityReturn
}

function runCohort(
  input: MCInput,
  history: HistoricalMonth[],
  startIndex: number,
  durationMonths: number,
  startingState: StartingState,
  extraSpendEUR: number,
  simulationStartMonth: string,
  collectYearly = true,
): CohortRun {
  const { config } = input
  let liquidUSD = startingState.liquidUSD
  let cashEUR = startingState.cashEUR
  let cashUSD = startingState.cashUSD
  let realEstateEUR = startingState.realEstateEUR
  let usdPerEur = history[startIndex].usdPerEur ?? config.fallbackUsdEurRate
  const startCpi = history[startIndex]?.cpi || 1
  const startMonth = history[startIndex].month
  const yearlyNetWorth: number[] = []
  const yearlyRealEstate: number[] = []
  const yearlyInputs: CohortRun['yearlyInputs'] = []
  let expenseInflationFactor = 1
  let annualInflationFactor = 1
  let annualEquityFactor = 1
  let annualPortfolioFactor = 1
  let annualNetFlowEUR = 0
  let annualTreasuryTotal = 0
  let annualMonthCount = 0
  let firstFailureMonth: number | null = null

  for (let mi = 0; mi < durationMonths; mi++) {
    const hist = history[startIndex + mi]
    const prev = mi > 0 ? history[startIndex + mi - 1] : null
    const calendarMonth = addMonths(simulationStartMonth, mi)
    const residencyCountry = residencyCountryForMonth(input.profile, calendarMonth)
    const currentCpi = cpiForCountry(hist, residencyCountry)
    const previousCpi = cpiForCountry(prev, residencyCountry)
    const monthlyInflationFactor = currentCpi && previousCpi && previousCpi > 0
      ? currentCpi / previousCpi
      : (mi === 0 && currentCpi && startCpi > 0 ? currentCpi / startCpi : Math.pow(1 + config.inflationEUR / 100, 1 / MONTHS_PER_YEAR))
    if (mi > 0) expenseInflationFactor *= monthlyInflationFactor
    annualInflationFactor *= monthlyInflationFactor
    const fxMonthly = config.eurUsdDrift / 100 / MONTHS_PER_YEAR
    usdPerEur = hist.usdPerEur ?? usdPerEur * (1 + fxMonthly)

    const treasuryMonthly = Math.max(0, hist.treasuryYieldAnnual / 100 / MONTHS_PER_YEAR)
    const cashMonthly = treasuryMonthly * (config.cashYieldMultiplier / 100)
    const equityReturn = equityReturnForMonth(hist, startingState)
    const portfolioReturn =
      startingState.equityWeight * equityReturn +
      startingState.bondWeight * treasuryMonthly +
      startingState.cashWeight * cashMonthly
    annualEquityFactor *= 1 + equityReturn
    annualPortfolioFactor *= 1 + portfolioReturn
    annualTreasuryTotal += hist.treasuryYieldAnnual
    annualMonthCount++

    liquidUSD *= 1 + portfolioReturn
    cashUSD *= 1 + cashMonthly
    cashEUR *= 1 + cashMonthly
    realEstateEUR *= monthlyInflationFactor

    const flowEUR = monthlyFlowsEUR(input, calendarMonth, usdPerEur, expenseInflationFactor, extraSpendEUR)
    annualNetFlowEUR += flowEUR

    if (flowEUR >= 0) {
      cashEUR += flowEUR
    } else {
      const grossNeedEUR = applyTaxGrossUp(-flowEUR, input, calendarMonth)
      const fromCashEUR = Math.min(cashEUR, grossNeedEUR)
      cashEUR -= fromCashEUR
      let remainingEUR = grossNeedEUR - fromCashEUR
      if (remainingEUR > 0) {
        const fromCashUSD = Math.min(cashUSD, remainingEUR * usdPerEur)
        cashUSD -= fromCashUSD
        remainingEUR -= fromCashUSD / usdPerEur
      }
      if (remainingEUR > 0) liquidUSD -= remainingEUR * usdPerEur
    }

    const eventState = applyAccountEvents(input, calendarMonth, usdPerEur, liquidUSD, cashEUR, cashUSD, realEstateEUR)
    liquidUSD = eventState.liquidUSD
    cashEUR = eventState.cashEUR
    cashUSD = eventState.cashUSD
    realEstateEUR = eventState.realEstateEUR
    annualNetFlowEUR += eventState.liquidEventFlowEUR

    const liquidEUR = liquidUSD / usdPerEur + cashUSD / usdPerEur + cashEUR
    if (liquidEUR <= 0 && firstFailureMonth == null) firstFailureMonth = mi + 1

    const isYearEnd = calendarMonth.endsWith('-12')
    const isFinalMonth = mi === durationMonths - 1
    if (collectYearly && (isYearEnd || isFinalMonth)) {
      yearlyRealEstate.push(Math.max(0, realEstateEUR))
      yearlyNetWorth.push(Math.max(0, liquidEUR) + Math.max(0, realEstateEUR))
      yearlyInputs.push({
        year: Number(calendarMonth.slice(0, 4)),
        cohortYear: Number(hist.month.slice(0, 4)),
        liquidNetWorth: Math.max(0, liquidEUR),
        netFlowEUR: annualNetFlowEUR,
        inflationPct: (annualInflationFactor - 1) * 100,
        equityReturnPct: (annualEquityFactor - 1) * 100,
        portfolioReturnPct: (annualPortfolioFactor - 1) * 100,
        treasuryYieldAnnual: annualMonthCount > 0 ? annualTreasuryTotal / annualMonthCount : 0,
      })
      annualInflationFactor = 1
      annualEquityFactor = 1
      annualPortfolioFactor = 1
      annualNetFlowEUR = 0
      annualTreasuryTotal = 0
      annualMonthCount = 0
    }
  }

  const finalLiquidEUR = liquidUSD / usdPerEur + cashUSD / usdPerEur + cashEUR
  const endingNetWorth = collectYearly
    ? (yearlyNetWorth[yearlyNetWorth.length - 1] ?? 0)
    : Math.max(0, finalLiquidEUR) + Math.max(0, realEstateEUR)
  return { startMonth, survived: firstFailureMonth == null, firstFailureMonth, endingNetWorth, yearlyNetWorth, yearlyRealEstate, yearlyInputs }
}

function postProgress(phase: string, completed: number, total: number) {
  self.postMessage({ ok: true, progress: { phase, completed, total } })
}

interface PreparedSimulation {
  input: MCInput
  history: HistoricalMonth[]
  composed: { dataSources: string[]; warnings: string[] }
  startYear: number
  startMonthNumber: number
  simulationStartMonth: string
  numYears: number
  durationMonths: number
  years: number[]
  startingState: StartingState
}

function prepareSimulation(input: MCInput): PreparedSimulation {
  const config = configWithDefaults(input.config, input.eurUsdSpot)
  const normalizedInput = { ...input, config }
  const composed = composeHistory(parseShillerData(shillerCsv), input.historicalMarketData)
  const history = composed.history
  if (history.length === 0) throw new Error('No historical data available for sequential backtesting.')

  const now = new Date()
  const startYear = now.getFullYear()
  const startMonthNumber = now.getMonth() + 1
  const simulationStartMonth = `${startYear}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const selfEndYear = input.profile.birthYear + input.profile.projectionEndAge
  const spouseEndYear = input.profile.spouseBirthYear + (input.profile.spouseProjectionEndAge ?? input.profile.projectionEndAge)
  const endYear = Math.max(selfEndYear, spouseEndYear)
  const numYears = Math.max(1, endYear - startYear + 1)
  const durationMonths = Math.max(1, (endYear - startYear) * MONTHS_PER_YEAR + (MONTHS_PER_YEAR - startMonthNumber + 1))
  const years = Array.from({ length: numYears }, (_, i) => startYear + i)
  const maxStart = history.length - durationMonths
  if (maxStart < 0) throw new Error('Historical data window is shorter than the requested projection duration.')

  const startingState = buildStartingState(normalizedInput.accounts, normalizedInput.realEstateEvents, startYear, config.fallbackUsdEurRate)
  return {
    input: normalizedInput,
    history,
    composed,
    startYear,
    startMonthNumber,
    simulationStartMonth,
    numYears,
    durationMonths,
    years,
    startingState,
  }
}

function representativeStartIndices(prepared: PreparedSimulation, base: Omit<MCOutput, 'safeMonthlySpend'>): number[] {
  const startIndexByMonth = new Map(prepared.history.map((point, index) => [point.month, index]))
  const ranked = [...(base.cohortSummaries ?? [])].sort((a, b) => a.endingNetWorth - b.endingNetWorth)
  const indices = new Set<number>()

  for (let percentileRank = 1; percentileRank <= 100; percentileRank++) {
    const rankedIndex = Math.min(
      ranked.length - 1,
      Math.max(0, Math.round((percentileRank / 100) * (ranked.length - 1))),
    )
    const startIndex = startIndexByMonth.get(ranked[rankedIndex]?.startMonth)
    if (startIndex != null && startIndex <= prepared.history.length - prepared.durationMonths) {
      indices.add(startIndex)
    }
  }

  return [...indices].sort((a, b) => a - b)
}

function cohortSuccessRate(
  prepared: PreparedSimulation,
  extraSpendEUR: number,
  phase: string,
  progressOffset: number,
  progressWeight: number,
  startIndices?: number[],
): number {
  const maxStart = prepared.history.length - prepared.durationMonths
  const cohortStarts = startIndices ?? Array.from({ length: maxStart + 1 }, (_, index) => index)
  const cohortTotal = cohortStarts.length
  let successful = 0
  for (let index = 0; index < cohortStarts.length; index++) {
    const startIndex = cohortStarts[index]
    const cohort = runCohort(
      prepared.input,
      prepared.history,
      startIndex,
      prepared.durationMonths,
      prepared.startingState,
      extraSpendEUR,
      prepared.simulationStartMonth,
      false,
    )
    if (cohort.survived) successful++
    const completed = index + 1
    if (completed === cohortTotal || completed % 25 === 0) {
      postProgress(phase, Math.round(progressOffset + completed / cohortTotal * progressWeight), 100)
    }
  }
  return successful / cohortTotal * 100
}

function buildResult(prepared: PreparedSimulation, extraSpendEUR: number, phase = 'cohorts', progressOffset = 0, progressWeight = 1): Omit<MCOutput, 'safeMonthlySpend'> {
  const { input, history, durationMonths, simulationStartMonth, startingState, numYears, years, composed } = prepared
  const maxStart = history.length - durationMonths
  const cohorts: CohortRun[] = []
  const cohortTotal = maxStart + 1
  for (let startIndex = 0; startIndex <= maxStart; startIndex++) {
    cohorts.push(runCohort(input, history, startIndex, durationMonths, startingState, extraSpendEUR, simulationStartMonth))
    const completed = startIndex + 1
    if (completed === cohortTotal || completed % 25 === 0) {
      postProgress(phase, Math.round(progressOffset + completed / cohortTotal * progressWeight), 100)
    }
  }

  const medianNetWorth: number[] = []
  const p10NetWorth: number[] = []
  const p90NetWorth: number[] = []
  const realEstateNetWorth: number[] = []
  for (let yi = 0; yi < numYears; yi++) {
    medianNetWorth.push(percentile(cohorts.map(c => c.yearlyNetWorth[yi] ?? 0), 0.5))
    p10NetWorth.push(percentile(cohorts.map(c => c.yearlyNetWorth[yi] ?? 0), 0.1))
    p90NetWorth.push(percentile(cohorts.map(c => c.yearlyNetWorth[yi] ?? 0), 0.9))
    realEstateNetWorth.push(percentile(cohorts.map(c => c.yearlyRealEstate[yi] ?? 0), 0.5))
  }

  const successful = cohorts.filter(c => c.survived).length
  const worst = cohorts.reduce((min, cohort) => cohort.endingNetWorth < min.endingNetWorth ? cohort : min, cohorts[0])
  const firstFailure = cohorts
    .map(c => c.firstFailureMonth)
    .filter((month): month is number => month != null)
    .sort((a, b) => a - b)[0] ?? null

  return {
    successRate: successful / cohorts.length * 100,
    liquidSuccessRate: successful / cohorts.length * 100,
    medianNetWorth,
    p10NetWorth,
    p90NetWorth,
    realEstateNetWorth,
    years,
    cohortCount: cohorts.length,
    historicalStartMonth: history[0].month,
    historicalEndMonth: history[history.length - 1].month,
    worstCohortStart: worst.startMonth,
    firstFailureMonth: firstFailure,
    engine: 'historical-sequential',
    dataSources: composed.dataSources,
    warnings: composed.warnings,
    durationMonths,
    cohortSummaries: cohorts.map(cohort => ({
      startMonth: cohort.startMonth,
      survived: cohort.survived,
      firstFailureMonth: cohort.firstFailureMonth,
      endingNetWorth: cohort.endingNetWorth,
      yearlyInputs: cohort.yearlyInputs,
    })),
    historicalInputs: history.map(point => ({
      month: point.month,
      cpi: point.cpi,
      equityReturn: point.etfReturns ? equityReturnForMonth(point, startingState) : point.equityReturn,
      treasuryYieldAnnual: point.treasuryYieldAnnual,
      usdPerEur: point.usdPerEur ?? null,
    })),
  }
}

function simulate(input: MCInput): MCOutput {
  const prepared = prepareSimulation(input)
  const base = buildResult(prepared, 0, 'baseline cohorts', 0, 20)
  const safeSpendCohortStarts = representativeStartIndices(prepared, base)
  const threshold = (input.config.successThreshold ?? 90) / 100
  let lo = 0
  let hi = Math.max(100, (base.medianNetWorth[0] ?? 0) * 0.008)
  const iterations = 12

  for (let i = 0; i < iterations; i++) {
    const mid = (lo + hi) / 2
    const successRate = cohortSuccessRate(
      prepared,
      mid,
      'safe-spend search',
      20 + i * (75 / iterations),
      75 / iterations,
      safeSpendCohortStarts,
    )
    if (successRate / 100 >= threshold) lo = mid
    else hi = mid
  }

  postProgress('finalizing', 98, 100)

  return { ...base, safeMonthlySpend: lo }
}

self.onmessage = (e: MessageEvent<MCInput>) => {
  try {
    const result = simulate(e.data)
    self.postMessage({ ok: true, result })
  } catch (err) {
    self.postMessage({ ok: false, error: String(err) })
  }
}
