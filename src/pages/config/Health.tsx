import { useState } from 'react'
import { useAppStore } from '../../store/useAppStore'
import { PageHeader } from '../../components/ui/PageHeader'
import { Table, TableHead, TableRow, TableAddRow } from '../../components/ui/Table'
import { Badge } from '../../components/ui/Badge'
import { formatCurrency, generateId } from '../../lib/format'
import type { MedicalCoverage, MedicalExpense } from '../../types'

// ─── Medical Coverage ─────────────────────────────────────────────────────────

const blankCoverage = (): MedicalCoverage => ({
  id: generateId(), name: '', amount: 0, frequency: 'monthly',
  currency: 'USD', startDate: '2026-01', endDate: null,
})

function CoverageSection() {
  const { medicalCoverages, upsertMedicalCoverage, deleteMedicalCoverage } = useAppStore()
  const [editing, setEditing] = useState<MedicalCoverage | null>(null)

  return (
    <section>
      <h2 className="text-[13px] font-medium mb-3">Medical coverage</h2>
      <p className="text-[11.5px] text-gray-500 dark:text-gray-400 mb-3">
        Health insurance premiums, COBRA, employer plans — anything with a regular cost and coverage dates.
      </p>
      {editing && (
        <div className="border border-blue-200 rounded-xl p-4 bg-blue-50 dark:bg-blue-900/10 space-y-3 mb-3">
          <h3 className="text-[12.5px] font-medium">
            {medicalCoverages.find(c => c.id === editing.id) ? 'Edit coverage' : 'Add coverage'}
          </h3>
          <div className="grid grid-cols-3 gap-3">
            <div className="flex flex-col gap-1 col-span-2">
              <label className="text-[11px] text-gray-500">Name / provider</label>
              <input
                className="h-[32px] border border-gray-300 rounded-[5px] px-3 text-[12px] bg-white dark:bg-gray-800"
                value={editing.name}
                onChange={e => setEditing({ ...editing, name: e.target.value })}
                placeholder="e.g. COBRA, Kaiser Permanente"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[11px] text-gray-500">Amount</label>
              <input
                type="number"
                className="h-[32px] border border-gray-300 rounded-[5px] px-3 text-[12px] bg-white dark:bg-gray-800"
                value={editing.amount}
                onChange={e => setEditing({ ...editing, amount: parseFloat(e.target.value) })}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[11px] text-gray-500">Currency</label>
              <select
                className="h-[32px] border border-gray-300 rounded-[5px] px-2 text-[12px] bg-white dark:bg-gray-800"
                value={editing.currency}
                onChange={e => setEditing({ ...editing, currency: e.target.value as 'USD' | 'EUR' })}
              >
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[11px] text-gray-500">Frequency</label>
              <select
                className="h-[32px] border border-gray-300 rounded-[5px] px-2 text-[12px] bg-white dark:bg-gray-800"
                value={editing.frequency}
                onChange={e => setEditing({ ...editing, frequency: e.target.value as MedicalCoverage['frequency'] })}
              >
                <option value="monthly">Monthly</option>
                <option value="yearly">Yearly</option>
                <option value="one_time">One-time</option>
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[11px] text-gray-500">Start (YYYY-MM)</label>
              <input
                className="h-[32px] border border-gray-300 rounded-[5px] px-3 text-[12px] bg-white dark:bg-gray-800"
                value={editing.startDate}
                onChange={e => setEditing({ ...editing, startDate: e.target.value })}
                placeholder="2026-01"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[11px] text-gray-500">End (YYYY-MM, blank = ongoing)</label>
              <input
                className="h-[32px] border border-gray-300 rounded-[5px] px-3 text-[12px] bg-white dark:bg-gray-800"
                value={editing.endDate ?? ''}
                onChange={e => setEditing({ ...editing, endDate: e.target.value || null })}
                placeholder="ongoing"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button
              className="text-[11.5px] px-3 py-1 border border-gray-300 rounded-[5px] hover:bg-gray-50"
              onClick={() => setEditing(null)}
            >Cancel</button>
            <button
              className="text-[11.5px] px-3 py-1 bg-green-50 border border-green-300 text-green-700 rounded-[5px] hover:bg-green-100"
              onClick={() => { upsertMedicalCoverage(editing); setEditing(null) }}
            >Save</button>
          </div>
        </div>
      )}
      <Table>
        <TableHead>
          <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_60px] gap-2">
            <span>Name / provider</span><span>Amount</span><span>Frequency</span><span>Currency</span><span>Period</span><span></span>
          </div>
        </TableHead>
        {medicalCoverages.map(c => (
          <TableRow key={c.id}>
            <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_60px] gap-2 items-center">
              <span className="font-medium">{c.name}</span>
              <span>{formatCurrency(c.amount, c.currency)}</span>
              <span className="capitalize text-gray-500">{c.frequency}</span>
              <Badge variant={c.currency === 'EUR' ? 'eur' : 'usd'}>{c.currency}</Badge>
              <span className="text-[11px] text-gray-400">
                {c.endDate ? `${c.startDate} → ${c.endDate}` : `${c.startDate} →`}
              </span>
              <div className="flex gap-2">
                <button className="text-[11px] text-blue-600 hover:underline" onClick={() => setEditing(c)}>Edit</button>
                <button className="text-[11px] text-red-500 hover:underline" onClick={() => deleteMedicalCoverage(c.id)}>Del</button>
              </div>
            </div>
          </TableRow>
        ))}
        <TableAddRow onClick={() => setEditing(blankCoverage())}>+ Add coverage</TableAddRow>
      </Table>
    </section>
  )
}

// ─── Medical Expenses ─────────────────────────────────────────────────────────

const blankExpense = (): MedicalExpense => ({
  id: generateId(), name: '', amount: 0, frequency: 'one_time',
  currency: 'USD', startDate: '2026-01', endDate: null, category: 'Medical',
})

function MedicalExpenseSection() {
  const { medicalExpenses, upsertMedicalExpense, deleteMedicalExpense } = useAppStore()
  const [editing, setEditing] = useState<MedicalExpense | null>(null)

  return (
    <section>
      <h2 className="text-[13px] font-medium mb-3">Medical expenses</h2>
      <p className="text-[11.5px] text-gray-500 dark:text-gray-400 mb-3">
        Out-of-pocket costs: deductibles, copays, prescriptions, dental, vision, etc.
      </p>
      {editing && (
        <div className="border border-blue-200 rounded-xl p-4 bg-blue-50 dark:bg-blue-900/10 space-y-3 mb-3">
          <h3 className="text-[12.5px] font-medium">
            {medicalExpenses.find(e => e.id === editing.id) ? 'Edit expense' : 'Add expense'}
          </h3>
          <div className="grid grid-cols-3 gap-3">
            <div className="flex flex-col gap-1 col-span-2">
              <label className="text-[11px] text-gray-500">Name</label>
              <input
                className="h-[32px] border border-gray-300 rounded-[5px] px-3 text-[12px] bg-white dark:bg-gray-800"
                value={editing.name}
                onChange={e => setEditing({ ...editing, name: e.target.value })}
                placeholder="e.g. Annual deductible, Dental"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[11px] text-gray-500">Amount</label>
              <input
                type="number"
                className="h-[32px] border border-gray-300 rounded-[5px] px-3 text-[12px] bg-white dark:bg-gray-800"
                value={editing.amount}
                onChange={e => setEditing({ ...editing, amount: parseFloat(e.target.value) })}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[11px] text-gray-500">Currency</label>
              <select
                className="h-[32px] border border-gray-300 rounded-[5px] px-2 text-[12px] bg-white dark:bg-gray-800"
                value={editing.currency}
                onChange={e => setEditing({ ...editing, currency: e.target.value as 'USD' | 'EUR' })}
              >
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[11px] text-gray-500">Frequency</label>
              <select
                className="h-[32px] border border-gray-300 rounded-[5px] px-2 text-[12px] bg-white dark:bg-gray-800"
                value={editing.frequency}
                onChange={e => setEditing({ ...editing, frequency: e.target.value as MedicalExpense['frequency'] })}
              >
                <option value="monthly">Monthly</option>
                <option value="yearly">Yearly</option>
                <option value="one_time">One-time</option>
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[11px] text-gray-500">Start (YYYY-MM)</label>
              <input
                className="h-[32px] border border-gray-300 rounded-[5px] px-3 text-[12px] bg-white dark:bg-gray-800"
                value={editing.startDate}
                onChange={e => setEditing({ ...editing, startDate: e.target.value })}
                placeholder="2026-01"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[11px] text-gray-500">End (YYYY-MM, blank = ongoing)</label>
              <input
                className="h-[32px] border border-gray-300 rounded-[5px] px-3 text-[12px] bg-white dark:bg-gray-800"
                value={editing.endDate ?? ''}
                onChange={e => setEditing({ ...editing, endDate: e.target.value || null })}
                placeholder="ongoing"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button
              className="text-[11.5px] px-3 py-1 border border-gray-300 rounded-[5px] hover:bg-gray-50"
              onClick={() => setEditing(null)}
            >Cancel</button>
            <button
              className="text-[11.5px] px-3 py-1 bg-green-50 border border-green-300 text-green-700 rounded-[5px] hover:bg-green-100"
              onClick={() => { upsertMedicalExpense(editing); setEditing(null) }}
            >Save</button>
          </div>
        </div>
      )}
      <Table>
        <TableHead>
          <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_60px] gap-2">
            <span>Name</span><span>Amount</span><span>Frequency</span><span>Currency</span><span>Period</span><span></span>
          </div>
        </TableHead>
        {medicalExpenses.map(e => (
          <TableRow key={e.id}>
            <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_60px] gap-2 items-center">
              <span className="font-medium">{e.name}</span>
              <span>{formatCurrency(e.amount, e.currency)}</span>
              <span className="capitalize text-gray-500">{e.frequency}</span>
              <Badge variant={e.currency === 'EUR' ? 'eur' : 'usd'}>{e.currency}</Badge>
              <span className="text-[11px] text-gray-400">
                {e.endDate ? `${e.startDate} → ${e.endDate}` : `${e.startDate} →`}
              </span>
              <div className="flex gap-2">
                <button className="text-[11px] text-blue-600 hover:underline" onClick={() => setEditing(e)}>Edit</button>
                <button className="text-[11px] text-red-500 hover:underline" onClick={() => deleteMedicalExpense(e.id)}>Del</button>
              </div>
            </div>
          </TableRow>
        ))}
        <TableAddRow onClick={() => setEditing(blankExpense())}>+ Add expense</TableAddRow>
      </Table>
    </section>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function Health() {
  return (
    <div>
      <PageHeader title="Health" />
      <div className="p-4 space-y-8">
        <CoverageSection />
        <hr className="border-gray-200 dark:border-gray-700" />
        <MedicalExpenseSection />
      </div>
    </div>
  )
}
