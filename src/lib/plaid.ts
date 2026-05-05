import type { PlaidHolding, PlaidDividend, AssetAllocation, TaxLot } from '../types'

async function plaidPost(proxyUrl: string, path: string, body: object): Promise<any> {
  const res = await fetch(`${proxyUrl.replace(/\/$/, '')}/plaid${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const errData = await res.json().catch(() => null)
    const code = errData?.error_code ? `[${errData.error_code}] ` : ''
    throw new Error(code + (errData?.error_message ?? `Plaid API error ${res.status}`))
  }
  return res.json()
}

export async function fetchPlaidHoldings(proxyUrl: string, accessToken: string): Promise<PlaidHolding[]> {
  const data = await plaidPost(proxyUrl, '/investments/holdings/get', { access_token: accessToken })
  return data.holdings.map((h: any) => {
    const sec = data.securities.find((s: any) => s.security_id === h.security_id)
    return {
      ticker: sec?.ticker_symbol ?? null,
      name: sec?.name ?? 'Unknown',
      quantity: parseFloat(h.quantity) || 0,
      institutionPrice: parseFloat(h.institution_price) || 0,
      institutionValue: parseFloat(h.institution_value) || 0,
      costBasis: h.cost_basis != null ? parseFloat(h.cost_basis) || null : null,
      currency: (h.iso_currency_code ?? 'USD').toUpperCase(),
      securityType: (sec?.type ?? 'equity').toLowerCase(),
    }
  })
}

export interface PlaidInvestmentData {
  dividends: PlaidDividend[]
  buyDates: Record<string, string>  // ticker → most recent buy transaction date (YYYY-MM-DD)
}

export function deriveTaxLots(holdings: PlaidHolding[], source: TaxLot['source']): TaxLot[] {
  return holdings
    .filter(holding => !holding.ticker?.startsWith('CUR:'))
    .filter(holding => holding.institutionValue > 0)
    .map((holding, index) => ({
      id: `${source}-${holding.ticker ?? holding.name}-${index}`,
      ticker: holding.ticker,
      name: holding.name,
      quantity: holding.quantity,
      marketValue: holding.institutionValue,
      costBasis: holding.costBasis,
      currency: holding.currency,
      acquiredDate: holding.purchaseDate,
      source,
    }))
}

export function derivePlaidTaxLots(holdings: PlaidHolding[]): TaxLot[] {
  return deriveTaxLots(holdings, 'plaid')
}

export async function fetchPlaidInvestmentData(proxyUrl: string, accessToken: string): Promise<PlaidInvestmentData> {
  const end = new Date()
  const start = new Date(end)
  start.setMonth(start.getMonth() - 18)
  const fmt = (d: Date) => d.toISOString().slice(0, 10)

  const data = await plaidPost(proxyUrl, '/investments/transactions/get', {
    access_token: accessToken,
    start_date: fmt(start),
    end_date: fmt(end),
  })

  const dividends: PlaidDividend[] = (data.investment_transactions ?? [])
    .filter((t: any) => t.type === 'dividend')
    .map((t: any) => {
      const sec = (data.securities ?? []).find((s: any) => s.security_id === t.security_id)
      return {
        securityName: sec?.name ?? t.name ?? 'Dividend',
        ticker: sec?.ticker_symbol ?? null,
        amount: Math.abs(t.amount),
        currency: (t.iso_currency_code ?? 'USD').toUpperCase(),
        date: t.date,
      }
    })

  const buyDates: Record<string, string> = {}
  for (const t of (data.investment_transactions ?? [])) {
    if (t.type !== 'buy') continue
    const sec = (data.securities ?? []).find((s: any) => s.security_id === t.security_id)
    const ticker = sec?.ticker_symbol
    if (!ticker) continue
    if (!buyDates[ticker] || t.date > buyDates[ticker]) buyDates[ticker] = t.date
  }

  return { dividends, buyDates }
}

// Derive equity/bonds/cash split from holdings security types.
// Uses flexible substring matching to handle both Plaid ('fixed income', 'cash')
// and SnapTrade type strings ('fixed_income', 'bond', 'money market', etc.).
export function computeAllocationFromHoldings(holdings: PlaidHolding[]): AssetAllocation {
  const total = holdings.reduce((s, h) => s + Math.max(0, h.institutionValue), 0)
  if (total <= 0) return { equity: 0, bonds: 0, cash: 100 }

  let eq = 0, bd = 0, cash = 0
  for (const h of holdings) {
    const v = h.institutionValue
    const t = h.securityType.toLowerCase()
    if (t.includes('cash') || t.includes('money market')) cash += v
    else if (t.includes('fixed') || t.includes('bond')) bd += v
    else eq += v  // equity, etf, mutual fund, derivative, other
  }

  const eqPct = Math.round(eq / total * 100)
  const bdPct = Math.round(bd / total * 100)
  return { equity: eqPct, bonds: bdPct, cash: Math.max(0, 100 - eqPct - bdPct) }
}
