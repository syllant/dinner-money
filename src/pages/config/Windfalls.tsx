import { useState } from 'react'
import { useAppStore } from '../../store/useAppStore'
import { PageHeader } from '../../components/ui/PageHeader'
import { Table, TableHead, TableRow, TableAddRow } from '../../components/ui/Table'
import { SortBtn, useSort } from '../../components/ui/SortBtn'
import { AccountSelect, useAccountName } from '../../components/ui/AccountSelect'
import { NumericInput } from '../../components/ui/NumericInput'
import {
  periodLabel, getFrequencyDisplay,
  CUR_BADGE, curBadgeClass, curSymbol,
} from '../../components/ui/FrequencyDisplay'
import { generateId } from '../../lib/format'
import type { Windfall, TaxTreatment, ExpenseFrequency } from '../../types'

// ─── Constants ────────────────────────────────────────────────────────────────

const TAX_LABELS: Record<TaxTreatment, string> = {
  CAPITAL_GAINS_LT: 'LT cap. gains',
  CAPITAL_GAINS_ST: 'ST cap. gains',
  ORDINARY_INCOME: 'Ordinary income',
  TAX_FREE: 'Tax-free',
}

const INCOME_CATEGORIES = [
  'Bonus', 'Gift', 'Inheritance', 'Insurance', 'Other income',
  'Property sale', 'Rental income', 'Salary', 'Stock sale',
]

type SortKey = 'period' | 'amount' | 'name' | 'category'

// ─── Helpers ─────────────────────────────────────────────────────────────────

const blank = (): Windfall => ({
  id: generateId(), name: '', date: '2027-06', endDate: null,
  frequency: 'one_time', amount: 0,
  currency: 'USD', taxTreatment: 'ORDINARY_INCOME', category: '',
})

// [icon, period, amount+cur, name, tax, account, actions]
const GRID_COLS = 'grid grid-cols-[20px_130px_110px_2fr_110px_1fr_72px] gap-x-3 items-center'

import { EditIcon, DupIcon, DelIcon } from '../../components/ui/Icons'

// ─── Row ─────────────────────────────────────────────────────────────────────

function IncomeRow({
  w,
  editing,
  setEditing,
  onSave,
  onDuplicate,
  onDelete,
  categoryOptions
}: {
  w: Windfall;
  editing: Windfall | null;
  setEditing: (w: Windfall | null) => void;
  onSave: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  categoryOptions: string[];
}) {
  const accountName = useAccountName(w.targetAccountId)
  const freq = getFrequencyDisplay({ frequency: w.frequency })
  const period = periodLabel(w.frequency, w.date, w.endDate ?? null)

  return (
    <TableRow>
      <div className={GRID_COLS}>
        <span className="flex items-center justify-center text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 cursor-help" title={freq.title}>
          {freq.node}
        </span>
        <span className="text-[10.5px] text-gray-400 truncate">{period}</span>
        <div className="flex items-center justify-end gap-1">
          <span className="font-medium tabular-nums">{w.amount.toLocaleString()}</span>
          <span className={`${CUR_BADGE} ${curBadgeClass(w.currency)}`}>{curSymbol(w.currency)}</span>
        </div>
        <div className="min-w-0 truncate pl-2">
          <span>{w.name}</span>
        </div>
        <span className="text-[10.5px] text-gray-400 truncate">{TAX_LABELS[w.taxTreatment]}</span>
        <span className="text-[10.5px] text-gray-400 truncate">{accountName ?? '—'}</span>
        <div className="flex gap-2 justify-end">
          <button className="text-gray-400 hover:text-blue-500" onClick={() => setEditing(w)}><EditIcon /></button>
          <button className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300" onClick={onDuplicate}><DupIcon /></button>
          <button className="text-gray-400 hover:text-red-500" onClick={onDelete}><DelIcon /></button>
        </div>
      </div>
      {editing?.id === w.id && editing && (
        <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-700/60">
          <EditForm
            editing={editing as Windfall}
            onChange={patch => setEditing({ ...editing, ...patch })}
            onSave={onSave}
            onCancel={() => setEditing(null)}
            categoryOptions={categoryOptions}
            embedded
          />
        </div>
      )}
    </TableRow>
  )
}

// ─── Edit form ────────────────────────────────────────────────────────────────

function EditForm({ editing, onChange, onSave, onCancel, categoryOptions, embedded }: {
  editing: Windfall
  onChange: (patch: Partial<Windfall>) => void
  onSave: () => void
  onCancel: () => void
  categoryOptions: string[]
  embedded?: boolean
}) {
  const isOneTime = editing.frequency === 'one_time'
  return (
    <div className={embedded ? "space-y-3 mb-1" : "border border-blue-200 rounded-xl p-4 bg-blue-50 dark:bg-blue-900/10 space-y-3 mb-4"}>
      {/* Row 1: Name + Category */}
      <div className="grid grid-cols-[1fr_180px] gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-[11px] text-gray-500">Name</label>
          <input className="h-[32px] border border-gray-300 rounded-[5px] px-3 text-[12px] bg-white dark:bg-gray-800"
            value={editing.name} onChange={e => onChange({ name: e.target.value })} autoFocus />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[11px] text-gray-500">Category</label>
          <input
            className="h-[32px] border border-gray-300 rounded-[5px] px-3 text-[12px] bg-white dark:bg-gray-800"
            list="income-categories"
            value={editing.category ?? ''}
            onChange={e => onChange({ category: e.target.value })}
            onFocus={e => e.target.select()}
            placeholder="e.g. Salary"
          />
          <datalist id="income-categories">
            {categoryOptions.map(c => <option key={c} value={c} />)}
          </datalist>
        </div>
      </div>
      {/* Row 2: Amount + Currency + Tax treatment + Account */}
      <div className="grid grid-cols-[1fr_100px_1fr_1fr] gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-[11px] text-gray-500">Amount</label>
          <NumericInput
            className="h-[32px] border border-gray-300 rounded-[5px] px-3 text-[12px] bg-white dark:bg-gray-800 w-full"
            value={editing.amount}
            onChange={v => onChange({ amount: v ?? 0 })}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[11px] text-gray-500">Currency</label>
          <select className="h-[32px] border border-gray-300 rounded-[5px] px-2 text-[12px] bg-white dark:bg-gray-800"
            value={editing.currency} onChange={e => onChange({ currency: e.target.value as 'USD' | 'EUR' })}>
            <option value="USD">USD</option><option value="EUR">EUR</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[11px] text-gray-500">Tax treatment</label>
          <select className="h-[32px] border border-gray-300 rounded-[5px] px-2 text-[12px] bg-white dark:bg-gray-800"
            value={editing.taxTreatment} onChange={e => onChange({ taxTreatment: e.target.value as TaxTreatment })}>
            {Object.entries(TAX_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <AccountSelect
          label="Proceeds deposited to"
          placeholder="Cash (unspecified)"
          currency={editing.currency}
          value={editing.targetAccountId}
          onChange={id => onChange({ targetAccountId: id })}
        />
      </div>
      {/* Row 3: Frequency + Date + End */}
      <div className="flex gap-3">
        <div className="flex flex-col gap-1 w-[160px] shrink-0">
          <label className="text-[11px] text-gray-500">Frequency</label>
          <select className="h-[32px] border border-gray-300 rounded-[5px] px-2 text-[12px] bg-white dark:bg-gray-800"
            value={editing.frequency}
            onChange={e => onChange({ frequency: e.target.value as ExpenseFrequency })}>
            <option value="one_time">One-time</option>
            <option value="monthly">Monthly</option>
            <option value="yearly">Yearly</option>
          </select>
        </div>
        <div className="flex flex-col gap-1 w-[120px] shrink-0">
          <label className="text-[11px] text-gray-500">{isOneTime ? 'Date (YYYY-MM)' : 'Start (YYYY-MM)'}</label>
          <input className="h-[32px] border border-gray-300 rounded-[5px] px-3 text-[12px] bg-white dark:bg-gray-800"
            value={editing.date} onChange={e => onChange({ date: e.target.value })} placeholder="2027-06" />
        </div>
        {!isOneTime && (
          <div className="flex flex-col gap-1 w-[130px] shrink-0">
            <label className="text-[11px] text-gray-500">End (YYYY-MM)</label>
            <input className="h-[32px] border border-gray-300 rounded-[5px] px-3 text-[12px] bg-white dark:bg-gray-800"
              value={editing.endDate ?? ''} onChange={e => onChange({ endDate: e.target.value || null })} placeholder="ongoing" />
          </div>
        )}
      </div>
      <div className="flex gap-2">
        <button className="text-[11.5px] px-3 py-1 border border-gray-300 rounded-[5px] hover:bg-gray-50" onClick={onCancel}>Cancel</button>
        <button className="text-[11.5px] px-3 py-1 bg-green-50 border border-green-300 text-green-700 rounded-[5px] hover:bg-green-100" onClick={onSave}>Save</button>
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function Windfalls() {
  const { windfalls, upsertWindfall, deleteWindfall } = useAppStore()
  const [editing, setEditing] = useState<Windfall | null>(null)
  const { sort, toggle: handleSort } = useSort<SortKey>('period')

  // All categories: predefined + any already in use, sorted
  const allCategoryOptions = Array.from(
    new Set([...INCOME_CATEGORIES, ...windfalls.map(w => w.category ?? '').filter(Boolean)])
  ).sort((a, b) => a.localeCompare(b))

  // Group by category for display
  const allCats = Array.from(new Set(['', ...windfalls.map(w => w.category ?? '')]))
    .sort((a, b) => {
      if (!a) return -1
      if (!b) return 1
      return a.localeCompare(b)
    })

  function sortItems(items: Windfall[]) {
    return [...items].sort((a, b) => {
      let av: string | number, bv: string | number
      if (sort.key === 'period') { av = a.date; bv = b.date }
      else if (sort.key === 'amount') { av = a.amount; bv = b.amount }
      else if (sort.key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase() }
      else { av = (a.category ?? '').toLowerCase(); bv = (b.category ?? '').toLowerCase() }
      if (av < bv) return sort.dir === 'asc' ? -1 : 1
      if (av > bv) return sort.dir === 'asc' ? 1 : -1
      return 0
    })
  }

  return (
    <div>
      <PageHeader title="Income">
        <button
          className="text-[11.5px] px-3 py-1 rounded-[5px] border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          onClick={() => setEditing(blank())}
        >
          + Add income
        </button>
      </PageHeader>

      <div className="p-4 space-y-4">
        {editing && !windfalls.find(w => w.id === editing.id) && (
          <EditForm
            editing={editing}
            onChange={patch => setEditing(e => e ? { ...e, ...patch } : e)}
            onSave={() => { upsertWindfall(editing); setEditing(null) }}
            onCancel={() => setEditing(null)}
            categoryOptions={allCategoryOptions}
          />
        )}

        <Table>
          <TableHead>
            <div className={GRID_COLS}>
              <span></span>
              <SortBtn col="period" label="Period" sort={sort} onToggle={handleSort} />
              <SortBtn col="amount" label="Amount" sort={sort} onToggle={handleSort} />
              <SortBtn col="name" label="Name" sort={sort} onToggle={handleSort} />
              <span>Tax</span>
              <span>Account</span>
              <span></span>
            </div>
          </TableHead>
          {allCats.map(cat => {
            const items = windfalls.filter(w => (w.category ?? '') === cat)
            if (items.length === 0) return null
            const sorted = sortItems(items)
            return (
              <div key={cat}>
                <div className="px-3 py-[6px] bg-gray-50/80 dark:bg-gray-800/40 border-t border-gray-200 dark:border-gray-700 text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                  {cat || '[No category]'}
                </div>
                {sorted.map(w => (
                  <IncomeRow
                    key={w.id}
                    w={w}
                    editing={editing}
                    setEditing={setEditing}
                    onSave={() => { upsertWindfall(editing!); setEditing(null) }}
                    onDuplicate={() => setEditing({ ...w, id: generateId() })}
                    onDelete={() => deleteWindfall(w.id)}
                    categoryOptions={allCategoryOptions}
                  />
                ))}
              </div>
            )
          })}
          <TableAddRow onClick={() => setEditing(blank())}>+ Add income</TableAddRow>
        </Table>
      </div>
    </div>
  )
}
