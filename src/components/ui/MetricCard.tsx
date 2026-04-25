import { clsx } from 'clsx'

interface MetricCardProps {
  label: string
  value: string
  sub?: string
  valueClass?: string
}

export function MetricCard({ label, value, sub, valueClass }: MetricCardProps) {
  return (
    <div className="bg-gray-50 dark:bg-gray-800 rounded-lg px-[13px] py-[11px]">
      <div className="text-[11px] text-gray-500 dark:text-gray-400 mb-1">{label}</div>
      <div className={clsx('text-[20px] font-medium', valueClass ?? 'text-gray-900 dark:text-white')}>
        {value}
      </div>
      {sub && <div className="text-[10.5px] text-gray-400 mt-[2px]">{sub}</div>}
    </div>
  )
}
