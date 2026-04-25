// Monte Carlo simulation — runs in a Web Worker to keep UI responsive.
// Uses correlated log-normal draws for equity, bonds, EUR/USD.

import type { MonteCarloConfig, Account, Expense, PensionEstimate, Windfall, RealEstateEvent, UserProfile } from '../types'

export interface MCInput {
  config: MonteCarloConfig
  profile: UserProfile
  accounts: Account[]
  expenses: Expense[]
  pensions: PensionEstimate[]
  windfalls: Windfall[]
  realEstateEvents: RealEstateEvent[]
  eurUsdSpot: number
}

export interface MCOutput {
  successRate: number
  medianNetWorth: number[]
  p10NetWorth: number[]
  p90NetWorth: number[]
  years: number[]
  safeMonthlySpend: number
}

// Box-Muller transform: standard normal sample
function randn(): number {
  let u = 0, v = 0
  while (u === 0) u = Math.random()
  while (v === 0) v = Math.random()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

function simulate(input: MCInput): MCOutput {
  const { config, profile, accounts, expenses, pensions, windfalls, realEstateEvents, eurUsdSpot } = input
  const startYear = new Date().getFullYear()
  const endYear = startYear + (profile.projectionEndAge - (startYear - profile.birthYear))
  const numYears = endYear - startYear + 1
  const years = Array.from({ length: numYears }, (_, i) => startYear + i)

  // Initial net worth in base currency (EUR)
  const rate = eurUsdSpot
  let initialNetWorth = 0
  for (const acc of accounts) {
    const bal = acc.balance
    const cur = acc.currency.toUpperCase()
    initialNetWorth += cur === 'EUR' ? bal : cur === 'USD' ? bal / rate : bal
  }

  const { numSimulations } = config
  const eqMu = config.equityMeanReturn / 100
  const eqSig = config.equityStdDev / 100
  const bdMu = config.bondMeanReturn / 100
  const bdSig = config.bondStdDev / 100
  const inf = config.inflationEUR / 100
  const fxSig = config.eurUsdVolatility / 100
  const fxDrift = config.eurUsdDrift / 100

  // Precompute annual net cash flows per year (deterministic part)
  const annualFlow = new Array<number>(numYears).fill(0)
  for (let yi = 0; yi < numYears; yi++) {
    const year = years[yi]
    const selfAge = year - profile.birthYear
    let flow = 0

    // Pensions
    for (const p of pensions) {
      const personAge = p.person === 'self' ? selfAge : year - profile.spouseBirthYear
      if (personAge >= p.startAge) {
        const annual = p.monthlyAmount * 12
        flow += p.currency === 'EUR' ? annual : annual / rate
      }
    }

    // Windfalls
    for (const w of windfalls) {
      if (parseInt(w.date) === year) {
        flow += w.currency === 'EUR' ? w.amount : w.amount / rate
      }
    }

    // Real estate
    for (const re of realEstateEvents) {
      const reYear = parseInt(re.date.split('-')[0])
      const reMonth = parseInt(re.date.split('-')[1] || '1')
      if (re.eventType === 'sell' && reYear === year) {
        flow += re.currency === 'EUR' ? re.amount : re.amount / rate
      } else if (re.eventType === 'buy' && reYear === year) {
        flow -= re.currency === 'EUR' ? re.amount : re.amount / rate
      } else if (re.eventType === 'rent' && re.isRecurring) {
        const startY = reYear
        const endY = re.endDate ? parseInt(re.endDate.split('-')[0]) : 9999
        if (year >= startY && year <= endY) {
          const months = year === startY ? 13 - reMonth : year === endY ? parseInt((re.endDate || '').split('-')[1] || '12') : 12
          flow -= (re.currency === 'EUR' ? re.amount : re.amount / rate) * months
        }
      }
    }

    // Expenses
    for (const exp of expenses) {
      const expStart = parseInt(exp.startDate.split('-')[0])
      const expEnd = exp.endDate ? parseInt(exp.endDate.split('-')[0]) : 9999
      if (year >= expStart && year <= expEnd) {
        const annual = exp.frequency === 'monthly' ? exp.amount * 12 : exp.frequency === 'yearly' ? exp.amount : exp.amount
        if (exp.frequency !== 'one_time' || (exp.frequency === 'one_time' && year === expStart)) {
          flow -= exp.currency === 'EUR' ? annual : annual / rate
        }
      }
    }

    annualFlow[yi] = flow
  }

  // Run simulations
  const allPaths = new Array<Float64Array>(numSimulations)
  let successCount = 0

  for (let sim = 0; sim < numSimulations; sim++) {
    const path = new Float64Array(numYears)
    let nw = initialNetWorth
    let fxRate = rate

    for (let yi = 0; yi < numYears; yi++) {
      // Draw correlated returns
      const z1 = randn()
      const z2 = randn() * 0.3 + z1 * 0.7  // mild equity/bond correlation
      const z3 = randn()                      // fx independent

      const eqRet = Math.exp((eqMu - 0.5 * eqSig * eqSig) + eqSig * z1) - 1
      const bdRet = Math.exp((bdMu - 0.5 * bdSig * bdSig) + bdSig * z2) - 1
      fxRate *= Math.exp((fxDrift - 0.5 * fxSig * fxSig) + fxSig * z3)

      // Weighted return across accounts (simplified: use aggregate allocation)
      let totalEquity = 0, totalBonds = 0, totalCash = 0, total = 0
      for (const acc of accounts) {
        const bal = acc.currency.toUpperCase() === 'EUR' ? acc.balance : acc.balance / fxRate
        totalEquity += bal * (acc.allocation.equity / 100)
        totalBonds += bal * (acc.allocation.bonds / 100)
        totalCash += bal * (acc.allocation.cash / 100)
        total += bal
      }
      const eqW = total > 0 ? totalEquity / total : 0.7
      const bdW = total > 0 ? totalBonds / total : 0.2
      const portfolioReturn = eqW * eqRet + bdW * bdRet

      // Inflation-adjusted flow
      const inflFactor = Math.pow(1 + inf, yi)
      const flow = annualFlow[yi] * inflFactor

      nw = nw * (1 + portfolioReturn) + flow
      path[yi] = nw
    }

    allPaths[sim] = path
    if (path[numYears - 1] >= 0) successCount++
  }

  // Compute percentiles per year
  const medianNW: number[] = []
  const p10NW: number[] = []
  const p90NW: number[] = []

  for (let yi = 0; yi < numYears; yi++) {
    const vals = Array.from({ length: numSimulations }, (_, si) => allPaths[si][yi]).sort((a, b) => a - b)
    medianNW.push(vals[Math.floor(numSimulations * 0.5)])
    p10NW.push(vals[Math.floor(numSimulations * 0.1)])
    p90NW.push(vals[Math.floor(numSimulations * 0.9)])
  }

  // Safe spend: largest monthly amount where success rate >= threshold
  const threshold = config.successThreshold / 100
  let lo = 0, hi = initialNetWorth * 0.1 / 12
  for (let iter = 0; iter < 30; iter++) {
    const mid = (lo + hi) / 2
    // Quick check: run fewer sims for bisection
    let ok = 0
    const checkSims = 500
    for (let sim = 0; sim < checkSims; sim++) {
      let nw2 = initialNetWorth
      let alive = true
      for (let yi = 0; yi < numYears; yi++) {
        const z1 = randn()
        const eqRet = Math.exp((eqMu - 0.5 * eqSig * eqSig) + eqSig * z1) - 1
        const bdRet = Math.exp((bdMu - 0.5 * bdSig * bdSig) + bdSig * randn()) - 1
        const portfolioReturn = 0.7 * eqRet + 0.2 * bdRet
        nw2 = nw2 * (1 + portfolioReturn) + annualFlow[yi] - mid * 12
        if (nw2 < 0) { alive = false; break }
      }
      if (alive) ok++
    }
    if (ok / checkSims >= threshold) lo = mid
    else hi = mid
  }

  return {
    successRate: (successCount / numSimulations) * 100,
    medianNetWorth: medianNW,
    p10NetWorth: p10NW,
    p90NetWorth: p90NW,
    years,
    safeMonthlySpend: lo,
  }
}

// Worker message handler
self.onmessage = (e: MessageEvent<MCInput>) => {
  try {
    const result = simulate(e.data)
    self.postMessage({ ok: true, result })
  } catch (err) {
    self.postMessage({ ok: false, error: String(err) })
  }
}
