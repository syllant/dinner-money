import { useState } from 'react'
import { useAppStore } from '../../store/useAppStore'
import { PageHeader } from '../../components/ui/PageHeader'
import { AccountSelect, useAccountName } from '../../components/ui/AccountSelect'
import { formatCurrency, generateId } from '../../lib/format'
import { recurrenceNote, monthLabel } from '../../components/ui/FlowRow'
import type { Expense, MedicalCoverage, MedicalExpense, ExpenseInstallment } from '../../types'

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

function periodLabel(freq: string, startDate: string, endDate: string | null, installments?: ExpenseInstallment[]): string {
  if (freq === 'one_time') return monthLabel(startDate)
  if (freq === 'custom') {
    if (installments && installments.length > 0) {
      const dates = installments.map(i => i.date).sort()
      const first = dates[0]
      const last = dates[dates.length - 1]
      return first === last ? first : `${first} → ${last}`
    }
    return 'custom'
  }
  return endDate ? `${startDate} → ${endDate}` : `${startDate} →`
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

function EditForm({ editing, onChange, onSave, onCancel }: {
  editing: UnifiedExpense
  onChange: (patch: Partial<UnifiedExpense>) => void
  onSave: () => void
  onCancel: () => void
}) {
  const isCustom = editing.frequency === 'custom'

  return (
    <div className="border border-blue-200 rounded-xl p-4 bg-blue-50 dark:bg-blue-900/10 space-y-3 mb-4">
      <div className="grid grid-cols-3 gap-3">
        <div className="flex flex-col gap-1 col-span-2">
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
          />
          <datalist id="expense-categories">
            {CATEGORY_OPTIONS.map(c => <option key={c} value={c} />)}
          </datalist>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[11px] text-gray-500">{isCustom ? 'Total budget' : 'Amount'}</label>
          <input type="number" className="h-[32px] border border-gray-300 rounded-[5px] px-3 text-[12px] bg-white dark:bg-gray-800"
            value={editing.amount} onChange={e => onChange({ amount: parseFloat(e.target.value) || 0 })} />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[11px] text-gray-500">Currency</label>
          <select className="h-[32px] border border-gray-300 rounded-[5px] px-2 text-[12px] bg-white dark:bg-gray-800"
            value={editing.currency} onChange={e => onChange({ currency: e.target.value as 'USD' | 'EUR' })}>
            <option value="USD">USD</option><option value="EUR">EUR</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
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
        {!isCustom && (
          <div className="flex flex-col gap-1">
            <label className="text-[11px] text-gray-500">Start (YYYY-MM)</label>
            <input className="h-[32px] border border-gray-300 rounded-[5px] px-3 text-[12px] bg-white dark:bg-gray-800"
              value={editing.startDate} onChange={e => onChange({ startDate: e.target.value })} placeholder="2026-01" />
          </div>
        )}
        {!isCustom && editing.frequency !== 'one_time' && (
          <div className="flex flex-col gap-1">
            <label className="text-[11px] text-gray-500">End (YYYY-MM, blank = ongoing)</label>
            <input className="h-[32px] border border-gray-300 rounded-[5px] px-3 text-[12px] bg-white dark:bg-gray-800"
              value={editing.endDate ?? ''} onChange={e => onChange({ endDate: e.target.value || null })} placeholder="ongoing" />
          </div>
        )}
        {isCustom && (
          <InstallmentsEditor
            total={editing.amount}
            currency={editing.currency}
            installments={editing.installments ?? []}
            onChange={items => {
              const first = items[0]?.date ?? editing.startDate
              onChange({ installments: items, startDate: first })
            }}
          />
        )}
        <AccountSelect
          label="Funded by account"
          placeholder="Cash (unspecified)"
          currency={editing.currency}
          value={editing.sourceAccountId}
          onChange={id => onChange({ sourceAccountId: id })}
        />
      </div>
      <div className="flex gap-2">
        <button className="text-[11.5px] px-3 py-1 border border-gray-300 rounded-[5px] hover:bg-gray-50" onClick={onCancel}>Cancel</button>
        <button className="text-[11.5px] px-3 py-1 bg-green-50 border border-green-300 text-green-700 rounded-[5px] hover:bg-green-100" onClick={onSave}>Save</button>
      </div>
    </div>
  )
}

// ─── Expense row ──────────────────────────────────────────────────────────────

function ExpenseItem({ item, onEdit, onDelete, onDuplicate }: {
  item: UnifiedExpense
  onEdit: () => void
  onDelete: () => void
  onDuplicate: () => void
}) {
  const note = item.frequency !== 'custom' ? recurrenceNote(item.frequency, item.startDate, item.endDate) : ''
  const period = periodLabel(item.frequency, item.startDate, item.endDate, item.installments)
  const accountName = useAccountName(item.sourceAccountId)

  return (
    <div className="flex items-center gap-2 py-[5px] border-b border-gray-100 dark:border-gray-700 last:border-0">
      <span className="text-[10px] text-gray-400 shrink-0 w-[80px]">{period}</span>
      <span className="w-[14px] shrink-0 text-[11px] text-gray-400 text-center" title={item.frequency !== 'one_time' && item.frequency !== 'custom' ? 'Recurring' : ''}>
        {item.frequency !== 'one_time' && item.frequency !== 'custom' ? '↻' : ''}
      </span>
      <span className="flex-1 min-w-0 truncate">
        <span className="text-[12px] text-gray-900 dark:text-white">{item.name}</span>
        {note && <span className="text-[10px] text-gray-400 ml-1.5">{note}</span>}
        {item.frequency === 'custom' && item.installments && item.installments.length > 0 && (
          <span className="text-[10px] text-gray-400 ml-1.5">{item.installments.length} installment{item.installments.length !== 1 ? 's' : ''}</span>
        )}
        {accountName && <span className="text-[10px] text-blue-500 ml-1.5">← {accountName}</span>}
      </span>
      <span className="text-[12px] font-medium shrink-0 text-red-500">
        −{formatCurrency(item.amount, item.currency)}
      </span>
      <button className="text-[11px] text-blue-600 hover:underline shrink-0" onClick={onEdit}>Edit</button>
      <button className="text-[11px] text-gray-400 hover:text-gray-600 hover:underline shrink-0" onClick={onDuplicate}>Dup</button>
      <button className="text-[11px] text-red-500 hover:underline shrink-0" onClick={onDelete}>Del</button>
    </div>
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

  const all = flattenExpenses(expenses, medicalCoverages ?? [], medicalExpenses ?? [])

  // Default first, then remaining categories sorted alphabetically
  const allCats = Array.from(new Set(['Default', ...all.map(e => e.category)]))
  const categories = allCats.sort((a, b) => {
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
        {editing && (
          <EditForm
            editing={editing}
            onChange={patch => setEditing(e => e ? { ...e, ...patch } : e)}
            onSave={() => { saveItem(editing); setEditing(null) }}
            onCancel={() => setEditing(null)}
          />
        )}

        {categories.map(cat => {
          const items = all.filter(e => e.category === cat)
          const totalEUR = items.reduce((s, e) => {
            const eur = e.currency === 'USD' ? e.amount / 1.08 : e.amount
            const monthly = e.frequency === 'monthly' ? eur : e.frequency === 'yearly' ? eur / 12 : 0
            return s + monthly
          }, 0)

          return (
            <section key={cat}>
              <div className="flex items-center justify-between pb-[6px] border-b border-gray-200 dark:border-gray-700 mb-1">
                <span className="text-[12.5px] font-medium">{cat === 'Default' ? '[Default]' : cat}</span>
                <span className="text-[11px] text-gray-400">
                  {totalEUR > 0 ? `~${formatCurrency(Math.round(totalEUR), 'EUR')}/mo` : ''}
                </span>
              </div>
              {items.length === 0 ? (
                <div className="text-[11.5px] text-gray-400 italic px-1 py-1">No entries yet.</div>
              ) : (
                <div className="border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
                  <div className="px-3">
                    {items.map(item => (
                      <ExpenseItem
                        key={item.id}
                        item={item}
                        onEdit={() => setEditing(item)}
                        onDuplicate={() => setEditing({ ...item, id: generateId() })}
                        onDelete={() => deleteItem(item)}
                      />
                    ))}
                  </div>
                </div>
              )}
            </section>
          )
        })}
      </div>
    </div>
  )
}
