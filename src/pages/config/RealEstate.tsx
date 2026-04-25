import { useState } from 'react'
import { useAppStore } from '../../store/useAppStore'
import { PageHeader } from '../../components/ui/PageHeader'
import { Table, TableHead, TableRow, TableAddRow } from '../../components/ui/Table'
import { Badge } from '../../components/ui/Badge'
import { formatCurrency, generateId } from '../../lib/format'
import type { RealEstateEvent } from '../../types'

const TYPE_LABELS = { sell: '🏠 Sell', buy: '🏡 Buy', rent: '🔑 Rent' }

const blank = (): RealEstateEvent => ({
  id: generateId(), eventType: 'sell', date: '2026-06', amount: 0,
  currency: 'USD', isRecurring: false, endDate: null, notes: '',
})

export default function RealEstate() {
  const { realEstateEvents, upsertRealEstateEvent, deleteRealEstateEvent } = useAppStore()
  const [editing, setEditing] = useState<RealEstateEvent | null>(null)

  return (
    <div>
      <PageHeader title="Real estate" />
      <div className="p-4 space-y-3">
        {editing && (
          <div className="border border-blue-200 dark:border-blue-700 rounded-xl p-4 bg-blue-50 dark:bg-blue-900/10 space-y-3">
            <h3 className="text-[13px] font-medium">Edit event</h3>
            <div className="grid grid-cols-3 gap-3">
              {[
                <div key="type" className="flex flex-col gap-1"><label className="text-[11px] text-gray-500">Type</label>
                  <select className="h-[32px] border border-gray-300 rounded-[5px] px-2 text-[12px] bg-white dark:bg-gray-800" value={editing.eventType}
                    onChange={e => setEditing({ ...editing, eventType: e.target.value as RealEstateEvent['eventType'] })}>
                    <option value="sell">Sell</option><option value="buy">Buy</option><option value="rent">Rent</option>
                  </select></div>,
                <div key="date" className="flex flex-col gap-1"><label className="text-[11px] text-gray-500">Date (YYYY-MM)</label>
                  <input className="h-[32px] border border-gray-300 rounded-[5px] px-3 text-[12px] bg-white dark:bg-gray-800" value={editing.date}
                    onChange={e => setEditing({ ...editing, date: e.target.value })} /></div>,
                <div key="amount" className="flex flex-col gap-1"><label className="text-[11px] text-gray-500">Amount</label>
                  <input type="number" className="h-[32px] border border-gray-300 rounded-[5px] px-3 text-[12px] bg-white dark:bg-gray-800" value={editing.amount}
                    onChange={e => setEditing({ ...editing, amount: parseFloat(e.target.value) })} /></div>,
                <div key="cur" className="flex flex-col gap-1"><label className="text-[11px] text-gray-500">Currency</label>
                  <select className="h-[32px] border border-gray-300 rounded-[5px] px-2 text-[12px] bg-white dark:bg-gray-800" value={editing.currency}
                    onChange={e => setEditing({ ...editing, currency: e.target.value as 'USD' | 'EUR' })}>
                    <option value="USD">USD</option><option value="EUR">EUR</option>
                  </select></div>,
                <div key="notes" className="flex flex-col gap-1 col-span-2"><label className="text-[11px] text-gray-500">Notes</label>
                  <input className="h-[32px] border border-gray-300 rounded-[5px] px-3 text-[12px] bg-white dark:bg-gray-800" value={editing.notes}
                    onChange={e => setEditing({ ...editing, notes: e.target.value })} /></div>,
              ]}
            </div>
            <div className="flex gap-2">
              <button className="text-[11.5px] px-3 py-1 border border-gray-300 rounded-[5px] hover:bg-gray-50" onClick={() => setEditing(null)}>Cancel</button>
              <button className="text-[11.5px] px-3 py-1 bg-green-50 border border-green-300 text-green-700 rounded-[5px] hover:bg-green-100"
                onClick={() => { upsertRealEstateEvent(editing); setEditing(null) }}>Save</button>
            </div>
          </div>
        )}
        <Table>
          <TableHead>
            <div className="grid grid-cols-[1fr_1fr_1fr_1fr_1.2fr_60px] gap-2">
              <span>Event</span><span>Date</span><span>Amount</span><span>Currency</span><span>Notes</span><span></span>
            </div>
          </TableHead>
          {realEstateEvents.map(e => (
            <TableRow key={e.id}>
              <div className="grid grid-cols-[1fr_1fr_1fr_1fr_1.2fr_60px] gap-2 items-center">
                <span>{TYPE_LABELS[e.eventType]}</span>
                <span>{e.date}</span>
                <span className="font-medium">{formatCurrency(e.amount, e.currency)}{e.isRecurring ? '/mo' : ''}</span>
                <Badge variant={e.currency === 'EUR' ? 'eur' : 'usd'}>{e.currency}</Badge>
                <span className="text-[11px] text-gray-400 truncate">{e.notes}</span>
                <div className="flex gap-2">
                  <button className="text-[11px] text-blue-600 hover:underline" onClick={() => setEditing(e)}>Edit</button>
                  <button className="text-[11px] text-red-500 hover:underline" onClick={() => deleteRealEstateEvent(e.id)}>Del</button>
                </div>
              </div>
            </TableRow>
          ))}
          <TableAddRow onClick={() => setEditing(blank())}>+ Add event</TableAddRow>
        </Table>
      </div>
    </div>
  )
}
