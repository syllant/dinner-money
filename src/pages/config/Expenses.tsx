import { useState } from 'react'
import { useAppStore } from '../../store/useAppStore'
import { PageHeader } from '../../components/ui/PageHeader'
import { Table, TableHead, TableRow, TableAddRow } from '../../components/ui/Table'
import { SortBtn, useSort } from '../../components/ui/SortBtn'
import { AccountSelect, useAccountName } from '../../components/ui/AccountSelect'
import { formatCurrency, generateId } from '../../lib/format'
import { NumericInput } from '../../components/ui/NumericInput'
import {
  periodLabel, getFrequencyDisplay,
  CUR_BADGE, curBadgeClass, curSymbol,
} from '../../components/ui/FrequencyDisplay'
import { EditIcon, DupIcon, DelIcon } from '../../components/ui/Icons'
import type { Expense, MedicalCoverage, MedicalExpense, ExpenseInstallment } from '../../types'

type SortKey = 'period' | 'amount' | 'name' | 'account'

// ─── Types ────────────────────────────────────────────────────────────────────

type ExpSource = 'coverage' | 'medical' | 'expense'

interface UnifiedExpense {
  id: string
  name: string
  amount: number
  currency: 'USD' | 'EUR'
  frequency: 'monthly' | 'yearly' | 'one_time' | 'custom'
  startDate: string
  endDate: string | null
  category: string
  source: ExpSource
  sourceAccountId?: number
  installments?: ExpenseInstallment[]
}

// ─── Constants ────────────────────────────────────────────────────────────────

const CATEGORY_OPTIONS = [
  'Medical coverage', 'Medical', 'Housing', 'Food', 'Transport',
  'Education', 'Travel', 'Entertainment', 'Default', 'Other',
]

const CATEGORY_ORDER: Record<string, number> = Object.fromEntries(CATEGORY_OPTIONS.map((c, i) => [c, i]))

function categoryOrder(cat: string): number {
  return CATEGORY_ORDER[cat] ?? 99
}

// ─── Flatten helpers ──────────────────────────────────────────────────────────

function flattenExpenses(
  expenses: Expense[],
  medicalCoverages: MedicalCoverage[],
  medicalExpenses: MedicalExpense[],
): UnifiedExpense[] {
  const fromCoverage: UnifiedExpense[] = (medicalCoverages ?? []).map(c => ({
    id: c.id, name: c.name, amount: c.amount, currency: c.currency as 'USD' | 'EUR',
    frequency: c.frequency as UnifiedExpense['frequency'], startDate: c.startDate, endDate: c.endDate,
    category: 'Medical coverage', source: 'coverage' as ExpSource,
    sourceAccountId: c.sourceAccountId, installments: c.installments,
  }))
  const fromMedical: UnifiedExpense[] = (medicalExpenses ?? []).map(e => ({
    id: e.id, name: e.name, amount: e.amount, currency: e.currency as 'USD' | 'EUR',
    frequency: e.frequency as UnifiedExpense['frequency'], startDate: e.startDate, endDate: e.endDate,
    category: e.category || 'Medical', source: 'medical' as ExpSource,
    sourceAccountId: e.sourceAccountId, installments: e.installments,
  }))
  const fromExpenses: UnifiedExpense[] = expenses.map(e => ({
    id: e.id, name: e.name, amount: e.amount, currency: e.currency as 'USD' | 'EUR',
    frequency: e.frequency as UnifiedExpense['frequency'], startDate: e.startDate, endDate: e.endDate,
    category: e.category === 'Living' ? 'Default' : (e.category || 'Default'), source: 'expense' as ExpSource,
    sourceAccountId: e.sourceAccountId, installments: e.installments,
  }))
  return [...fromCoverage, ...fromMedical, ...fromExpenses]
    .sort((a, b) => categoryOrder(a.category) - categoryOrder(b.category) || a.startDate.localeCompare(b.startDate))
}

function blankExpense(): UnifiedExpense {
  return {
    id: generateId(), name: '', amount: 0, currency: 'EUR',
    frequency: 'monthly', startDate: '2026-01', endDate: null,
    category: 'Housing', source: 'expense',
  }
}


// ─── Installments editor ──────────────────────────────────────────────────────

function InstallmentsEditor({
  total,
  currency,
  installments,
  onChange,
}: {
  total: number
  currency: string
  installments: ExpenseInstallment[]
  onChange: (items: ExpenseInstallment[]) => void
}) {
  const paid = installments.reduce((s, i) => s + i.amount, 0)
  const remaining = total - paid

  function update(idx: number, patch: Partial<ExpenseInstallment>) {
    onChange(installments.map((it, i) => i === idx ? { ...it, ...patch } : it))
  }

  function remove(idx: number) {
    onChange(installments.filter((_, i) => i !== idx))
  }

  function add() {
    const lastDate = installments.length > 0 ? installments[installments.length - 1].date : null
    let nextDate = '2026-01'
    if (lastDate) {
      const [y, mo] = lastDate.split('-').map(Number)
      const nextMo = mo === 12 ? 1 : mo + 1
      const nextY = mo === 12 ? y + 1 : y
      nextDate = `${nextY}-${String(nextMo).padStart(2, '0')}`
    }
    onChange([...installments, { date: nextDate, amount: remaining > 0 ? remaining : 0 }])
  }

  return (
    <div className="col-span-3 space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-[11px] text-gray-500">Installments</label>
        <span className={`text-[11px] font-medium ${Math.abs(remaining) < 0.01 ? 'text-green-600' : remaining < 0 ? 'text-red-500' : 'text-amber-500'}`}>
          {Math.abs(remaining) < 0.01
            ? '✓ Fully covered'
            : remaining > 0
              ? `${formatCurrency(remaining, currency)} remaining`
              : `${formatCurrency(-remaining, currency)} over budget`}
        </span>
      </div>
      <div className="space-y-1.5">
        {installments.map((it, idx) => (
          <div key={idx} className="flex gap-2 items-center">
            <input
              className="h-[30px] border border-gray-300 rounded-[5px] px-2 text-[12px] bg-white dark:bg-gray-800 w-[100px]"
              value={it.date}
              onChange={e => update(idx, { date: e.target.value })}
              placeholder="2026-01"
            />
            <input
              type="number"
              className="h-[30px] border border-gray-300 rounded-[5px] px-2 text-[12px] bg-white dark:bg-gray-800 w-[110px]"
              value={it.amount}
              onChange={e => update(idx, { amount: parseFloat(e.target.value) || 0 })}
            />
            <span className="text-[11px] text-gray-400">{currency}</span>
            <button
              className="text-[11px] text-red-400 hover:text-red-600"
              onClick={() => remove(idx)}
              type="button"
            >×</button>
          </div>
        ))}
      </div>
      <button
        type="button"
        className="text-[11px] text-blue-600 hover:underline"
        onClick={add}
      >+ Add installment</button>
    </div>
  )
}

// ─── Edit form ────────────────────────────────────────────────────────────────

function EditForm({ editing, onChange, onSave, onCancel, categoryOptions, embedded }: {
  editing: UnifiedExpense
  onChange: (patch: Partial<UnifiedExpense>) => void
  onSave: () => void
  onCancel: () => void
  categoryOptions: string[]
  embedded?: boolean
}) {
  const isCustom = editing.frequency === 'custom'

  return (
    <div className={embedded ? "space-y-3 mb-1" : "border border-blue-200 rounded-xl p-4 bg-blue-50 dark:bg-blue-900/10 space-y-3 mb-4"}>
      {/* Row 1: Name (wide) + Category */}
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
            list="expense-categories"
            value={editing.category}
            onChange={e => onChange({ category: e.target.value })}
            onFocus={e => e.target.select()}
          />
          <datalist id="expense-categories">
            {categoryOptions.map(c => <option key={c} value={c} />)}
          </datalist>
        </div>
      </div>
      {/* Row 2: Amount + Currency + Account */}
      <div className="grid grid-cols-[1fr_100px_1fr] gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-[11px] text-gray-500">{isCustom ? 'Total budget' : 'Amount'}</label>
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
        <AccountSelect
          label="Funded by account"
          placeholder="Cash (unspecified)"
          currency={editing.currency}
          value={editing.sourceAccountId}
          onChange={id => onChange({ sourceAccountId: id })}
        />
      </div>
      {/* Row 3: Frequency + Start + End (on same row, end hidden for one_time) */}
      {!isCustom && (
        <div className="flex gap-3">
          <div className="flex flex-col gap-1 w-[160px] shrink-0">
            <label className="text-[11px] text-gray-500">Frequency</label>
            <select className="h-[32px] border border-gray-300 rounded-[5px] px-2 text-[12px] bg-white dark:bg-gray-800"
              value={editing.frequency}
              onChange={e => {
                const freq = e.target.value as UnifiedExpense['frequency']
                onChange({ frequency: freq, installments: freq === 'custom' ? (editing.installments ?? []) : undefined })
              }}>
              <option value="monthly">Monthly</option>
              <option value="yearly">Yearly</option>
              <option value="one_time">One-time</option>
              <option value="custom">Custom installments</option>
            </select>
          </div>
          <div className="flex flex-col gap-1 w-[120px] shrink-0">
            <label className="text-[11px] text-gray-500">Start (YYYY-MM)</label>
            <input className="h-[32px] border border-gray-300 rounded-[5px] px-3 text-[12px] bg-white dark:bg-gray-800"
              value={editing.startDate} onChange={e => onChange({ startDate: e.target.value })} placeholder="2026-01" />
          </div>
          {editing.frequency !== 'one_time' && (
            <div className="flex flex-col gap-1 w-[130px] shrink-0">
              <label className="text-[11px] text-gray-500">End (YYYY-MM)</label>
              <input className="h-[32px] border border-gray-300 rounded-[5px] px-3 text-[12px] bg-white dark:bg-gray-800"
                value={editing.endDate ?? ''} onChange={e => onChange({ endDate: e.target.value || null })} placeholder="ongoing" />
            </div>
          )}
        </div>
      )}
      {isCustom && (
        <div className="flex gap-3 items-start">
          <div className="flex flex-col gap-1 w-[160px] shrink-0">
            <label className="text-[11px] text-gray-500">Frequency</label>
            <select className="h-[32px] border border-gray-300 rounded-[5px] px-2 text-[12px] bg-white dark:bg-gray-800"
              value={editing.frequency}
              onChange={e => {
                const freq = e.target.value as UnifiedExpense['frequency']
                onChange({ frequency: freq, installments: freq === 'custom' ? (editing.installments ?? []) : undefined })
              }}>
              <option value="monthly">Monthly</option>
              <option value="yearly">Yearly</option>
              <option value="one_time">One-time</option>
              <option value="custom">Custom installments</option>
            </select>
          </div>
          <InstallmentsEditor
            total={editing.amount}
            currency={editing.currency}
            installments={editing.installments ?? []}
            onChange={items => {
              const first = items[0]?.date ?? editing.startDate
              onChange({ installments: items, startDate: first })
            }}
          />
        </div>
      )}
      <div className="flex gap-2">
        <button className="text-[11.5px] px-3 py-1 border border-gray-300 rounded-[5px] hover:bg-gray-50" onClick={onCancel}>Cancel</button>
        <button className="text-[11.5px] px-3 py-1 bg-green-50 border border-green-300 text-green-700 rounded-[5px] hover:bg-green-100" onClick={onSave}>Save</button>
      </div>
    </div>
  )
}

// ─── Expense row ──────────────────────────────────────────────────────────────

const GRID_COLS = 'grid grid-cols-[20px_130px_110px_2fr_1fr_72px] gap-x-3 items-center'

function ExpenseRow({
  item,
  editing,
  setEditing,
  onSave,
  onDuplicate,
  onDelete,
  categoryOptions
}: {
  item: UnifiedExpense
  editing: UnifiedExpense | null
  setEditing: (item: UnifiedExpense | null) => void
  onSave: () => void
  onDuplicate: () => void
  onDelete: () => void
  categoryOptions: string[]
}) {
  const period = periodLabel(item.frequency, item.startDate, item.endDate, item.installments)
  const accountName = useAccountName(item.sourceAccountId)
  const freqDisplay = getFrequencyDisplay(item)
  const curBdgCls = curBadgeClass(item.currency)
  const curSym = curSymbol(item.currency)

  return (
    <TableRow>
      <div className={GRID_COLS}>
        <span className="flex items-center justify-center text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 cursor-help" title={freqDisplay.title}>
          {freqDisplay.node}
        </span>
        <span className="text-[10.5px] text-gray-400 truncate">{period}</span>
        <div className="flex items-center justify-end gap-1">
          <span className="font-medium tabular-nums">{item.amount.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}</span>
          <span className={`${CUR_BADGE} ${curBdgCls}`}>{curSym}</span>
        </div>
        <div className="min-w-0 truncate pl-2">
          <span>{item.name}</span>
        </div>
        <span className="text-[10.5px] text-gray-400 truncate">{accountName ?? '—'}</span>
        <div className="flex gap-2 justify-end">
          <button className="text-gray-400 hover:text-blue-500" onClick={() => setEditing(item)}><EditIcon /></button>
          <button className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300" onClick={onDuplicate}><DupIcon /></button>
          <button className="text-gray-400 hover:text-red-500" onClick={onDelete}><DelIcon /></button>
        </div>
      </div>
      {editing?.id === item.id && (
        <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-700/60">
          <EditForm
            editing={editing}
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

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function Expenses() {
  const {
    expenses, medicalCoverages, medicalExpenses,
    upsertExpense, deleteExpense,
    upsertMedicalCoverage, deleteMedicalCoverage,
    upsertMedicalExpense, deleteMedicalExpense,
  } = useAppStore()

  const [editing, setEditing] = useState<UnifiedExpense | null>(null)
  const { sort, toggle: handleSort } = useSort<SortKey>('period')

  const all = flattenExpenses(expenses, medicalCoverages ?? [], medicalExpenses ?? [])

  const allCategoryOptions = Array.from(
    new Set([...CATEGORY_OPTIONS, ...all.map(e => e.category)])
  ).sort((a, b) => a.localeCompare(b))

  // Group rows by category for display
  const categories = Array.from(new Set(['Default', ...all.map(e => e.category)]))
    .sort((a, b) => {
      if (a === 'Default') return -1
      if (b === 'Default') return 1
      return a.localeCompare(b)
    })

  function saveItem(item: UnifiedExpense) {
    if (item.source === 'coverage') {
      upsertMedicalCoverage({ id: item.id, name: item.name, amount: item.amount, currency: item.currency, frequency: item.frequency, startDate: item.startDate, endDate: item.endDate, sourceAccountId: item.sourceAccountId, installments: item.installments })
    } else if (item.source === 'medical') {
      upsertMedicalExpense({ id: item.id, name: item.name, amount: item.amount, currency: item.currency, frequency: item.frequency, startDate: item.startDate, endDate: item.endDate, category: item.category, sourceAccountId: item.sourceAccountId, installments: item.installments })
    } else {
      upsertExpense({ id: item.id, name: item.name, amount: item.amount, currency: item.currency, frequency: item.frequency, startDate: item.startDate, endDate: item.endDate, category: item.category, sourceAccountId: item.sourceAccountId, installments: item.installments })
    }
  }

  function deleteItem(item: UnifiedExpense) {
    if (item.source === 'coverage') deleteMedicalCoverage(item.id)
    else if (item.source === 'medical') deleteMedicalExpense(item.id)
    else deleteExpense(item.id)
  }

  return (
    <div>
      <PageHeader title="Expenses">
        <button
          className="text-[11.5px] px-3 py-1 rounded-[5px] border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          onClick={() => setEditing(blankExpense())}
        >
          + Add expense
        </button>
      </PageHeader>

      <div className="p-4 space-y-4">
        {editing && !all.find(e => e.id === editing.id) && (
          <EditForm
            editing={editing}
            onChange={patch => setEditing(e => e ? { ...e, ...patch } : e)}
            onSave={() => { saveItem(editing); setEditing(null) }}
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
              <SortBtn col="account" label="Account" sort={sort} onToggle={handleSort} />
              <span></span>
            </div>
          </TableHead>
          {categories.map(cat => {
            const items = all.filter(e => e.category === cat)
            if (items.length === 0) return null
            const sorted = [...items].sort((a, b) => {
              let av: string | number, bv: string | number
              if (sort.key === 'period') { av = a.startDate; bv = b.startDate }
              else if (sort.key === 'amount') { av = a.amount; bv = b.amount }
              else if (sort.key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase() }
              else { av = (a.sourceAccountId ?? ''); bv = (b.sourceAccountId ?? '') }
              if (av < bv) return sort.dir === 'asc' ? -1 : 1
              if (av > bv) return sort.dir === 'asc' ? 1 : -1
              return 0
            })
            return (
              <div key={cat}>
                <div className="px-3 py-[6px] bg-gray-50/80 dark:bg-gray-800/40 border-t border-gray-200 dark:border-gray-700 text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                  {cat === 'Default' ? '[Default]' : cat}
                </div>
                {sorted.map(item => (
                  <ExpenseRow
                    key={item.id}
                    item={item}
                    editing={editing}
                    setEditing={setEditing}
                    onSave={() => { saveItem(editing!); setEditing(null) }}
                    onDuplicate={() => setEditing({ ...item, id: generateId() })}
                    onDelete={() => deleteItem(item)}
                    categoryOptions={allCategoryOptions}
                  />
                ))}
              </div>
            )
          })}
          <TableAddRow onClick={() => setEditing(blankExpense())}>+ Add expense</TableAddRow>
        </Table>
      </div>
    </div>
  )
}
