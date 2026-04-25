import { useState } from 'react'
import { useAppStore } from '../../store/useAppStore'
import { PageHeader } from '../../components/ui/PageHeader'
import { Table, TableHead, TableRow, TableAddRow } from '../../components/ui/Table'
import { Badge } from '../../components/ui/Badge'
import { formatCurrency, generateId } from '../../lib/format'
import type { Expense } from '../../types'

const blank = (): Expense => ({
  id: generateId(), name: '', amount: 0, frequency: 'monthly',
  currency: 'EUR', startDate: '2026-01', endDate: null, category: 'Living',
})

export default function Expenses() {
  const { expenses, upsertExpense, deleteExpense } = useAppStore()
  const [editing, setEditing] = useState<Expense | null>(null)

  return (
    <div>
      <PageHeader title="Expenses" />
      <div className="p-4 space-y-3">
        {editing && (
          <div className="border border-blue-200 rounded-xl p-4 bg-blue-50 dark:bg-blue-900/10 space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <div className="flex flex-col gap-1 col-span-2"><label className="text-[11px] text-gray-500">Name</label>
                <input className="h-[32px] border border-gray-300 rounded-[5px] px-3 text-[12px] bg-white dark:bg-gray-800" value={editing.name}
                  onChange={e => setEditing({ ...editing, name: e.target.value })} /></div>
              <div className="flex flex-col gap-1"><label className="text-[11px] text-gray-500">Amount</label>
                <input type="number" className="h-[32px] border border-gray-300 rounded-[5px] px-3 text-[12px] bg-white dark:bg-gray-800" value={editing.amount}
                  onChange={e => setEditing({ ...editing, amount: parseFloat(e.target.value) })} /></div>
              <div className="flex flex-col gap-1"><label className="text-[11px] text-gray-500">Currency</label>
                <select className="h-[32px] border border-gray-300 rounded-[5px] px-2 text-[12px] bg-white dark:bg-gray-800" value={editing.currency}
                  onChange={e => setEditing({ ...editing, currency: e.target.value as 'USD' | 'EUR' })}>
                  <option value="USD">USD</option><option value="EUR">EUR</option></select></div>
              <div className="flex flex-col gap-1"><label className="text-[11px] text-gray-500">Frequency</label>
                <select className="h-[32px] border border-gray-300 rounded-[5px] px-2 text-[12px] bg-white dark:bg-gray-800" value={editing.frequency}
                  onChange={e => setEditing({ ...editing, frequency: e.target.value as Expense['frequency'] })}>
                  <option value="monthly">Monthly</option><option value="yearly">Yearly</option><option value="one_time">One-time</option></select></div>
              <div className="flex flex-col gap-1"><label className="text-[11px] text-gray-500">Start (YYYY-MM)</label>
                <input className="h-[32px] border border-gray-300 rounded-[5px] px-3 text-[12px] bg-white dark:bg-gray-800" value={editing.startDate}
                  onChange={e => setEditing({ ...editing, startDate: e.target.value })} /></div>
              <div className="flex flex-col gap-1"><label className="text-[11px] text-gray-500">End (YYYY-MM, blank=ongoing)</label>
                <input className="h-[32px] border border-gray-300 rounded-[5px] px-3 text-[12px] bg-white dark:bg-gray-800" value={editing.endDate ?? ''}
                  onChange={e => setEditing({ ...editing, endDate: e.target.value || null })} /></div>
            </div>
            <div className="flex gap-2">
              <button className="text-[11.5px] px-3 py-1 border border-gray-300 rounded-[5px]" onClick={() => setEditing(null)}>Cancel</button>
              <button className="text-[11.5px] px-3 py-1 bg-green-50 border border-green-300 text-green-700 rounded-[5px]"
                onClick={() => { upsertExpense(editing); setEditing(null) }}>Save</button>
            </div>
          </div>
        )}
        <Table>
          <TableHead>
            <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_60px] gap-2">
              <span>Name</span><span>Amount</span><span>Frequency</span><span>Currency</span><span>Period</span><span></span>
            </div>
          </TableHead>
          {expenses.map(e => (
            <TableRow key={e.id}>
              <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_60px] gap-2 items-center">
                <span className="font-medium">{e.name}</span>
                <span>{formatCurrency(e.amount, e.currency)}</span>
                <span className="capitalize text-gray-500">{e.frequency}</span>
                <Badge variant={e.currency === 'EUR' ? 'eur' : 'usd'}>{e.currency}</Badge>
                <span className="text-[11px] text-gray-400">{e.endDate ? `${e.startDate} → ${e.endDate}` : `${e.startDate} →`}</span>
                <div className="flex gap-2">
                  <button className="text-[11px] text-blue-600 hover:underline" onClick={() => setEditing(e)}>Edit</button>
                  <button className="text-[11px] text-red-500 hover:underline" onClick={() => deleteExpense(e.id)}>Del</button>
                </div>
              </div>
            </TableRow>
          ))}
          <TableAddRow onClick={() => setEditing(blank())}>+ Add expense</TableAddRow>
        </Table>
      </div>
    </div>
  )
}
