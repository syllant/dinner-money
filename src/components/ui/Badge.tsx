import { clsx } from 'clsx'

type BadgeVariant = 'eur' | 'usd' | 'fr' | 'us' | 'success' | 'warning' | 'info' | 'purple' | 'neutral'

const variants: Record<BadgeVariant, string> = {
  eur: 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  usd: 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  fr: 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  us: 'bg-teal-50 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300',
  success: 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  warning: 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  info: 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  purple: 'bg-purple-50 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
  neutral: 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400',
}

export function Badge({ variant = 'neutral', children }: { variant?: BadgeVariant; children: React.ReactNode }) {
  return (
    <span className={clsx('inline-flex w-fit items-center text-[10px] px-[7px] py-[2px] rounded-[3px] font-medium', variants[variant])}>
      {children}
    </span>
  )
}
