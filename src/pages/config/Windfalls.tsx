import { useState } from 'react'
import { useAppStore } from '../../store/useAppStore'
import { PageHeader } from '../../components/ui/PageHeader'
import { Table, TableHead, TableRow, TableAddRow } from '../../components/ui/Table'
import { Badge } from '../../components/ui/Badge'
import { formatCurrency, generateId } from '../../lib/format'
import type { Windfall, TaxTreatment } from '../../types'

const TAX_LABELS: Record<TaxTreatment, string> = {
  CAPITAL_GAINS_LT: 'LT capital gains',
  CAPITAL_GAINS_ST: 'ST capital gains',
  ORDINARY_INCOME: 'Ordinary income',
  TAX_FREE: 'Tax-free',
}

const blank = (): Windfall => ({
  id: generateId(), name: '', date: '2027', amount: 0,
  currency: 'USD', taxTreatment: 'CAPITAL_GAINS_LT', notes: '',
})

export default function Windfalls() {
  const { windfalls, upsertWindfall, deleteWindfall } = useAppStore()
  const [editing, setEditing] = useState<Windfall | null>(null)

  return (
    <div>
      <PageHeader title="Windfalls" />
      <div className="p-4 space-y-3">
        {editing && (
          <div className="border border-blue-200 rounded-xl p-4 bg-blue-50 dark:bg-blue-900/10 space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <div className="flex flex-col gap-1 col-span-2"><label className="text-[11px] text-gray-500">Name</label>
                <input className="h-[32px] border border-gray-300 rounded-[5px] px-3 text-[12px] bg-white dark:bg-gray-800" value={editing.name}
                  onChange={e => setEditing({ ...editing, name: e.target.value })} /></div>
              <div className="flex flex-col gap-1"><label className="text-[11px] text-gray-500">Year</label>
                <input className="h-[32px] border border-gray-300 rounded-[5px] px-3 text-[12px] bg-white dark:bg-gray-800" value={editing.date}
                  onChange={e => setEditing({ ...editing, date: e.target.value })} /></div>
              <div className="flex flex-col gap-1"><label className="text-[11px] text-gray-500">Amount</label>
                <input type="number" className="h-[32px] border border-gray-300 rounded-[5px] px-3 text-[12px] bg-white dark:bg-gray-800" value={editing.amount}
                  onChange={e => setEditing({ ...editing, amount: parseFloat(e.target.value) })} /></div>
              <div className="flex flex-col gap-1"><label className="text-[11px] text-gray-500">Currency</label>
                <select className="h-[32px] border border-gray-300 rounded-[5px] px-2 text-[12px] bg-white dark:bg-gray-800" value={editing.currency}
                  onChange={e => setEditing({ ...editing, currency: e.target.value as 'USD' | 'EUR' })}>
                  <option value="USD">USD</option><option value="EUR">EUR</option></select></div>
              <div className="flex flex-col gap-1"><label className="text-[11px] text-gray-500">Tax treatment</label>
                <select className="h-[32px] border border-gray-300 rounded-[5px] px-2 text-[12px] bg-white dark:bg-gray-800" value={editing.taxTreatment}
                  onChange={e => setEditing({ ...editing, taxTreatment: e.target.value as TaxTreatment })}>
                  {Object.entries(TAX_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
              <div className="flex flex-col gap-1 col-span-2"><label className="text-[11px] text-gray-500">Notes</label>
                <input className="h-[32px] border border-gray-300 rounded-[5px] px-3 text-[12px] bg-white dark:bg-gray-800" value={editing.notes}
                  onChange={e => setEditing({ ...editing, notes: e.target.value })} /></div>
            </div>
            <div className="flex gap-2">
              <button className="text-[11.5px] px-3 py-1 border border-gray-300 rounded-[5px]" onClick={() => setEditing(null)}>Cancel</button>
              <button className="text-[11.5px] px-3 py-1 bg-green-50 border border-green-300 text-green-700 rounded-[5px]"
                onClick={() => { upsertWindfall(editing); setEditing(null) }}>Save</button>
            </div>
          </div>
        )}
        <Table>
          <TableHead>
            <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1.5fr_60px] gap-2">
              <span>Name</span><span>Year</span><span>Amount</span><span>Currency</span><span>Tax treatment</span><span></span>
            </div>
          </TableHead>
          {windfalls.map(w => (
            <TableRow key={w.id}>
              <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1.5fr_60px] gap-2 items-center">
                <span className="font-medium">{w.name}</span>
                <span>{w.date}</span>
                <span>{w.amount ? formatCurrency(w.amount, w.currency) : 'TBD'}</span>
                <Badge variant={w.currency === 'EUR' ? 'eur' : 'usd'}>{w.currency}</Badge>
                <span className="text-[11px] text-gray-500">{TAX_LABELS[w.taxTreatment]}</span>
                <div className="flex gap-2">
                  <button className="text-[11px] text-blue-600 hover:underline" onClick={() => setEditing(w)}>Edit</button>
                  <button className="text-[11px] text-red-500 hover:underline" onClick={() => deleteWindfall(w.id)}>Del</button>
                </div>
              </div>
            </TableRow>
          ))}
          <TableAddRow onClick={() => setEditing(blank())}>+ Add windfall</TableAddRow>
        </Table>
      </div>
    </div>
  )
}
