export interface TickerDividend {
  exDate: string       // YYYY-MM-DD
  paymentDate: string  // YYYY-MM-DD; Tiingo exposes the dividend date, not a separate pay date
  amount: number
}

interface TiingoPriceRow {
  date?: string
  adjClose?: number
  divCash?: number
}

function tiingoUrl(path: string, params: URLSearchParams, proxyUrl?: string | null): string {
  const base = proxyUrl ? `${proxyUrl.replace(/\/$/, '')}/tiingo` : 'https://api.tiingo.com'
  return `${base}${path}?${params.toString()}`
}

// Fetch dividend history from Tiingo EOD prices. Tiingo reports cash dividends
// in the `divCash` field on historical price rows.
export async function fetchTickerDividends(apiKey: string, ticker: string, proxyUrl?: string | null): Promise<TickerDividend[]> {
  const params = new URLSearchParams({
    startDate: '1990-01-01',
    token: apiKey,
  })
  const url = tiingoUrl(`/tiingo/daily/${encodeURIComponent(ticker)}/prices`, params, proxyUrl)
  const res = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
    },
  })
  if (!res.ok) throw new Error(`Tiingo returned ${res.status}`)
  const data = await res.json()
  if (!Array.isArray(data)) {
    const detail = typeof data?.detail === 'string' ? data.detail : 'Unexpected Tiingo response'
    throw new Error(detail)
  }

  return (data as TiingoPriceRow[])
    .map(row => {
      const date = row.date?.slice(0, 10) ?? ''
      return {
        exDate: date,
        paymentDate: date,
        amount: Number(row.divCash) || 0,
      }
    })
    .filter(d => d.amount > 0 && d.paymentDate && !isNaN(new Date(d.paymentDate).getTime()))
    .sort((a, b) => b.paymentDate.localeCompare(a.paymentDate))
}

export interface MonthlyTickerReturn {
  month: string
  ticker: string
  return: number
}

export class TiingoRateLimitError extends Error {
  constructor(public ticker: string) {
    super(`Tiingo ${ticker} rate limited`)
    this.name = 'TiingoRateLimitError'
  }
}

interface CachedMonthlyReturns {
  savedAt: number
  data: MonthlyTickerReturn[]
}

const MONTHLY_RETURN_CACHE_PREFIX = 'dinner-money:tiingo-monthly-returns:'
const MONTHLY_RETURN_TTL_MS = 12 * 60 * 60 * 1000

function monthKey(date: string): string {
  return date.slice(0, 7)
}

function monthlyReturnCacheKey(ticker: string, startDate: string): string {
  return `${MONTHLY_RETURN_CACHE_PREFIX}${ticker.toUpperCase()}:${startDate}`
}

function readMonthlyReturnCache(ticker: string, startDate: string, allowStale = false): MonthlyTickerReturn[] | null {
  if (typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(monthlyReturnCacheKey(ticker, startDate))
    if (!raw) return null
    const cached = JSON.parse(raw) as CachedMonthlyReturns
    if (!Array.isArray(cached.data)) return null
    if (!allowStale && Date.now() - cached.savedAt > MONTHLY_RETURN_TTL_MS) return null
    return cached.data
  } catch {
    return null
  }
}

function writeMonthlyReturnCache(ticker: string, startDate: string, data: MonthlyTickerReturn[]) {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(monthlyReturnCacheKey(ticker, startDate), JSON.stringify({ savedAt: Date.now(), data }))
  } catch {
    // Ignore quota/private-mode failures; cache is an optimization.
  }
}

// Tiingo adjusted close is dividend/split adjusted. Taking month-end adjClose
// ratios gives monthly total return for the ticker.
export async function fetchMonthlyAdjustedReturns(
  apiKey: string,
  ticker: string,
  startDate = '1990-01-01',
  proxyUrl?: string | null,
): Promise<MonthlyTickerReturn[]> {
  const cached = readMonthlyReturnCache(ticker, startDate)
  if (cached) return cached

  const params = new URLSearchParams({
    startDate,
    token: apiKey,
  })
  const url = tiingoUrl(`/tiingo/daily/${encodeURIComponent(ticker)}/prices`, params, proxyUrl)
  const res = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
    },
  })
  if (res.status === 429) {
    const stale = readMonthlyReturnCache(ticker, startDate, true)
    if (stale) return stale
    throw new TiingoRateLimitError(ticker.toUpperCase())
  }
  if (!res.ok) throw new Error(`Tiingo ${ticker} returned ${res.status}`)
  const data = await res.json()
  if (!Array.isArray(data)) {
    const detail = typeof data?.detail === 'string' ? data.detail : 'Unexpected Tiingo response'
    throw new Error(detail)
  }

  const monthEnds = new Map<string, { date: string; adjClose: number }>()
  for (const row of data as TiingoPriceRow[]) {
    const date = row.date?.slice(0, 10) ?? ''
    const adjClose = Number(row.adjClose)
    if (!date || !Number.isFinite(adjClose) || adjClose <= 0) continue
    const month = monthKey(date)
    const existing = monthEnds.get(month)
    if (!existing || date > existing.date) monthEnds.set(month, { date, adjClose })
  }

  const ordered = [...monthEnds.entries()]
    .map(([month, value]) => ({ month, ...value }))
    .sort((a, b) => a.month.localeCompare(b.month))

  const returns: MonthlyTickerReturn[] = []
  for (let i = 1; i < ordered.length; i++) {
    const prev = ordered[i - 1]
    const current = ordered[i]
    returns.push({
      month: current.month,
      ticker: ticker.toUpperCase(),
      return: current.adjClose / prev.adjClose - 1,
    })
  }
  writeMonthlyReturnCache(ticker, startDate, returns)
  return returns
}

// Estimate upcoming dividend payments from history.
// Uses the last 4 payments to estimate amount and frequency,
// then projects forward up to `monthsAhead` months.
export interface ProjectedDividend {
  ticker: string
  paymentDate: string  // YYYY-MM-DD
  amount: number       // per share
  sharesHeld: number
  totalAmount: number
}

function inferFrequencyDays(payments: TickerDividend[]): number {
  if (payments.length < 2) return 91  // default quarterly
  const sorted = [...payments].sort((a, b) => a.paymentDate.localeCompare(b.paymentDate))
  const gaps: number[] = []
  for (let i = 1; i < sorted.length; i++) {
    const d1 = new Date(sorted[i - 1].paymentDate).getTime()
    const d2 = new Date(sorted[i].paymentDate).getTime()
    const gap = (d2 - d1) / 86400000
    if (gap > 0) gaps.push(gap)  // ignore duplicate/out-of-order dates
  }
  if (gaps.length === 0) return 91
  const avgGap = gaps.reduce((s, g) => s + g, 0) / gaps.length
  // Snap to common dividend frequencies: monthly ~30, quarterly ~91, semi ~182, annual ~365
  return avgGap < 45 ? 30 : avgGap < 136 ? 91 : avgGap < 273 ? 182 : 365
}

export interface DailyTickerReturn {
  date: string
  return: number
}

const DAILY_RETURN_CACHE_PREFIX = 'dinner-money:tiingo-daily-returns:'
const DAILY_RETURN_TTL_MS = 60 * 60 * 1000 // 1 hour

function dailyReturnCacheKey(ticker: string): string {
  return `${DAILY_RETURN_CACHE_PREFIX}${ticker.toUpperCase()}`
}

interface CachedDailyReturns {
  savedAt: number
  data: DailyTickerReturn[]
}

function readDailyReturnCache(ticker: string, allowStale = false): DailyTickerReturn[] | null {
  if (typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(dailyReturnCacheKey(ticker))
    if (!raw) return null
    const cached = JSON.parse(raw) as CachedDailyReturns
    if (!Array.isArray(cached.data)) return null
    if (!allowStale && Date.now() - cached.savedAt > DAILY_RETURN_TTL_MS) return null
    return cached.data
  } catch {
    return null
  }
}

function writeDailyReturnCache(ticker: string, data: DailyTickerReturn[]) {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(dailyReturnCacheKey(ticker), JSON.stringify({ savedAt: Date.now(), data }))
  } catch {}
}

export async function fetchRecentDailyReturns(
  apiKey: string,
  ticker: string,
  days = 10,
  proxyUrl?: string | null,
): Promise<DailyTickerReturn[]> {
  const cached = readDailyReturnCache(ticker)
  if (cached) return cached

  const start = new Date()
  start.setDate(start.getDate() - days)
  const params = new URLSearchParams({ startDate: start.toISOString().slice(0, 10), token: apiKey })
  const url = tiingoUrl(`/tiingo/daily/${encodeURIComponent(ticker)}/prices`, params, proxyUrl)
  try {
    const res = await fetch(url, { headers: { 'Content-Type': 'application/json' } })
    if (res.status === 429) {
      const stale = readDailyReturnCache(ticker, true)
      if (stale) return stale
      throw new TiingoRateLimitError(ticker.toUpperCase())
    }
    if (!res.ok) return []
    const data = await res.json()
    if (!Array.isArray(data)) return []
    const sorted = (data as TiingoPriceRow[])
      .map(row => ({ date: row.date?.slice(0, 10) ?? '', adjClose: Number(row.adjClose) }))
      .filter(r => r.date && Number.isFinite(r.adjClose) && r.adjClose > 0)
      .sort((a, b) => a.date.localeCompare(b.date))
    const result: DailyTickerReturn[] = []
    for (let i = 1; i < sorted.length; i++) {
      result.push({ date: sorted[i].date, return: sorted[i].adjClose / sorted[i - 1].adjClose - 1 })
    }
    writeDailyReturnCache(ticker, result)
    return result
  } catch (err) {
    if (err instanceof TiingoRateLimitError) throw err
    return []
  }
}

export interface DailyPricePoint {
  date: string     // YYYY-MM-DD
  adjClose: number
}

const DAILY_PRICE_CACHE_PREFIX = 'dinner-money:tiingo-daily:'
const DAILY_PRICE_TTL_MS = 60 * 60 * 1000 // 1 hour

function dailyPriceCacheKey(ticker: string, startDate: string): string {
  return `${DAILY_PRICE_CACHE_PREFIX}${ticker.toUpperCase()}:${startDate}`
}

interface CachedDailyPrices {
  savedAt: number
  data: DailyPricePoint[]
}

function readDailyPriceCache(ticker: string, startDate: string, allowStale = false): DailyPricePoint[] | null {
  if (typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(dailyPriceCacheKey(ticker, startDate))
    if (!raw) return null
    const cached = JSON.parse(raw) as CachedDailyPrices
    if (!Array.isArray(cached.data)) return null
    if (!allowStale && Date.now() - cached.savedAt > DAILY_PRICE_TTL_MS) return null
    return cached.data
  } catch {
    return null
  }
}

function writeDailyPriceCache(ticker: string, startDate: string, data: DailyPricePoint[]) {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(dailyPriceCacheKey(ticker, startDate), JSON.stringify({ savedAt: Date.now(), data }))
  } catch {}
}

export async function fetchDailyPrices(
  apiKey: string,
  ticker: string,
  startDate: string,
  proxyUrl?: string | null,
): Promise<DailyPricePoint[]> {
  const cached = readDailyPriceCache(ticker, startDate)
  if (cached) return cached

  const params = new URLSearchParams({ startDate, token: apiKey })
  const url = tiingoUrl(`/tiingo/daily/${encodeURIComponent(ticker)}/prices`, params, proxyUrl)
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' } })

  if (res.status === 429) {
    const stale = readDailyPriceCache(ticker, startDate, true)
    if (stale) return stale
    throw new TiingoRateLimitError(ticker.toUpperCase())
  }
  if (!res.ok) throw new Error(`Tiingo ${ticker} returned ${res.status}`)

  const data = await res.json()
  if (!Array.isArray(data)) {
    const detail = typeof data?.detail === 'string' ? data.detail : 'Unexpected Tiingo response'
    throw new Error(detail)
  }

  const points: DailyPricePoint[] = (data as TiingoPriceRow[])
    .map(row => ({ date: row.date?.slice(0, 10) ?? '', adjClose: Number(row.adjClose) || 0 }))
    .filter(p => p.date && p.adjClose > 0)
    .sort((a, b) => a.date.localeCompare(b.date))

  writeDailyPriceCache(ticker, startDate, points)
  return points
}

export function projectDividends(
  ticker: string,
  history: TickerDividend[],
  sharesHeld: number,
  monthsAhead = 18,
): ProjectedDividend[] {
  if (history.length === 0 || sharesHeld <= 0) return []

  const validHistory = history.filter(d => d.paymentDate && !isNaN(new Date(d.paymentDate).getTime()))
  if (validHistory.length === 0) return []

  const recent = validHistory.slice(0, 8)  // most recent 8 payments
  const avgAmount = recent.reduce((s, d) => s + d.amount, 0) / recent.length
  const freqDays = inferFrequencyDays(recent)

  const lastDate = new Date(recent[0].paymentDate)
  const cutoff = new Date()
  cutoff.setMonth(cutoff.getMonth() + monthsAhead)

  const results: ProjectedDividend[] = []
  let next = new Date(lastDate)
  next.setDate(next.getDate() + freqDays)

  // Don't project past cutoff, cap at 30 iterations
  for (let i = 0; i < 30 && next <= cutoff; i++) {
    results.push({
      ticker,
      paymentDate: next.toISOString().slice(0, 10),
      amount: avgAmount,
      sharesHeld,
      totalAmount: avgAmount * sharesHeld,
    })
    next = new Date(next)
    next.setDate(next.getDate() + freqDays)
  }
  return results
}
