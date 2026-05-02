import { useState } from 'react'

// ─── Shared sort button ───────────────────────────────────────────────────────
// Used by any table that needs column-header sort toggles.

export interface SortState<K extends string> {
  key: K
  dir: 'asc' | 'desc'
}

/** Returns sort state + a toggle handler. */
export function useSort<K extends string>(defaultKey: K, defaultDir: 'asc' | 'desc' = 'asc') {
  const [sort, setSort] = useState<SortState<K>>({ key: defaultKey, dir: defaultDir })

  function toggle(col: K) {
    setSort(s => s.key === col
      ? { key: col, dir: s.dir === 'asc' ? 'desc' : 'asc' }
      : { key: col, dir: 'asc' }
    )
  }

  return { sort, toggle }
}

/** Sort-button for a table column header. */
export function SortBtn<K extends string>({ col, label, sort, onToggle }: {
  col: K
  label: string
  sort: SortState<K>
  onToggle: (col: K) => void
}) {
  const active = sort.key === col
  return (
    <button
      className="flex items-center gap-0.5 cursor-pointer hover:text-gray-700 dark:hover:text-gray-200 transition-colors text-left font-[inherit] text-[inherit] uppercase tracking-[inherit]"
      onClick={() => onToggle(col)}
    >
      {label}
      <span className={`text-[9px] normal-case tracking-normal ${active ? 'text-blue-500' : 'text-gray-300 dark:text-gray-600'}`}>
        {active ? (sort.dir === 'asc' ? '↑' : '↓') : '↕'}
      </span>
    </button>
  )
}
