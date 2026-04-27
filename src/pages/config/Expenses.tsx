import { useState } from 'react'
import { useAppStore } from '../../store/useAppStore'
import { PageHeader } from '../../components/ui/PageHeader'
import { formatCurrency, generateId } from '../../lib/format'
import { recurrenceNote, monthLabel } from '../../components/ui/FlowRow'
import type { Expense, MedicalCoverage, MedicalExpense } from '../../types'

// ─── Types ────────────────────────────────────────────────────────────────────

type ExpSource = 'coverage' | 'medical' | 'expense'

interface UnifiedExpense {
  id: string
  name: string
  amount: number
  currency: 'USD' | 'EUR'
  frequency: 'monthly' | 'yearly' | 'one_time'
  startDate: string
  endDate: string | null
  category: string
  source: ExpSource
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
    category: 'Medical coverage', source: 'coverage',
  }))
  const fromMedical: UnifiedExpense[] = (medicalExpenses ?? []).map(e => ({
    id: e.id, name: e.name, amount: e.amount, currency: e.currency as 'USD' | 'EUR',
    frequency: e.frequency as UnifiedExpense['frequency'], startDate: e.startDate, endDate: e.endDate,
    category: e.category || 'Medical', source: 'medical',
  }))
  const fromExpenses: UnifiedExpense[] = expenses.map(e => ({
    id: e.id, name: e.name, amount: e.amount, currency: e.currency as 'USD' | 'EUR',
    frequency: e.frequency as UnifiedExpense['frequency'], startDate: e.startDate, endDate: e.endDate,
    category: e.category === 'Living' ? 'Default' : (e.category || 'Default'), source: 'expense',
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

function periodLabel(freq: string, startDate: string, endDate: string | null): string {
  if (freq === 'one_time') return monthLabel(startDate)
  return endDate ? `${startDate} → ${endDate}` : `${startDate} →`
}

// ─── Edit form ────────────────────────────────────────────────────────────────

function EditForm({ editing, onChange, onSave, onCancel }: {
  editing: UnifiedExpense
  onChange: (patch: Partial<UnifiedExpense>) => void
  onSave: () => void
  onCancel: () => void
}) {
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
          <label className="text-[11px] text-gray-500">Amount</label>
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
            value={editing.frequency} onChange={e => onChange({ frequency: e.target.value as UnifiedExpense['frequency'] })}>
            <option value="monthly">Monthly</option>
            <option value="yearly">Yearly</option>
            <option value="one_time">One-time</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[11px] text-gray-500">Start (YYYY-MM)</label>
          <input className="h-[32px] border border-gray-300 rounded-[5px] px-3 text-[12px] bg-white dark:bg-gray-800"
            value={editing.startDate} onChange={e => onChange({ startDate: e.target.value })} placeholder="2026-01" />
        </div>
        {editing.frequency !== 'one_time' && (
          <div className="flex flex-col gap-1">
            <label className="text-[11px] text-gray-500">End (YYYY-MM, blank = ongoing)</label>
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

// ─── Expense row ──────────────────────────────────────────────────────────────

function ExpenseItem({ item, onEdit, onDelete }: {
  item: UnifiedExpense
  onEdit: () => void
  onDelete: () => void
}) {
  const note = recurrenceNote(item.frequency, item.startDate, item.endDate)
  const period = periodLabel(item.frequency, item.startDate, item.endDate)

  return (
    <div className="flex items-center gap-2 py-[5px] border-b border-gray-100 dark:border-gray-700 last:border-0">
      <span className="text-[10px] text-gray-400 shrink-0 w-[80px]">{period}</span>
      <span className="w-[14px] shrink-0 text-[11px] text-gray-400 text-center" title={item.frequency !== 'one_time' ? 'Recurring' : ''}>
        {item.frequency !== 'one_time' ? '↻' : ''}
      </span>
      <span className="flex-1 min-w-0 truncate">
        <span className="text-[12px] text-gray-900 dark:text-white">{item.name}</span>
        {note && <span className="text-[10px] text-gray-400 ml-1.5">{note}</span>}
      </span>
      <span className="text-[12px] font-medium shrink-0 text-red-500">
        −{formatCurrency(item.amount, item.currency)}
      </span>
      <button className="text-[11px] text-blue-600 hover:underline shrink-0" onClick={onEdit}>Edit</button>
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

  const categories = Array.from(new Set(['Default', ...all.map(e => e.category)]))
    .sort((a, b) => categoryOrder(a) - categoryOrder(b))

  function saveItem(item: UnifiedExpense) {
    if (item.source === 'coverage') {
      upsertMedicalCoverage({ id: item.id, name: item.name, amount: item.amount, currency: item.currency, frequency: item.frequency, startDate: item.startDate, endDate: item.endDate })
    } else if (item.source === 'medical') {
      upsertMedicalExpense({ id: item.id, name: item.name, amount: item.amount, currency: item.currency, frequency: item.frequency, startDate: item.startDate, endDate: item.endDate, category: item.category })
    } else {
      upsertExpense({ id: item.id, name: item.name, amount: item.amount, currency: item.currency, frequency: item.frequency, startDate: item.startDate, endDate: item.endDate, category: item.category })
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
                <span className="text-[12.5px] font-medium">{cat}</span>
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
