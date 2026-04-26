import { useState } from 'react'
import { useAppStore } from '../../store/useAppStore'
import { PageHeader } from '../../components/ui/PageHeader'
import { Table, TableHead, TableRow, TableAddRow } from '../../components/ui/Table'
import { Badge } from '../../components/ui/Badge'
import { formatCurrency, generateId } from '../../lib/format'
import type { Expense, MedicalCoverage, MedicalExpense } from '../../types'

const EXPENSE_CATEGORIES = ['Living', 'Housing', 'Food', 'Transport', 'Education', 'Travel', 'Entertainment', 'Medical', 'Other']

// ─── Shared row layout ────────────────────────────────────────────────────────

function ExpenseRow({ name, amount, currency, frequency, startDate, endDate, category, onEdit, onDelete }: {
  name: string; amount: number; currency: string; frequency: string
  startDate: string; endDate: string | null
  category?: string
  onEdit: () => void; onDelete: () => void
}) {
  return (
    <TableRow>
      <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_60px] gap-2 items-center">
        <div>
          <div className="font-medium">{name}</div>
          {category && <div className="text-[10px] text-gray-400">{category}</div>}
        </div>
        <span>{formatCurrency(amount, currency)}</span>
        <span>
          {frequency === 'monthly'
            ? <Badge variant="warning">Monthly</Badge>
            : frequency === 'yearly'
            ? <Badge variant="warning">Yearly</Badge>
            : <span className="text-[11px] text-gray-300 dark:text-gray-600">—</span>}
        </span>
        <Badge variant={currency === 'EUR' ? 'eur' : 'usd'}>{currency}</Badge>
        <span className="text-[11px] text-gray-400">{endDate ? `${startDate} → ${endDate}` : `${startDate} →`}</span>
        <div className="flex gap-2">
          <button className="text-[11px] text-blue-600 hover:underline" onClick={onEdit}>Edit</button>
          <button className="text-[11px] text-red-500 hover:underline" onClick={onDelete}>Del</button>
        </div>
      </div>
    </TableRow>
  )
}

function TableColumns() {
  return (
    <TableHead>
      <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_60px] gap-2">
        <span>Name</span><span>Amount</span><span>Frequency</span><span>Currency</span><span>Period</span><span></span>
      </div>
    </TableHead>
  )
}

// ─── Inline edit form (shared) ────────────────────────────────────────────────

interface EditFields {
  name: string; amount: number; currency: 'USD' | 'EUR'
  frequency: 'monthly' | 'yearly' | 'one_time'
  startDate: string; endDate: string | null
}

function EditForm<T extends EditFields>({
  editing, title, onChange, onSave, onCancel, children,
}: {
  editing: T
  title: string
  onChange: (patch: Partial<T>) => void
  onSave: () => void
  onCancel: () => void
  children?: React.ReactNode
}) {
  return (
    <div className="border border-blue-200 rounded-xl p-4 bg-blue-50 dark:bg-blue-900/10 space-y-3 mb-3">
      <h3 className="text-[12.5px] font-medium">{title}</h3>
      <div className="grid grid-cols-3 gap-3">
        <div className="flex flex-col gap-1 col-span-2">
          <label className="text-[11px] text-gray-500">Name</label>
          <input className="h-[32px] border border-gray-300 rounded-[5px] px-3 text-[12px] bg-white dark:bg-gray-800"
            value={editing.name} onChange={e => onChange({ name: e.target.value } as Partial<T>)} />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[11px] text-gray-500">Amount</label>
          <input type="number" className="h-[32px] border border-gray-300 rounded-[5px] px-3 text-[12px] bg-white dark:bg-gray-800"
            value={editing.amount} onChange={e => onChange({ amount: parseFloat(e.target.value) } as Partial<T>)} />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[11px] text-gray-500">Currency</label>
          <select className="h-[32px] border border-gray-300 rounded-[5px] px-2 text-[12px] bg-white dark:bg-gray-800"
            value={editing.currency} onChange={e => onChange({ currency: e.target.value as 'USD' | 'EUR' } as Partial<T>)}>
            <option value="USD">USD</option><option value="EUR">EUR</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[11px] text-gray-500">Frequency</label>
          <select className="h-[32px] border border-gray-300 rounded-[5px] px-2 text-[12px] bg-white dark:bg-gray-800"
            value={editing.frequency} onChange={e => onChange({ frequency: e.target.value as EditFields['frequency'] } as Partial<T>)}>
            <option value="monthly">Monthly</option><option value="yearly">Yearly</option><option value="one_time">One-time</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[11px] text-gray-500">Start (YYYY-MM)</label>
          <input className="h-[32px] border border-gray-300 rounded-[5px] px-3 text-[12px] bg-white dark:bg-gray-800"
            value={editing.startDate} onChange={e => onChange({ startDate: e.target.value } as Partial<T>)} placeholder="2026-01" />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[11px] text-gray-500">End (YYYY-MM, blank = ongoing)</label>
          <input className="h-[32px] border border-gray-300 rounded-[5px] px-3 text-[12px] bg-white dark:bg-gray-800"
            value={editing.endDate ?? ''} onChange={e => onChange({ endDate: e.target.value || null } as Partial<T>)} placeholder="ongoing" />
        </div>
        {children}
      </div>
      <div className="flex gap-2">
        <button className="text-[11.5px] px-3 py-1 border border-gray-300 rounded-[5px] hover:bg-gray-50" onClick={onCancel}>Cancel</button>
        <button className="text-[11.5px] px-3 py-1 bg-green-50 border border-green-300 text-green-700 rounded-[5px] hover:bg-green-100" onClick={onSave}>Save</button>
      </div>
    </div>
  )
}

// ─── Medical Coverage section ─────────────────────────────────────────────────

const blankCoverage = (): MedicalCoverage => ({
  id: generateId(), name: '', amount: 0, frequency: 'monthly',
  currency: 'USD', startDate: '2026-01', endDate: null,
})

function CoverageSection() {
  const { medicalCoverages, upsertMedicalCoverage, deleteMedicalCoverage } = useAppStore()
  const [editing, setEditing] = useState<MedicalCoverage | null>(null)
  const isNew = editing ? !medicalCoverages.find(c => c.id === editing.id) : false

  return (
    <section>
      <h2 className="text-[13px] font-medium mb-1">Medical coverage</h2>
      <p className="text-[11.5px] text-gray-500 dark:text-gray-400 mb-3">
        Health insurance premiums, COBRA, employer plans.
      </p>
      {editing && (
        <EditForm
          editing={editing}
          title={isNew ? 'Add coverage' : 'Edit coverage'}
          onChange={patch => setEditing(e => e ? { ...e, ...patch } : e)}
          onSave={() => { upsertMedicalCoverage(editing); setEditing(null) }}
          onCancel={() => setEditing(null)}
        />
      )}
      <Table>
        <TableColumns />
        {medicalCoverages.map(c => (
          <ExpenseRow key={c.id} name={c.name} amount={c.amount} currency={c.currency}
            frequency={c.frequency} startDate={c.startDate} endDate={c.endDate}
            onEdit={() => setEditing(c)} onDelete={() => deleteMedicalCoverage(c.id)} />
        ))}
        <TableAddRow onClick={() => setEditing(blankCoverage())}>+ Add coverage</TableAddRow>
      </Table>
    </section>
  )
}

// ─── Medical Expenses section ─────────────────────────────────────────────────

const blankMedExp = (): MedicalExpense => ({
  id: generateId(), name: '', amount: 0, frequency: 'one_time',
  currency: 'USD', startDate: '2026-01', endDate: null, category: 'Medical',
})

function MedicalExpenseSection() {
  const { medicalExpenses, upsertMedicalExpense, deleteMedicalExpense } = useAppStore()
  const [editing, setEditing] = useState<MedicalExpense | null>(null)
  const isNew = editing ? !medicalExpenses.find(e => e.id === editing.id) : false

  return (
    <section>
      <h2 className="text-[13px] font-medium mb-1">Medical expenses</h2>
      <p className="text-[11.5px] text-gray-500 dark:text-gray-400 mb-3">
        Out-of-pocket: deductibles, copays, prescriptions, dental, vision.
      </p>
      {editing && (
        <EditForm
          editing={editing}
          title={isNew ? 'Add medical expense' : 'Edit medical expense'}
          onChange={patch => setEditing(e => e ? { ...e, ...patch } : e)}
          onSave={() => { upsertMedicalExpense(editing); setEditing(null) }}
          onCancel={() => setEditing(null)}
        />
      )}
      <Table>
        <TableColumns />
        {medicalExpenses.map(e => (
          <ExpenseRow key={e.id} name={e.name} amount={e.amount} currency={e.currency}
            frequency={e.frequency} startDate={e.startDate} endDate={e.endDate}
            onEdit={() => setEditing(e)} onDelete={() => deleteMedicalExpense(e.id)} />
        ))}
        <TableAddRow onClick={() => setEditing(blankMedExp())}>+ Add medical expense</TableAddRow>
      </Table>
    </section>
  )
}

// ─── Other Expenses section ───────────────────────────────────────────────────

const blankExpense = (): Expense => ({
  id: generateId(), name: '', amount: 0, frequency: 'monthly',
  currency: 'EUR', startDate: '2026-01', endDate: null, category: 'Living',
})

function OtherExpensesSection() {
  const { expenses, upsertExpense, deleteExpense } = useAppStore()
  const [editing, setEditing] = useState<Expense | null>(null)
  const isNew = editing ? !expenses.find(e => e.id === editing.id) : false

  return (
    <section>
      <h2 className="text-[13px] font-medium mb-1">Other expenses</h2>
      <p className="text-[11.5px] text-gray-500 dark:text-gray-400 mb-3">
        Housing, food, transport, travel, and any other recurring costs.
      </p>
      {editing && (
        <EditForm
          editing={editing}
          title={isNew ? 'Add expense' : 'Edit expense'}
          onChange={patch => setEditing(e => e ? { ...e, ...patch } : e)}
          onSave={() => { upsertExpense(editing); setEditing(null) }}
          onCancel={() => setEditing(null)}
        >
          <div className="flex flex-col gap-1">
            <label className="text-[11px] text-gray-500">Category</label>
            <select
              className="h-[32px] border border-gray-300 rounded-[5px] px-2 text-[12px] bg-white dark:bg-gray-800"
              value={editing.category ?? 'Living'}
              onChange={e => setEditing(ed => ed ? { ...ed, category: e.target.value } : ed)}
            >
              {EXPENSE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </EditForm>
      )}
      <Table>
        <TableColumns />
        {expenses.map(e => (
          <ExpenseRow key={e.id} name={e.name} amount={e.amount} currency={e.currency}
            frequency={e.frequency} startDate={e.startDate} endDate={e.endDate}
            category={e.category}
            onEdit={() => setEditing(e)} onDelete={() => deleteExpense(e.id)} />
        ))}
        <TableAddRow onClick={() => setEditing(blankExpense())}>+ Add expense</TableAddRow>
      </Table>
    </section>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function Expenses() {
  return (
    <div>
      <PageHeader title="Expenses" />
      <div className="p-4 space-y-8">
        <CoverageSection />
        <hr className="border-gray-200 dark:border-gray-700" />
        <MedicalExpenseSection />
        <hr className="border-gray-200 dark:border-gray-700" />
        <OtherExpensesSection />
      </div>
    </div>
  )
}
