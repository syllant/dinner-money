// Simple currency conversion helpers.
// Exchange rate is user-configurable (stored in app state for projections).
// For display we use a spot rate constant; in projections the MC engine handles drift.

export const DEFAULT_EUR_USD_RATE = 1.08

export function toEUR(amountUSD: number, rate = DEFAULT_EUR_USD_RATE): number {
  return amountUSD / rate
}

export function toUSD(amountEUR: number, rate = DEFAULT_EUR_USD_RATE): number {
  return amountEUR * rate
}

export function convertToBase(
  amount: number,
  fromCurrency: string,
  baseCurrency: 'EUR' | 'USD',
  rate = DEFAULT_EUR_USD_RATE
): number {
  const from = fromCurrency.toUpperCase()
  if (from === baseCurrency) return amount
  if (baseCurrency === 'EUR' && from === 'USD') return toEUR(amount, rate)
  if (baseCurrency === 'USD' && from === 'EUR') return toUSD(amount, rate)
  return amount
}
