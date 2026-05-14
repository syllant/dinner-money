export interface EcbDailyRatePoint {
  date: string
  value: number
}

function proxiedUrl(url: string, proxyUrl?: string | null) {
  if (!proxyUrl) return url
  return `${proxyUrl.replace(/\/$/, '')}/external?url=${encodeURIComponent(url)}`
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

export function parseEcbDailyExchangeRatesCsv(csv: string): EcbDailyRatePoint[] {
  const rows = parseCsv(csv)
  if (rows.length < 2) return []
  const headers = rows[0].map(header => header.trim())
  const timeIndex = headers.indexOf('TIME_PERIOD')
  const valueIndex = headers.indexOf('OBS_VALUE')
  if (timeIndex < 0 || valueIndex < 0) return []

  return rows.slice(1)
    .map(row => ({ date: row[timeIndex]?.trim() ?? '', value: Number(row[valueIndex]) }))
    .filter(point => point.date && Number.isFinite(point.value) && point.value > 0)
    .sort((a, b) => a.date.localeCompare(b.date))
}

export async function fetchEcbDailyExchangeRates(
  startDate: string,
  proxyUrl?: string | null,
): Promise<EcbDailyRatePoint[]> {
  const params = new URLSearchParams({
    format: 'csvdata',
    startPeriod: startDate,
  })
  const url = `https://data-api.ecb.europa.eu/service/data/EXR/D.USD.EUR.SP00.A?${params.toString()}`
  const res = await fetch(proxiedUrl(url, proxyUrl))
  if (!res.ok) throw new Error(`ECB EXR returned ${res.status}`)
  return parseEcbDailyExchangeRatesCsv(await res.text())
}

// Shared localStorage cache for ECB rates (used by Sidebar and Currencies page)
export const ECB_CACHE_KEY = 'dinner-money:ecb-fx-cache'
export const ECB_CACHE_TTL = 60 * 60 * 1000 // 1 hour

export interface EcbCache { rows: EcbDailyRatePoint[]; fetchedAt: string }

export function readEcbCache(): EcbCache | null {
  try {
    const raw = localStorage.getItem(ECB_CACHE_KEY)
    if (!raw) return null
    return JSON.parse(raw) as EcbCache
  } catch { return null }
}

export function writeEcbCache(rows: EcbDailyRatePoint[]) {
  try {
    localStorage.setItem(ECB_CACHE_KEY, JSON.stringify({ rows, fetchedAt: new Date().toISOString() }))
  } catch {}
}

// Returns true if it's a weekday (ECB publishes Mon–Fri)
export function isEcbMarketDay(): boolean {
  const day = new Date().getDay()
  return day >= 1 && day <= 5
}

// Fetch 1Y+ of ECB data, read/write the shared cache
export async function fetchEcbRatesCached(
  proxyUrl: string | null | undefined,
  forceRefresh = false,
): Promise<{ rows: EcbDailyRatePoint[]; fetchedAt: Date; fromCache: boolean }> {
  if (!forceRefresh) {
    const cached = readEcbCache()
    if (cached) {
      const age = Date.now() - new Date(cached.fetchedAt).getTime()
      const sameDay = new Date(cached.fetchedAt).toISOString().slice(0, 10) === new Date().toISOString().slice(0, 10)
      // Use cache if fetched today AND within TTL
      if (sameDay && age < ECB_CACHE_TTL) {
        return { rows: cached.rows, fetchedAt: new Date(cached.fetchedAt), fromCache: true }
      }
    }
  }
  const start = new Date()
  start.setFullYear(start.getFullYear() - 1)
  start.setDate(start.getDate() - 35) // 1y + 35d buffer
  const rows = await fetchEcbDailyExchangeRates(start.toISOString().slice(0, 10), proxyUrl)
  writeEcbCache(rows)
  return { rows, fetchedAt: new Date(), fromCache: false }
}
