import type { PlaidHolding, PlaidDividend, AssetAllocation, TaxLot, InvestmentEvent } from '../types'
import { useAppStore } from '../store/useAppStore'

async function plaidPost(proxyUrl: string, path: string, body: object): Promise<any> {
  const workerSecret = useAppStore.getState().lmProxySecret
  const res = await fetch(`${proxyUrl.replace(/\/$/, '')}/plaid${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(workerSecret ? { 'X-Worker-Secret': workerSecret } : {}),
    },
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
      ticker: plaidTicker(sec),
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

export interface PlaidInstitutionBrand {
  institutionId?: string
  institutionName?: string
  logoDataUrl?: string
  primaryColor?: string
}

function plaidLogoDataUrl(logo: unknown): string | undefined {
  if (typeof logo !== 'string' || !logo.trim()) return undefined
  return logo.startsWith('data:') ? logo : `data:image/png;base64,${logo}`
}

export async function fetchPlaidInstitutionBrand(proxyUrl: string, institutionId: string): Promise<PlaidInstitutionBrand | null> {
  if (!institutionId.trim()) return null
  const data = await plaidPost(proxyUrl, '/institutions/get_by_id', {
    institution_id: institutionId,
    country_codes: ['US'],
    options: { include_optional_metadata: true },
  })
  const institution = data.institution
  if (!institution) return null
  return {
    institutionId: institution.institution_id ?? institutionId,
    institutionName: institution.name,
    logoDataUrl: plaidLogoDataUrl(institution.logo),
    primaryColor: institution.primary_color,
  }
}

export async function fetchPlaidItemInstitutionBrand(proxyUrl: string, accessToken: string): Promise<PlaidInstitutionBrand | null> {
  const data = await plaidPost(proxyUrl, '/item/get', { access_token: accessToken })
  const institutionId = data.item?.institution_id
  if (typeof institutionId !== 'string' || !institutionId.trim()) return null
  return fetchPlaidInstitutionBrand(proxyUrl, institutionId)
}

function plaidTicker(sec: any): string | null {
  const explicit = sec?.ticker_symbol ?? sec?.tickerSymbol ?? sec?.symbol
  if (typeof explicit === 'string' && explicit.trim()) return explicit.trim().toUpperCase()
  const name = typeof sec?.name === 'string' ? sec.name.trim() : ''
  const match = name.match(/\b[A-Z]{1,5}(?:\.[A-Z])?\b$/)
  return match ? match[0] : null
}

export interface PlaidInvestmentData {
  dividends: PlaidDividend[]
  buyDates: Record<string, string>  // ticker → most recent buy transaction date (YYYY-MM-DD)
  investmentEvents: InvestmentEvent[]
}

function plaidEventType(t: { type: string; subtype?: string | null; amount?: number }): InvestmentEvent['type'] | null {
  if (t.type === 'buy') return 'buy'
  if (t.type === 'sell') return 'sell'
  if (t.type === 'transfer') return (t.amount ?? 0) < 0 ? 'transfer_in' : 'transfer_out'
  if (t.type === 'cash') {
    const sub = (t.subtype ?? '').toLowerCase()
    if (['contribution', 'deposit', 'rollover'].includes(sub)) return 'transfer_in'
    if (['withdrawal', 'distribution', 'disbursement'].includes(sub)) return 'transfer_out'
  }
  return null
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
  const investmentEvents: InvestmentEvent[] = []
  for (const t of (data.investment_transactions ?? [])) {
    const sec = (data.securities ?? []).find((s: any) => s.security_id === t.security_id)
    const ticker: string | null = sec?.ticker_symbol ?? null
    if (t.type === 'buy' && ticker) {
      if (!buyDates[ticker] || t.date > buyDates[ticker]) buyDates[ticker] = t.date
    }
    const evType = plaidEventType(t)
    if (evType) {
      investmentEvents.push({
        date: t.date,
        type: evType,
        ticker,
        name: sec?.name ?? t.name ?? '',
        amount: Math.abs(t.amount ?? 0),
        currency: (t.iso_currency_code ?? 'USD').toUpperCase(),
        quantity: t.quantity != null ? Math.abs(t.quantity) : undefined,
      })
    }
  }

  return { dividends, buyDates, investmentEvents }
}

// Derive equity/bonds/cash split from holdings security types.
// Uses flexible substring matching to handle provider variations like
// 'fixed_income', 'bond', 'money market', etc.
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
