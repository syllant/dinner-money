import { clsx } from 'clsx'

type BannerVariant = 'info' | 'warning' | 'success'

const styles: Record<BannerVariant, string> = {
  info: 'bg-blue-50 border-blue-200 text-blue-700 dark:bg-blue-900/20 dark:border-blue-700 dark:text-blue-300',
  warning: 'bg-amber-50 border-amber-200 text-amber-700 dark:bg-amber-900/20 dark:border-amber-700 dark:text-amber-300',
  success: 'bg-green-50 border-green-200 text-green-700 dark:bg-green-900/20 dark:border-green-700 dark:text-green-300',
}

export function Banner({ variant = 'info', children, className }: { variant?: BannerVariant; children: React.ReactNode; className?: string }) {
  return (
    <div className={clsx('border rounded-lg px-3 py-[9px] text-[11.5px]', styles[variant], className)}>
      {children}
    </div>
  )
}
