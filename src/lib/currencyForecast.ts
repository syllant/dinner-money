export type ForecastSource = 'trading_economics' | 'ecb_spf' | 'euro_fx_futures' | 'kalshi' | 'polymarket'

export type ForecastKind =
  | 'model_forecast'
  | 'survey_forecast'
  | 'market_implied_forward'
  | 'prediction_market_probability'

export type ForecastPoint = {
  source: ForecastSource
  sourceLabel: string
  kind: ForecastKind
  date: string
  value?: number
  low?: number
  high?: number
  median?: number
  mean?: number
  probability?: number
  label?: string
  url: string
  fetchedAt: string
  caveat: string
}

export interface ForecastResult {
  points: ForecastPoint[]
  warnings: string[]
}

type FetchImpl = typeof fetch

interface FetcherOptions {
  proxyUrl?: string | null
  fetchImpl?: FetchImpl
  now?: Date
  includePredictionMarkets?: boolean
}

interface CachedForecastResult {
  savedAt: number
  result: ForecastResult
}

const CACHE_PREFIX = 'dinner-money:currency-forecast:v3:'
const TRADING_ECONOMICS_URL = 'https://tradingeconomics.com/forecast/currency'
const ECB_SPF_URLS = [
  ['3M', 'https://data-api.ecb.europa.eu/service/data/SPF/Q.U2.ASSU.USD.P3M.Q.?format=csvdata', 3],
  ['6M', 'https://data-api.ecb.europa.eu/service/data/SPF/Q.U2.ASSU.USD.P6M.Q.?format=csvdata', 6],
  ['12M', 'https://data-api.ecb.europa.eu/service/data/SPF/Q.U2.ASSU.USD.P12M.Q.?format=csvdata', 12],
] as const
const CME_QUARTER_MONTH_CODES = ['H', 'M', 'U', 'Z'] as const
const KALSHI_BASE = 'https://api.elections.kalshi.com/trade-api/v2'
const POLYMARKET_URLS = [
  'https://gamma-api.polymarket.com/public-search?q=EURUSD',
  'https://gamma-api.polymarket.com/public-search?q=EUR%2FUSD',
] as const

function cacheKey(key: string) {
  return `${CACHE_PREFIX}${key}`
}

function readCache(key: string, ttlMs: number): ForecastResult | null {
  if (typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(cacheKey(key))
    if (!raw) return null
    const cached = JSON.parse(raw) as CachedForecastResult
    if (!cached.result || Date.now() - cached.savedAt > ttlMs) return null
    return cached.result
  } catch {
    return null
  }
}

function writeCache(key: string, result: ForecastResult) {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(cacheKey(key), JSON.stringify({ savedAt: Date.now(), result }))
  } catch {
    // Cache writes are best-effort.
  }
}

async function cachedFetch(key: string, ttlMs: number, loader: () => Promise<ForecastResult>): Promise<ForecastResult> {
  const cached = readCache(key, ttlMs)
  if (cached) return cached
  const result = await loader()
  writeCache(key, result)
  return result
}

function proxiedUrl(url: string, proxyUrl?: string | null) {
  if (!proxyUrl) return url
  return `${proxyUrl.replace(/\/$/, '')}/external?url=${encodeURIComponent(url)}`
}

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10)
}

function addMonths(date: Date, months: number) {
  const next = new Date(date)
  next.setMonth(next.getMonth() + months)
  return next
}

function horizonDateFromHeader(header: string, now: Date) {
  const clean = header.trim().toUpperCase()
  const quarterMatch = clean.match(/Q([1-4])\s*[/\-]?\s*(\d{2,4})/)
  if (quarterMatch) {
    const quarter = Number(quarterMatch[1])
    const rawYear = Number(quarterMatch[2])
    const year = rawYear < 100 ? 2000 + rawYear : rawYear
    return `${year}-${String(quarter * 3).padStart(2, '0')}-30`
  }
  const monthMatch = clean.match(/(\d+)\s*M/)
  if (monthMatch) return isoDate(addMonths(now, Number(monthMatch[1])))
  return isoDate(now)
}

function parseNumber(text: string) {
  const cleaned = text.replace(/[, %]/g, '').trim()
  const value = Number(cleaned)
  return Number.isFinite(value) ? value : null
}

function mean(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : undefined
}

function quantile(values: number[], q: number) {
  if (values.length === 0) return undefined
  const sorted = [...values].sort((a, b) => a - b)
  const pos = (sorted.length - 1) * q
  const base = Math.floor(pos)
  const rest = pos - base
  const next = sorted[base + 1]
  return next == null ? sorted[base] : sorted[base] + rest * (next - sorted[base])
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    const next = text[i + 1]
    if (char === '"' && quoted && next === '"') {
      cell += '"'
      i++
    } else if (char === '"') {
      quoted = !quoted
    } else if (char === ',' && !quoted) {
      row.push(cell)
      cell = ''
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && next === '\n') i++
      row.push(cell)
      if (row.some(value => value.trim() !== '')) rows.push(row)
      row = []
      cell = ''
    } else {
      cell += char
    }
  }
  row.push(cell)
  if (row.some(value => value.trim() !== '')) rows.push(row)
  return rows
}

export function parseTradingEconomicsForecastHtml(html: string, fetchedAt: string, now = new Date()): ForecastPoint[] {
  if (typeof DOMParser === 'undefined') return []
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const tables = [...doc.querySelectorAll('table')]
  for (const table of tables) {
    const headers = [...table.querySelectorAll('thead th, tr:first-child th, tr:first-child td')]
      .map(cell => cell.textContent?.trim() ?? '')
    const horizonIndexes = headers
      .map((header, index) => ({ header, index }))
      .filter(item => /^Q[1-4]\s*[/\-]?\s*\d{2,4}$/i.test(item.header))
    if (horizonIndexes.length === 0) continue

    const rows = [...table.querySelectorAll('tbody tr, tr')].slice(1)
    const eurUsdRow = rows.find(row => /EUR\s*USD|EUR\/USD|Euro/i.test(row.textContent ?? ''))
    if (!eurUsdRow) continue
    const cells = [...eurUsdRow.querySelectorAll('td, th')].map(cell => cell.textContent?.trim() ?? '')

    return horizonIndexes.flatMap(({ header, index }) => {
      const value = parseNumber(cells[index] ?? '')
      if (value == null) return []
      return [{
        source: 'trading_economics',
        sourceLabel: 'Trading Economics',
        kind: 'model_forecast',
        date: horizonDateFromHeader(header, now),
        value,
        url: TRADING_ECONOMICS_URL,
        fetchedAt,
        caveat: 'Model/analyst forecast; scraped from public page.',
      } satisfies ForecastPoint]
    })
  }
  return []
}

export function parseEcbSpfCsv(csv: string, monthsAhead: number, fetchedAt: string, url: string, now = new Date()): ForecastPoint | null {
  const rows = parseCsv(csv)
  if (rows.length < 2) return null
  const headers = rows[0].map(header => header.trim())
  const timeIndex = headers.indexOf('TIME_PERIOD')
  const valueIndex = headers.indexOf('OBS_VALUE')
  if (timeIndex < 0 || valueIndex < 0) return null

  let latest = ''
  const byPeriod = new Map<string, number[]>()
  for (const row of rows.slice(1)) {
    const period = row[timeIndex]?.trim() ?? ''
    const value = parseNumber(row[valueIndex] ?? '')
    if (!period || value == null) continue
    if (period > latest) latest = period
    byPeriod.set(period, [...(byPeriod.get(period) ?? []), value])
  }
  const values = latest ? byPeriod.get(latest) ?? [] : []
  if (values.length === 0) return null
  const median = quantile(values, 0.5)
  const avg = mean(values)
  return {
    source: 'ecb_spf',
    sourceLabel: 'ECB SPF',
    kind: 'survey_forecast',
    date: isoDate(addMonths(now, monthsAhead)),
    value: median ?? avg,
    low: values.length >= 5 ? quantile(values, 0.1) : undefined,
    high: values.length >= 5 ? quantile(values, 0.9) : undefined,
    median,
    mean: avg,
    label: `SPF ${monthsAhead}M`,
    url,
    fetchedAt,
    caveat: 'ECB Survey of Professional Forecasters; survey assumptions, not market prices.',
  }
}

export function parseYahooChartResponse(data: unknown, symbol: string, fetchedAt: string, now = new Date()): ForecastPoint | null {
  const result = (data as { chart?: { result?: Array<{ meta?: { regularMarketPrice?: number } }> } })?.chart?.result?.[0]
  const value = Number(result?.meta?.regularMarketPrice)
  if (!Number.isFinite(value) || value <= 0) return null
  const monthCode = symbol.match(/6E([FGHJKMNQUVXZ])(\d{2})\.CME/i)
  const monthsByCode: Record<string, number> = { F: 1, G: 2, H: 3, J: 4, K: 5, M: 6, N: 7, Q: 8, U: 9, V: 10, X: 11, Z: 12 }
  const date = monthCode
    ? `${2000 + Number(monthCode[2])}-${String(monthsByCode[monthCode[1].toUpperCase()]).padStart(2, '0')}-15`
    : isoDate(now)
  return {
    source: 'euro_fx_futures',
    sourceLabel: 'Euro FX futures',
    kind: 'market_implied_forward',
    date,
    value,
    label: 'Euro FX futures',
    url: `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}`,
    fetchedAt,
    caveat: 'Futures/forward-implied rate; not a spot forecast.',
  }
}

function parseYahooQuoteRow(row: unknown, fetchedAt: string, now = new Date()): ForecastPoint | null {
  const quote = row as { symbol?: string; regularMarketPrice?: number; bid?: number; ask?: number; regularMarketPreviousClose?: number }
  const symbol = quote.symbol ?? ''
  const value = Number(quote.regularMarketPrice ?? quote.bid ?? quote.ask ?? quote.regularMarketPreviousClose)
  if (!symbol || !Number.isFinite(value) || value <= 0) return null
  return parseYahooChartResponse({ chart: { result: [{ meta: { regularMarketPrice: value } }] } }, symbol, fetchedAt, now)
}

function euroFxYahooSymbols(now = new Date()) {
  const symbols = ['6E=F']
  const currentYear = now.getFullYear()
  const currentMonth = now.getMonth() + 1
  for (let year = currentYear; year <= currentYear + 2 && symbols.length < 9; year++) {
    for (const code of CME_QUARTER_MONTH_CODES) {
      const month = { H: 3, M: 6, U: 9, Z: 12 }[code]
      if (year === currentYear && month < currentMonth) continue
      symbols.push(`6E${code}${String(year).slice(2)}.CME`)
      if (symbols.length >= 9) break
    }
  }
  return symbols
}

export function parsePredictionMarketItems(items: unknown[], source: 'kalshi' | 'polymarket', fetchedAt: string, url: string): ForecastPoint[] {
  return items.flatMap(item => {
    const record = item as Record<string, unknown>
    const label = String(record.title ?? record.question ?? record.subtitle ?? record.ticker ?? '')
    if (!/EUR\s*\/?\s*USD/i.test(label)) return []
    if (!/(\d+\.\d+|\d{1,2}\s*cents?)/i.test(label)) return []
    const outcomePrices = Array.isArray(record.outcomePrices) ? record.outcomePrices : []
    const probabilityRaw = Number(record.yes_bid ?? record.yes_ask ?? record.last_price ?? record.bestAsk ?? record.bestBid ?? outcomePrices[0])
    const probability = probabilityRaw > 1 ? probabilityRaw / 100 : probabilityRaw
    if (!Number.isFinite(probability) || probability < 0 || probability > 1) return []
    const dateMatch = label.match(/(20\d{2}[-/]\d{1,2}[-/]\d{1,2}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+20\d{2})/i)
    const parsedDate = dateMatch ? new Date(dateMatch[0].replace(/\//g, '-')) : new Date()
    return [{
      source,
      sourceLabel: source === 'kalshi' ? 'Kalshi' : 'Polymarket',
      kind: 'prediction_market_probability',
      date: isoDate(Number.isNaN(parsedDate.getTime()) ? new Date() : parsedDate),
      probability,
      label,
      url,
      fetchedAt,
      caveat: 'Event probability, not a point forecast.',
    } satisfies ForecastPoint]
  })
}

export async function fetchTradingEconomicsForecast(options: FetcherOptions = {}): Promise<ForecastResult> {
  return cachedFetch('trading-economics', 12 * 60 * 60 * 1000, async () => {
    try {
      const fetchedAt = new Date().toISOString()
      const res = await (options.fetchImpl ?? fetch)(proxiedUrl(TRADING_ECONOMICS_URL, options.proxyUrl))
      if (!res.ok) throw new Error(`Trading Economics returned ${res.status}`)
      const points = parseTradingEconomicsForecastHtml(await res.text(), fetchedAt, options.now)
      return { points, warnings: points.length ? [] : ['Trading Economics EUR/USD row was not found.'] }
    } catch (error) {
      return { points: [], warnings: [`Trading Economics forecast unavailable: ${error instanceof Error ? error.message : String(error)}`] }
    }
  })
}

export async function fetchEcbSpfForecast(options: FetcherOptions = {}): Promise<ForecastResult> {
  return cachedFetch('ecb-spf', 7 * 24 * 60 * 60 * 1000, async () => {
    const warnings: string[] = []
    const points: ForecastPoint[] = []
    for (const [, url, months] of ECB_SPF_URLS) {
      try {
        const fetchedAt = new Date().toISOString()
        const res = await (options.fetchImpl ?? fetch)(proxiedUrl(url, options.proxyUrl))
        if (!res.ok) throw new Error(`ECB returned ${res.status}`)
        const point = parseEcbSpfCsv(await res.text(), months, fetchedAt, url, options.now)
        if (point) points.push({ ...point, sourceLabel: `ECB SPF ${months}M`, label: `ECB SPF ${months}M` })
      } catch (error) {
        warnings.push(`ECB SPF ${months}M unavailable: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    return { points: points.sort((a, b) => a.date.localeCompare(b.date)), warnings }
  })
}

export async function fetchEuroFxFutures(options: FetcherOptions = {}): Promise<ForecastResult> {
  return cachedFetch('euro-fx-futures', 60 * 60 * 1000, async () => {
    const warnings: string[] = []
    const points: ForecastPoint[] = []
    const symbols = euroFxYahooSymbols(options.now)
    try {
      const fetchedAt = new Date().toISOString()
      const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${symbols.map(encodeURIComponent).join(',')}`
      const res = await (options.fetchImpl ?? fetch)(proxiedUrl(url, options.proxyUrl))
      if (!res.ok) throw new Error(`Yahoo quote returned ${res.status}`)
      const data = await res.json()
      const rows = Array.isArray(data?.quoteResponse?.result) ? data.quoteResponse.result : []
      for (const row of rows) {
        const point = parseYahooQuoteRow(row, fetchedAt, options.now)
        if (point) points.push(point)
      }
    } catch (error) {
      warnings.push(`Yahoo futures quote batch unavailable: ${error instanceof Error ? error.message : String(error)}`)
    }

    const foundSymbols = new Set(points.map(point => point.url.split('/quote/')[1] ? decodeURIComponent(point.url.split('/quote/')[1]) : ''))
    for (const symbol of symbols.filter(symbol => !foundSymbols.has(symbol))) {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1d`
      try {
        const fetchedAt = new Date().toISOString()
        const res = await (options.fetchImpl ?? fetch)(proxiedUrl(url, options.proxyUrl))
        if (!res.ok) throw new Error(`Yahoo returned ${res.status}`)
        const point = parseYahooChartResponse(await res.json(), symbol, fetchedAt, options.now)
        if (point) points.push(point)
      } catch (error) {
        warnings.push(`${symbol} unavailable: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    return {
      points: points.sort((a, b) => a.date.localeCompare(b.date)),
      warnings: points.length ? warnings : ['Euro FX futures unavailable from Yahoo Finance symbols.'],
    }
  })
}

export async function fetchPredictionMarkets(options: FetcherOptions = {}): Promise<ForecastResult> {
  return cachedFetch('prediction-markets', 15 * 60 * 1000, async () => {
    const warnings: string[] = []
    const points: ForecastPoint[] = []
    const fetchJson = async (url: string) => {
      const res = await (options.fetchImpl ?? fetch)(proxiedUrl(url, options.proxyUrl))
      if (!res.ok) throw new Error(`returned ${res.status}`)
      return res.json()
    }

    try {
      const fetchedAt = new Date().toISOString()
      const kalshiData = await fetchJson(`${KALSHI_BASE}/markets?limit=100&status=open`)
      const kalshiItems = Array.isArray(kalshiData?.markets) ? kalshiData.markets : []
      points.push(...parsePredictionMarketItems(kalshiItems, 'kalshi', fetchedAt, `${KALSHI_BASE}/markets`))
    } catch (error) {
      warnings.push(`Kalshi unavailable: ${error instanceof Error ? error.message : String(error)}`)
    }

    for (const url of POLYMARKET_URLS) {
      try {
        const fetchedAt = new Date().toISOString()
        const data = await fetchJson(url)
        const items = Array.isArray(data) ? data : Array.isArray(data?.markets) ? data.markets : Array.isArray(data?.events) ? data.events : []
        points.push(...parsePredictionMarketItems(items, 'polymarket', fetchedAt, url))
      } catch (error) {
        warnings.push(`Polymarket unavailable: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    return { points, warnings }
  })
}

export async function getCombinedEurUsdForecast(options: FetcherOptions = {}): Promise<ForecastResult> {
  const results = [
    await fetchTradingEconomicsForecast(options),
    await fetchEcbSpfForecast(options),
    await fetchEuroFxFutures(options),
  ]
  if (options.includePredictionMarkets) {
    results.push(await fetchPredictionMarkets(options))
  }
  return {
    points: results.flatMap(result => result.points).sort((a, b) => a.date.localeCompare(b.date)),
    warnings: results.flatMap(result => result.warnings),
  }
}
