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
