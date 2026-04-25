import type { Currency } from '../types'

// Use the browser's locale so thousands separators match the user's expectations
// (e.g. 1,000 for en-US, 1 000 for fr-FR)
const locale = typeof navigator !== 'undefined' ? navigator.language : 'en-US'

export function formatCurrency(amount: number, currency: Currency | string): string {
  const c = currency.toUpperCase()
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: c,
      maximumFractionDigits: 0,
    }).format(amount)
  } catch {
    // Fallback for unknown currency codes
    return `${amount.toLocaleString(locale)} ${c}`
  }
}

export function formatPct(value: number, decimals = 1): string {
  return `${value.toFixed(decimals)}%`
}

export function formatCompact(amount: number, currency: Currency | string): string {
  const c = currency.toUpperCase()
  const symbol = c === 'EUR' ? '€' : c === 'USD' ? '$' : c
  if (Math.abs(amount) >= 1_000_000) return `${symbol}${(amount / 1_000_000).toFixed(1)}M`
  if (Math.abs(amount) >= 1_000) return `${symbol}${(amount / 1_000).toFixed(0)}K`
  return `${symbol}${amount.toFixed(0)}`
}

/** YYYY-MM → "Jul 2026" */
export function formatYearMonth(ym: string): string {
  const [y, m] = ym.split('-')
  const date = new Date(parseInt(y), parseInt(m) - 1)
  return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
}

export function currentYearMonth(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

export function generateId(): string {
  return Math.random().toString(36).slice(2, 10)
}
