export interface FredMonthlyPoint {
  month: string
  value: number
}

export interface FredDailyPoint {
  date: string
  value: number
}

interface FredObservation {
  date?: string
  value?: string
}

function monthKey(date: string): string {
  return date.slice(0, 7)
}

export async function fetchFredMonthlySeries(
  apiKey: string,
  seriesId: string,
  startDate = '1990-01-01',
  proxyUrl?: string | null,
): Promise<FredMonthlyPoint[]> {
  const params = new URLSearchParams({
    series_id: seriesId,
    api_key: apiKey,
    file_type: 'json',
    observation_start: startDate,
  })
  const base = proxyUrl ? `${proxyUrl.replace(/\/$/, '')}/fred` : 'https://api.stlouisfed.org/fred'
  const url = `${base}/series/observations?${params.toString()}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`FRED ${seriesId} returned ${res.status}`)
  const data = await res.json()
  const observations = Array.isArray(data?.observations) ? data.observations as FredObservation[] : []

  const byMonth = new Map<string, { date: string; value: number }>()
  for (const obs of observations) {
    const date = obs.date ?? ''
    const value = Number(obs.value)
    if (!date || !Number.isFinite(value)) continue
    const month = monthKey(date)
    const existing = byMonth.get(month)
    if (!existing || date > existing.date) byMonth.set(month, { date, value })
  }

  return [...byMonth.entries()]
    .map(([month, point]) => ({ month, value: point.value }))
    .sort((a, b) => a.month.localeCompare(b.month))
}

export async function fetchFredDailySeries(
  apiKey: string,
  seriesId: string,
  startDate = '1999-01-01',
  proxyUrl?: string | null,
): Promise<FredDailyPoint[]> {
  const params = new URLSearchParams({
    series_id: seriesId,
    api_key: apiKey,
    file_type: 'json',
    observation_start: startDate,
  })
  const base = proxyUrl ? `${proxyUrl.replace(/\/$/, '')}/fred` : 'https://api.stlouisfed.org/fred'
  const url = `${base}/series/observations?${params.toString()}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`FRED ${seriesId} returned ${res.status}`)
  const data = await res.json()
  const observations = Array.isArray(data?.observations) ? data.observations as FredObservation[] : []

  return observations
    .map(obs => ({ date: obs.date ?? '', value: Number(obs.value) }))
    .filter(point => point.date && Number.isFinite(point.value))
    .sort((a, b) => a.date.localeCompare(b.date))
}
