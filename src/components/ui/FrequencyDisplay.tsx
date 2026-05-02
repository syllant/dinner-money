// ─── Shared frequency display utilities ───────────────────────────────────────
// Used by both Expenses and Income (Windfalls) pages.

import type { ExpenseFrequency, ExpenseInstallment } from '../../types'

// ─── Period label ─────────────────────────────────────────────────────────────

export function periodLabel(
  freq: string,
  startDate: string,
  endDate: string | null,
  installments?: ExpenseInstallment[],
): string {
  if (freq === 'one_time') return startDate
  if (freq === 'custom') {
    if (installments && installments.length > 0) {
      const dates = installments.map(i => i.date).sort()
      const first = dates[0]
      const last = dates[dates.length - 1]
      return first === last ? first : `${first} → ${last}`
    }
    return 'custom'
  }
  return endDate ? `${startDate} → ${endDate}` : `${startDate} →`
}

// ─── Icons ────────────────────────────────────────────────────────────────────

export function RecurringIcon({ letter }: { letter: string }) {
  const isM = letter.toLowerCase() === 'm'
  const text = isM ? 'M' : 'Y'
  const colorCls = isM ? 'text-blue-600 dark:text-blue-400' : 'text-green-600 dark:text-green-400'
  
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" strokeLinecap="round" strokeLinejoin="round" className={`inline-block overflow-visible ${colorCls}`}>
      {/* Outline */}
      <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" stroke="white" strokeWidth="5" className="dark:stroke-gray-900" />
      <path d="M21 3v5h-5" stroke="white" strokeWidth="5" className="dark:stroke-gray-900" />
      {/* Colored Foreground */}
      <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" stroke="currentColor" strokeWidth="2.5" />
      <path d="M21 3v5h-5" stroke="currentColor" strokeWidth="2.5" />
      
      <text x="12" y="16" fontSize="12" fontWeight="800" fontFamily="sans-serif" textAnchor="middle"
        strokeWidth="4" strokeLinejoin="round" paintOrder="stroke"
        className="fill-current stroke-white dark:stroke-gray-900">
        {text}
      </text>
    </svg>
  )
}

export function OneTimeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" strokeLinecap="round" strokeLinejoin="round" className="inline-block overflow-visible text-purple-600 dark:text-purple-400">
      {/* Outline */}
      <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" stroke="white" strokeWidth="5" className="dark:stroke-gray-900" />
      <path d="M21 3v5h-5" stroke="white" strokeWidth="5" className="dark:stroke-gray-900" />
      {/* Colored Foreground */}
      <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" stroke="currentColor" strokeWidth="2.5" />
      <path d="M21 3v5h-5" stroke="currentColor" strokeWidth="2.5" />
      
      <text x="12" y="16" fontSize="12" fontWeight="800" fontFamily="sans-serif" textAnchor="middle"
        strokeWidth="4" strokeLinejoin="round" paintOrder="stroke"
        className="fill-current stroke-white dark:stroke-gray-900">
        1
      </text>
    </svg>
  )
}

export function InstallmentIcon({ count }: { count: number }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" strokeLinecap="round" strokeLinejoin="round" className="inline-block overflow-visible text-orange-600 dark:text-orange-400">
      {/* Outline */}
      <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" stroke="white" strokeWidth="5" className="dark:stroke-gray-900" strokeDasharray="4 2" />
      <path d="M21 3v5h-5" stroke="white" strokeWidth="5" className="dark:stroke-gray-900" />
      {/* Colored Foreground */}
      <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" stroke="currentColor" strokeWidth="2.5" strokeDasharray="4 2" />
      <path d="M21 3v5h-5" stroke="currentColor" strokeWidth="2.5" />
      
      <text x="12" y="16" fontSize="12" fontWeight="800" fontFamily="sans-serif" textAnchor="middle"
        strokeWidth="4" strokeLinejoin="round" paintOrder="stroke"
        className="fill-current stroke-white dark:stroke-gray-900">
        {count}
      </text>
    </svg>
  )
}

// ─── getFrequencyDisplay ──────────────────────────────────────────────────────

export interface FreqItem {
  frequency: ExpenseFrequency
  installments?: ExpenseInstallment[]
}

export function getFrequencyDisplay(item: FreqItem): { node: React.ReactNode; title: string } {
  if (item.frequency === 'one_time') return { node: <OneTimeIcon />, title: 'One-time' }
  if (item.frequency === 'custom') {
    const count = item.installments?.length || 0
    return { node: <InstallmentIcon count={count} />, title: `${count} installment${count !== 1 ? 's' : ''}` }
  }
  if (item.frequency === 'monthly') return { node: <RecurringIcon letter="m" />, title: 'Monthly recurring' }
  if (item.frequency === 'yearly') return { node: <RecurringIcon letter="y" />, title: 'Yearly recurring' }
  return { node: null, title: '' }
}

// ─── Currency badge constants ─────────────────────────────────────────────────

export const CUR_BADGE = 'text-[9px] font-bold px-1.5 py-px rounded'
export const EUR_BADGE_CLS = 'bg-sky-500 text-white'
export const USD_BADGE_CLS = 'bg-emerald-600 text-white'

export function curBadgeClass(currency: string) {
  return currency.toUpperCase() === 'EUR' ? EUR_BADGE_CLS : USD_BADGE_CLS
}
export function curSymbol(currency: string) {
  return currency.toUpperCase() === 'EUR' ? '€' : '$'
}
