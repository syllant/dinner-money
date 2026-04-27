export interface TickerDividend {
  exDate: string       // YYYY-MM-DD
  paymentDate: string  // YYYY-MM-DD
  amount: number
}

// Fetch full dividend history for a ticker from Alpha Vantage (free tier: 500 req/day)
export async function fetchTickerDividends(apiKey: string, ticker: string): Promise<TickerDividend[]> {
  const url = `https://www.alphavantage.co/query?function=DIVIDENDS&symbol=${encodeURIComponent(ticker)}&apikey=${apiKey}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Alpha Vantage returned ${res.status}`)
  const data = await res.json()
  if (data['Error Message']) throw new Error(data['Error Message'])
  if (data['Note']) throw new Error(`Alpha Vantage rate limit: ${data['Note']}`)
  if (data['Information']) throw new Error(data['Information'])
  return ((data.data ?? []) as any[])
    .map(d => ({
      exDate: d.ex_dividend_date as string,
      paymentDate: d.payment_date as string,
      amount: parseFloat(d.amount) || 0,
    }))
    .filter(d => d.amount > 0 && d.paymentDate && !isNaN(new Date(d.paymentDate).getTime()))
    .sort((a, b) => b.paymentDate.localeCompare(a.paymentDate))
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
  const snapped = avgGap < 45 ? 30 : avgGap < 136 ? 91 : avgGap < 273 ? 182 : 365
  return snapped
}

export function projectDividends(
  ticker: string,
  history: TickerDividend[],
  sharesHeld: number,
  monthsAhead = 18,
): ProjectedDividend[] {
  if (history.length === 0 || sharesHeld <= 0) return []

  // Guard against "None" or invalid payment dates that AV sometimes returns
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
