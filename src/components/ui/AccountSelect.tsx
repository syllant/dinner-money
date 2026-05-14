import { useState, useRef, useEffect } from 'react'
import { useAppStore } from '../../store/useAppStore'
import type { AccountType } from '../../types'
import { AccountLabel, AccountLogo } from './AccountLabel'

// Account types that make sense as a source or destination for money flows
const FLOW_TYPES: AccountType[] = ['cash', 'investment', 'retirement']

interface AccountSelectProps {
  value: number | undefined
  onChange: (id: number | undefined) => void
  label: string
  placeholder?: string
  /** Restrict to these account types. Defaults to cash+investment+retirement. */
  allowedTypes?: AccountType[]
  /** Only show accounts matching this currency (ISO, case-insensitive). */
  currency?: string
}

export function AccountSelect({
  value,
  onChange,
  label,
  placeholder = 'Cash / unspecified',
  allowedTypes = FLOW_TYPES,
  currency,
}: AccountSelectProps) {
  const accounts = useAppStore(s => s.accounts)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  // Close dropdown when clicking outside
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
        setQuery('')
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  const selected = value != null ? accounts.find(a => a.id === value) : undefined

  const options = accounts
    .filter(a => a.includedInPlanning !== false)
    .filter(a => allowedTypes.includes(a.type))
    .filter(a => !currency || a.currency.toUpperCase() === currency.toUpperCase())
    .filter(a => {
      if (!query) return true
      const q = query.toLowerCase()
      return a.name.toLowerCase().includes(q) || (a.institutionName ?? '').toLowerCase().includes(q)
    })
    .sort((a, b) => a.name.localeCompare(b.name))

  function pick(id: number | undefined) {
    onChange(id)
    setOpen(false)
    setQuery('')
  }

  const displayValue = open
    ? query
    : selected
      ? `${selected.name} (${selected.currency.toUpperCase()})`
      : ''

  return (
    <div ref={containerRef} className="flex flex-col gap-1">
      <label className="text-[11px] text-gray-500">{label}</label>
      <div className="relative">
        <input
          className={`h-[32px] w-full border border-gray-300 dark:border-gray-600 rounded-[5px] ${selected && !open ? 'pl-9' : 'pl-3'} pr-7 text-[12px] bg-white dark:bg-gray-800 truncate`}
          value={displayValue}
          placeholder={open ? 'Type to filter…' : placeholder}
          onFocus={() => { setOpen(true); setQuery('') }}
          onChange={e => { setQuery(e.target.value); setOpen(true) }}
        />
        {selected && !open && (
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2">
            <AccountLogo account={selected} size="xs" />
          </span>
        )}
        {value != null && !open && (
          <button
            type="button"
            onMouseDown={e => { e.preventDefault(); pick(undefined) }}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700 text-[14px] leading-none"
            title="Clear"
          >×</button>
        )}
        {open && (
          <div className="absolute z-50 top-full mt-0.5 left-0 right-0 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-[5px] shadow-lg max-h-[180px] overflow-y-auto">
            <div
              className="px-3 py-[7px] text-[12px] text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer border-b border-gray-100 dark:border-gray-700"
              onMouseDown={e => { e.preventDefault(); pick(undefined) }}
            >
              {placeholder}
            </div>
            {options.length === 0 && (
              <div className="px-3 py-[7px] text-[11px] text-gray-400 italic">
                {query ? 'No matching accounts' : `No ${currency ?? ''} accounts of the right type`}
              </div>
            )}
            {options.map(a => (
              <div
                key={a.id}
                className={`px-3 py-[7px] text-[12px] cursor-pointer flex items-center justify-between gap-2 hover:bg-gray-50 dark:hover:bg-gray-700 ${a.id === value ? 'bg-blue-50 dark:bg-blue-900/20 font-medium' : ''}`}
                onMouseDown={e => { e.preventDefault(); pick(a.id) }}
              >
                <AccountLabel account={a} size="xs" className="flex-1" />
                <span className="text-[10px] text-gray-400 shrink-0">{a.currency.toUpperCase()} · {a.type}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/** Look up an account name by ID from the store, returns undefined if not found */
export function useAccountName(id: number | undefined): string | undefined {
  const accounts = useAppStore(s => s.accounts)
  if (id == null) return undefined
  const account = accounts.find(a => a.id === id && a.includedInPlanning !== false)
  return account?.name
}
