import { clsx } from 'clsx'

export function Table({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={clsx('border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden', className)}>
      {children}
    </div>
  )
}

export function TableHead({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-gray-50 dark:bg-gray-800 px-3 py-[7px] text-[10px] font-medium text-gray-500 dark:text-gray-400 uppercase tracking-[0.04em]">
      {children}
    </div>
  )
}

export function TableRow({ children, className, dimmed }: { children: React.ReactNode; className?: string; dimmed?: boolean }) {
  return (
    <div className={clsx(
      'px-3 py-[9px] border-t border-gray-200 dark:border-gray-700 text-[12.5px] items-center',
      dimmed ? 'text-gray-400 dark:text-gray-500 italic' : 'text-gray-900 dark:text-white',
      className
    )}>
      {children}
    </div>
  )
}

export function TableAddRow({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full px-3 py-[8px] border-t border-gray-200 dark:border-gray-700 text-[11.5px] text-gray-500 dark:text-gray-400 flex items-center gap-[5px] hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer text-left"
    >
      {children}
    </button>
  )
}
