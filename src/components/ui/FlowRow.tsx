import { formatCurrency } from '../../lib/format'

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

export function monthLabel(ym: string): string {
  const [y, m] = ym.split('-')
  return `${MONTH_NAMES[parseInt(m) - 1]} ${y}`
}

export function recurrenceNote(frequency: string, _startDate: string, endDate: string | null): string {
  if (frequency === 'one_time') return ''
  const end = endDate ? ` · ends ${monthLabel(endDate)}` : ''
  if (frequency === 'monthly') return `monthly${end}`
  if (frequency === 'yearly') return `yearly${end}`
  return ''
}

export interface FlowRowProps {
  dateLabel: string
  description: string
  note?: string
  recurring: boolean
  amount: number
  currency: string
  colorClass: string
  sign: '+' | '−'
  tag?: React.ReactNode
  dimmed?: boolean
}

export function FlowRow({ dateLabel, description, note, recurring, amount, currency, colorClass, sign, tag, dimmed }: FlowRowProps) {
  return (
    <div className={`flex items-center gap-2 py-[5px] border-b border-gray-100 dark:border-gray-700 last:border-0${dimmed ? ' opacity-40' : ''}`}>
      <span className="text-[10px] text-gray-400 shrink-0 w-[56px]">{dateLabel}</span>
      <span className="w-[14px] shrink-0 text-[11px] text-gray-400 text-center" title={recurring ? 'Recurring' : ''}>{recurring ? '↻' : ''}</span>
      <span className="flex-1 min-w-0 truncate">
        <span className="text-[12px] text-gray-900 dark:text-white">{description}</span>
        {note && <span className="text-[10px] text-gray-400 ml-1.5">{note}</span>}
      </span>
      {tag}
      <span className={`text-[12px] font-medium shrink-0 ${colorClass}`}>
        {sign}{formatCurrency(amount, currency)}
      </span>
    </div>
  )
}
