import type { Currency } from '../types'

const EUR = new Intl.NumberFormat('en-EU', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
const USD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })

export function formatCurrency(amount: number, currency: Currency | string): string {
  const c = currency.toUpperCase()
  if (c === 'EUR') return EUR.format(amount)
  if (c === 'USD') return USD.format(amount)
  return `${amount.toLocaleString()} ${c}`
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
