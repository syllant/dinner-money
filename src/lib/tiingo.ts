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

const TIINGO_MIN_REQUEST_INTERVAL_MS = 1_300
let lastTiingoRequestAt = 0
let tiingoQueue = Promise.resolve()
const pendingJsonRequests = new Map<string, Promise<unknown>>()

async function fetchTiingoJson(url: string): Promise<unknown> {
  const pending = pendingJsonRequests.get(url)
  if (pending) return pending
  const request = tiingoQueue.then(async () => {
    const waitMs = Math.max(0, TIINGO_MIN_REQUEST_INTERVAL_MS - (Date.now() - lastTiingoRequestAt))
    if (waitMs > 0) await new Promise(resolve => setTimeout(resolve, waitMs))
    lastTiingoRequestAt = Date.now()
    const res = await fetch(url, { headers: { 'Content-Type': 'application/json' } })
    if (res.status === 429) return { __tiingoRateLimited: true, res }
    if (!res.ok) return { __tiingoHttpStatus: res.status }
    return res.json()
  })
  pendingJsonRequests.set(url, request)
  tiingoQueue = request.catch(() => undefined).then(() => undefined)
  try {
    return await request
  } finally {
    pendingJsonRequests.delete(url)
  }
}

function isRateLimitResponse(data: unknown): data is { __tiingoRateLimited: true; res: Response } {
  return Boolean(data && typeof data === 'object' && (data as { __tiingoRateLimited?: boolean }).__tiingoRateLimited)
}

function httpStatus(data: unknown): number | null {
  if (!data || typeof data !== 'object') return null
  const status = (data as { __tiingoHttpStatus?: unknown }).__tiingoHttpStatus
  return typeof status === 'number' ? status : null
}

function responseDetail(data: unknown): string {
  if (!data || typeof data !== 'object') return 'Unexpected Tiingo response'
  const detail = (data as { detail?: unknown }).detail
  return typeof detail === 'string' ? detail : 'Unexpected Tiingo response'
}

// Fetch dividend history from Tiingo EOD prices. Tiingo reports cash dividends
// in the `divCash` field on historical price rows.
export async function fetchTickerDividends(apiKey: string, ticker: string, proxyUrl?: string | null): Promise<TickerDividend[]> {
  const activeLimit = activeRateLimitRecord(ticker, 'dividends')
  if (activeLimit) throw new TiingoRateLimitError(ticker.toUpperCase(), 'dividends', activeLimit.retryAt, false)

  const params = new URLSearchParams({
    startDate: '1990-01-01',
    token: apiKey,
  })
  const url = tiingoUrl(`/tiingo/daily/${encodeURIComponent(ticker)}/prices`, params, proxyUrl)
  const data = await fetchTiingoJson(url)
  if (isRateLimitResponse(data)) throw reportRateLimit(ticker, 'dividends', data.res, false)
  const status = httpStatus(data)
  if (status != null) throw new Error(`Tiingo returned ${status}`)
  clearRateLimitRecord(ticker, 'dividends')
  if (!Array.isArray(data)) {
    throw new Error(responseDetail(data))
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

export interface TiingoRateLimitRecord {
  symbol: string
  endpoint: string
  limitedAt: string
  retryAt: string
  usedCache: boolean
}

const TIINGO_RATE_LIMIT_KEY = 'dinner-money:tiingo-rate-limit'
const TIINGO_RATE_LIMIT_EVENT = 'dinner-money:tiingo-rate-limit'
const DEFAULT_RATE_LIMIT_RETRY_MS = 60 * 60 * 1000

export class TiingoRateLimitError extends Error {
  constructor(
    public ticker: string,
    public endpoint = 'unknown',
    public retryAt = new Date(Date.now() + DEFAULT_RATE_LIMIT_RETRY_MS).toISOString(),
    public usedCache = false,
  ) {
    super(`Tiingo ${ticker} rate limited`)
    this.name = 'TiingoRateLimitError'
  }
}

function parseRetryAt(res: Response): string {
  const retryAfter = res.headers.get('Retry-After')
  if (retryAfter) {
    const seconds = Number(retryAfter)
    if (Number.isFinite(seconds) && seconds > 0) {
      return new Date(Date.now() + seconds * 1000).toISOString()
    }
    const dateMs = new Date(retryAfter).getTime()
    if (Number.isFinite(dateMs) && dateMs > Date.now()) return new Date(dateMs).toISOString()
  }
  return new Date(Date.now() + DEFAULT_RATE_LIMIT_RETRY_MS).toISOString()
}

function readRateLimitRecords(): TiingoRateLimitRecord[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const parsed = JSON.parse(localStorage.getItem(TIINGO_RATE_LIMIT_KEY) ?? '[]') as TiingoRateLimitRecord[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeRateLimitRecords(records: TiingoRateLimitRecord[]) {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(TIINGO_RATE_LIMIT_KEY, JSON.stringify(records))
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(TIINGO_RATE_LIMIT_EVENT))
  } catch {}
}

function clearRateLimitRecord(symbol: string, endpoint: string) {
  const now = Date.now()
  const next = readRateLimitRecords().filter(r =>
    new Date(r.retryAt).getTime() > now && !(r.symbol === symbol.toUpperCase() && r.endpoint === endpoint)
  )
  writeRateLimitRecords(next)
}

function activeRateLimitRecord(symbol: string, endpoint: string): TiingoRateLimitRecord | null {
  const upper = symbol.toUpperCase()
  const now = Date.now()
  return readRateLimitRecords().find(r =>
    r.symbol === upper && r.endpoint === endpoint && new Date(r.retryAt).getTime() > now
  ) ?? null
}

function reportRateLimit(symbol: string, endpoint: string, res: Response, usedCache: boolean): TiingoRateLimitError {
  const upper = symbol.toUpperCase()
  const record: TiingoRateLimitRecord = {
    symbol: upper,
    endpoint,
    limitedAt: new Date().toISOString(),
    retryAt: parseRetryAt(res),
    usedCache,
  }
  const rest = readRateLimitRecords().filter(r => !(r.symbol === upper && r.endpoint === endpoint))
  writeRateLimitRecords([record, ...rest].slice(0, 8))
  return new TiingoRateLimitError(upper, endpoint, record.retryAt, usedCache)
}

export function readTiingoRateLimits(): TiingoRateLimitRecord[] {
  const now = Date.now()
  const active = readRateLimitRecords()
    .filter(r => new Date(r.retryAt).getTime() > now)
    .sort((a, b) => new Date(a.retryAt).getTime() - new Date(b.retryAt).getTime())
  if (active.length !== readRateLimitRecords().length) writeRateLimitRecords(active)
  return active
}

export { TIINGO_RATE_LIMIT_EVENT }

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
  const activeLimit = activeRateLimitRecord(ticker, 'monthly returns')
  if (activeLimit) {
    const stale = readMonthlyReturnCache(ticker, startDate, true)
    if (stale) return stale
    throw new TiingoRateLimitError(ticker.toUpperCase(), 'monthly returns', activeLimit.retryAt, false)
  }

  const params = new URLSearchParams({
    startDate,
    token: apiKey,
  })
  const url = tiingoUrl(`/tiingo/daily/${encodeURIComponent(ticker)}/prices`, params, proxyUrl)
  const data = await fetchTiingoJson(url)
  if (isRateLimitResponse(data)) {
    const stale = readMonthlyReturnCache(ticker, startDate, true)
    const err = reportRateLimit(ticker, 'monthly returns', data.res, Boolean(stale))
    if (stale) return stale
    throw err
  }
  const status = httpStatus(data)
  if (status != null) throw new Error(`Tiingo ${ticker} returned ${status}`)
  clearRateLimitRecord(ticker, 'monthly returns')
  if (!Array.isArray(data)) {
    throw new Error(responseDetail(data))
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
  const activeLimit = activeRateLimitRecord(ticker, 'daily returns')
  if (activeLimit) {
    const stale = readDailyReturnCache(ticker, true)
    if (stale) return stale
    throw new TiingoRateLimitError(ticker.toUpperCase(), 'daily returns', activeLimit.retryAt, false)
  }

  const start = new Date()
  start.setDate(start.getDate() - days)
  const params = new URLSearchParams({ startDate: start.toISOString().slice(0, 10), token: apiKey })
  const url = tiingoUrl(`/tiingo/daily/${encodeURIComponent(ticker)}/prices`, params, proxyUrl)
  try {
    const data = await fetchTiingoJson(url)
    if (isRateLimitResponse(data)) {
      const stale = readDailyReturnCache(ticker, true)
      const err = reportRateLimit(ticker, 'daily returns', data.res, Boolean(stale))
      if (stale) return stale
      throw err
    }
    if (httpStatus(data) != null) return []
    clearRateLimitRecord(ticker, 'daily returns')
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
  const activeLimit = activeRateLimitRecord(ticker, 'daily prices')
  if (activeLimit) {
    const stale = readDailyPriceCache(ticker, startDate, true)
    if (stale) return stale
    throw new TiingoRateLimitError(ticker.toUpperCase(), 'daily prices', activeLimit.retryAt, false)
  }

  const params = new URLSearchParams({ startDate, token: apiKey })
  const url = tiingoUrl(`/tiingo/daily/${encodeURIComponent(ticker)}/prices`, params, proxyUrl)
  const data = await fetchTiingoJson(url)

  if (isRateLimitResponse(data)) {
    const stale = readDailyPriceCache(ticker, startDate, true)
    const err = reportRateLimit(ticker, 'daily prices', data.res, Boolean(stale))
    if (stale) return stale
    throw err
  }
  const status = httpStatus(data)
  if (status != null) throw new Error(`Tiingo ${ticker} returned ${status}`)
  clearRateLimitRecord(ticker, 'daily prices')

  if (!Array.isArray(data)) {
    throw new Error(responseDetail(data))
  }

  const points: DailyPricePoint[] = (data as TiingoPriceRow[])
    .map(row => ({ date: row.date?.slice(0, 10) ?? '', adjClose: Number(row.adjClose) || 0 }))
    .filter(p => p.date && p.adjClose > 0)
    .sort((a, b) => a.date.localeCompare(b.date))

  writeDailyPriceCache(ticker, startDate, points)
  return points
}

export interface IntradayPricePoint {
  date: string   // ISO 8601 with timezone, e.g. "2025-05-12T13:30:00+00:00"
  close: number
}

const INTRADAY_CACHE_PREFIX = 'dinner-money:tiingo-intraday:'
const INTRADAY_CACHE_TTL_MS = 15 * 60 * 1000 // 15 minutes
const INTRADAY_MARKET_CACHE_TTL_MS = 15 * 60 * 1000 // keep free-tier request volume sane

interface CachedIntraday { savedAt: number; data: IntradayPricePoint[] }
const pendingIntradayRequests = new Map<string, Promise<IntradayPricePoint[]>>()

function intradayCacheKey(ticker: string): string {
  return `${INTRADAY_CACHE_PREFIX}${ticker.toUpperCase()}`
}

function readIntradayCache(ticker: string, allowStale = false): IntradayPricePoint[] | null {
  if (typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(intradayCacheKey(ticker))
    if (!raw) return null
    const cached = JSON.parse(raw) as CachedIntraday
    if (!Array.isArray(cached.data)) return null
    const ttl = isUsMarketHours() ? INTRADAY_MARKET_CACHE_TTL_MS : INTRADAY_CACHE_TTL_MS
    if (!allowStale && Date.now() - cached.savedAt > ttl) return null
    return cached.data
  } catch { return null }
}

export function isUsMarketHours(now = new Date()): boolean {
  const day = now.getUTCDay()
  if (day === 0 || day === 6) return false
  const month = now.getUTCMonth()
  const isDST = month >= 2 && month <= 9
  const openMinutesUTC = (isDST ? 13 : 14) * 60 + 30
  const closeMinutesUTC = (isDST ? 20 : 21) * 60
  const currentMinutesUTC = now.getUTCHours() * 60 + now.getUTCMinutes()
  return currentMinutesUTC >= openMinutesUTC && currentMinutesUTC < closeMinutesUTC
}

function writeIntradayCache(ticker: string, data: IntradayPricePoint[]) {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(intradayCacheKey(ticker), JSON.stringify({ savedAt: Date.now(), data }))
  } catch {}
}

export async function fetchIntradayPrices(
  apiKey: string,
  ticker: string,
  proxyUrl?: string | null,
): Promise<IntradayPricePoint[]> {
  const cached = readIntradayCache(ticker)
  if (cached) return cached
  const requestKey = `${ticker.toUpperCase()}|${proxyUrl ?? ''}`
  const pending = pendingIntradayRequests.get(requestKey)
  if (pending) return pending
  const request = fetchIntradayPricesUncached(apiKey, ticker, proxyUrl)
  pendingIntradayRequests.set(requestKey, request)
  try {
    return await request
  } finally {
    pendingIntradayRequests.delete(requestKey)
  }
}

async function fetchIntradayPricesUncached(
  apiKey: string,
  ticker: string,
  proxyUrl?: string | null,
): Promise<IntradayPricePoint[]> {
  const activeLimit = activeRateLimitRecord(ticker, 'intraday prices')
  if (activeLimit) {
    const stale = readIntradayCache(ticker, true)
    if (stale) return stale
    throw new TiingoRateLimitError(ticker.toUpperCase(), 'intraday prices', activeLimit.retryAt, false)
  }

  // Fetch last 2 calendar days to cover late-session or next-morning requests
  const start = new Date()
  start.setDate(start.getDate() - 2)
  const params = new URLSearchParams({
    startDate: start.toISOString().slice(0, 10),
    resampleFreq: '1hour',
    columns: 'date,close',
    token: apiKey,
  })
  const url = tiingoUrl(`/iex/${encodeURIComponent(ticker)}/prices`, params, proxyUrl)
  try {
    const data = await fetchTiingoJson(url)
    if (isRateLimitResponse(data)) {
      const stale = readIntradayCache(ticker, true)
      const err = reportRateLimit(ticker, 'intraday prices', data.res, Boolean(stale))
      if (stale) return stale
      throw err
    }
    if (httpStatus(data) != null) return []
    clearRateLimitRecord(ticker, 'intraday prices')
    if (!Array.isArray(data)) return []
    const result: IntradayPricePoint[] = (data as Array<{ date?: string; close?: number }>)
      .map(row => ({ date: row.date ?? '', close: Number(row.close) || 0 }))
      .filter(r => r.date && r.close > 0)
      .sort((a, b) => a.date.localeCompare(b.date))
    writeIntradayCache(ticker, result)
    return result
  } catch (err) {
    if (err instanceof TiingoRateLimitError) throw err
    return []
  }
}

// ── Intraday FX rates (Tiingo forex endpoint) ──────────────────────────────────

export interface IntradayFxPoint {
  date: string   // ISO 8601 with timezone
  close: number  // mid-price
}

const INTRADAY_FX_CACHE_PREFIX = 'dinner-money:tiingo-intraday-fx:'
const INTRADAY_FX_CACHE_TTL_MS = 15 * 60 * 1000
const pendingIntradayFxRequests = new Map<string, Promise<IntradayFxPoint[]>>()

function intradayFxCacheKey(pair: string): string {
  return `${INTRADAY_FX_CACHE_PREFIX}${pair.toLowerCase()}`
}

function readIntradayFxCache(pair: string, allowStale = false): IntradayFxPoint[] | null {
  try {
    const raw = localStorage.getItem(intradayFxCacheKey(pair))
    if (!raw) return null
    const { savedAt, data } = JSON.parse(raw) as { savedAt: number; data: IntradayFxPoint[] }
    if (!Array.isArray(data)) return null
    if (!allowStale && Date.now() - savedAt > INTRADAY_FX_CACHE_TTL_MS) return null
    return data
  } catch { return null }
}

function writeIntradayFxCache(pair: string, data: IntradayFxPoint[]) {
  try {
    localStorage.setItem(intradayFxCacheKey(pair), JSON.stringify({ savedAt: Date.now(), data }))
  } catch {}
}

export async function fetchIntradayFxRates(
  apiKey: string,
  pair: string,
  proxyUrl?: string | null,
): Promise<IntradayFxPoint[]> {
  const cached = readIntradayFxCache(pair)
  if (cached) return cached
  const requestKey = `${pair.toLowerCase()}|${proxyUrl ?? ''}`
  const pending = pendingIntradayFxRequests.get(requestKey)
  if (pending) return pending
  const request = fetchIntradayFxRatesUncached(apiKey, pair, proxyUrl)
  pendingIntradayFxRequests.set(requestKey, request)
  try {
    return await request
  } finally {
    pendingIntradayFxRequests.delete(requestKey)
  }
}

async function fetchIntradayFxRatesUncached(
  apiKey: string,
  pair: string,
  proxyUrl?: string | null,
): Promise<IntradayFxPoint[]> {
  const activeLimit = activeRateLimitRecord(pair, 'intraday FX')
  if (activeLimit) {
    const stale = readIntradayFxCache(pair, true)
    if (stale) return stale
    throw new TiingoRateLimitError(pair.toUpperCase(), 'intraday FX', activeLimit.retryAt, false)
  }

  const start = new Date()
  start.setDate(start.getDate() - 2)
  const params = new URLSearchParams({
    startDate: start.toISOString().slice(0, 10),
    resampleFreq: '1Hour',
    columns: 'date,close',
    token: apiKey,
  })
  const url = tiingoUrl(`/tiingo/fx/${encodeURIComponent(pair)}/prices`, params, proxyUrl)
  try {
    const data = await fetchTiingoJson(url)
    if (isRateLimitResponse(data)) {
      const stale = readIntradayFxCache(pair, true)
      const err = reportRateLimit(pair, 'intraday FX', data.res, Boolean(stale))
      if (stale) return stale
      throw err
    }
    if (httpStatus(data) != null) return []
    clearRateLimitRecord(pair, 'intraday FX')
    if (!Array.isArray(data)) return []
    const result: IntradayFxPoint[] = (data as Array<{ date?: string; close?: number }>)
      .map(row => ({ date: row.date ?? '', close: Number(row.close) || 0 }))
      .filter(r => r.date && r.close > 0)
      .sort((a, b) => a.date.localeCompare(b.date))
    writeIntradayFxCache(pair, result)
    return result
  } catch (err) {
    if (err instanceof TiingoRateLimitError) throw err
    return []
  }
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
