import type { PlaidHolding } from '../types'

export async function fetchPlaidHoldings(proxyUrl: string, accessToken: string): Promise<PlaidHolding[]> {
  const res = await fetch(`${proxyUrl.replace(/\/$/, '')}/plaid/investments/holdings/get`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ access_token: accessToken })
  })

  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`Plaid API error ${res.status}: ${errText}`)
  }

  const data = await res.json()
  
  return data.holdings.map((h: any) => {
    const sec = data.securities.find((s: any) => s.security_id === h.security_id)
    return {
      ticker: sec?.ticker_symbol ?? null,
      name: sec?.name ?? 'Unknown',
      quantity: h.quantity,
      institutionPrice: h.institution_price,
      institutionValue: h.institution_value,
      costBasis: h.cost_basis,
      currency: h.iso_currency_code ?? 'USD'
    }
  })
}
