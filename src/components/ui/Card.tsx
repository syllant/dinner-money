import { clsx } from 'clsx'

export function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={clsx('border border-gray-200 dark:border-gray-700 rounded-xl p-[13px]', className)}>
      {children}
    </div>
  )
}

export function CardTitle({ children }: { children: React.ReactNode }) {
  return <div className="text-[11.5px] font-medium text-gray-500 dark:text-gray-400 mb-[10px]">{children}</div>
}
