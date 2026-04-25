import { useState } from 'react'
import { useAppStore } from '../../store/useAppStore'
import { PageHeader } from '../../components/ui/PageHeader'
import { Button } from '../../components/ui/Button'
import { Table, TableHead, TableRow, TableAddRow } from '../../components/ui/Table'
import { Badge } from '../../components/ui/Badge'
import { formatCurrency, generateId } from '../../lib/format'
import type { PensionEstimate, PensionSource } from '../../types'

const SOURCE_LABELS: Record<PensionSource, string> = {
  US_SS: '🇺🇸 Social Security',
  FR_CNAV: '🇫🇷 CNAV',
  FR_AGIRC: '🇫🇷 AGIRC-ARRCO',
  OTHER: 'Other',
}

const defaultPension = (): PensionEstimate => ({
  id: generateId(),
  source: 'US_SS',
  label: 'Social Security',
  person: 'self',
  monthlyAmount: 0,
  currency: 'USD',
  startAge: 67,
})

export default function Pensions() {
  const { pensions, upsertPension, deletePension } = useAppStore()
  const [editing, setEditing] = useState<PensionEstimate | null>(null)

  function save() {
    if (editing) { upsertPension(editing); setEditing(null) }
  }

  return (
    <div>
      <PageHeader title="Pensions">
        {editing ? (
          <><Button onClick={() => setEditing(null)}>Cancel</Button><Button variant="success" onClick={save}>Save</Button></>
        ) : null}
      </PageHeader>
      <div className="p-4 space-y-3">
        <p className="text-[11.5px] text-gray-500 dark:text-gray-400">
          Enter estimates from your official sources:{' '}
          <a href="https://ssa.gov/myaccount" target="_blank" rel="noreferrer" className="text-blue-600 underline">ssa.gov</a>{' '}
          and{' '}
          <a href="https://www.info-retraite.fr" target="_blank" rel="noreferrer" className="text-blue-600 underline">info-retraite.fr</a>.
        </p>

        {editing && (
          <div className="border border-blue-200 dark:border-blue-700 rounded-xl p-4 bg-blue-50 dark:bg-blue-900/10 space-y-3">
            <h3 className="text-[13px] font-medium">Edit pension</h3>
            <div className="grid grid-cols-3 gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-[11px] text-gray-500">Source</label>
                <select className="h-[32px] border border-gray-300 dark:border-gray-600 rounded-[5px] px-2 text-[12px] bg-white dark:bg-gray-800"
                  value={editing.source}
                  onChange={e => setEditing({ ...editing, source: e.target.value as PensionSource, label: SOURCE_LABELS[e.target.value as PensionSource] })}>
                  {Object.entries(SOURCE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[11px] text-gray-500">Person</label>
                <select className="h-[32px] border border-gray-300 dark:border-gray-600 rounded-[5px] px-2 text-[12px] bg-white dark:bg-gray-800"
                  value={editing.person} onChange={e => setEditing({ ...editing, person: e.target.value as 'self' | 'spouse' })}>
                  <option value="self">You</option><option value="spouse">Spouse</option>
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[11px] text-gray-500">Currency</label>
                <select className="h-[32px] border border-gray-300 dark:border-gray-600 rounded-[5px] px-2 text-[12px] bg-white dark:bg-gray-800"
                  value={editing.currency} onChange={e => setEditing({ ...editing, currency: e.target.value as 'USD' | 'EUR' })}>
                  <option value="USD">USD</option><option value="EUR">EUR</option>
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[11px] text-gray-500">Monthly amount</label>
                <input type="number" className="h-[32px] border border-gray-300 dark:border-gray-600 rounded-[5px] px-3 text-[12px] bg-white dark:bg-gray-800"
                  value={editing.monthlyAmount} onChange={e => setEditing({ ...editing, monthlyAmount: parseFloat(e.target.value) })} />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[11px] text-gray-500">Start age</label>
                <input type="number" className="h-[32px] border border-gray-300 dark:border-gray-600 rounded-[5px] px-3 text-[12px] bg-white dark:bg-gray-800"
                  value={editing.startAge} onChange={e => setEditing({ ...editing, startAge: parseInt(e.target.value) })} />
              </div>
            </div>
          </div>
        )}

        <Table>
          <TableHead>
            <div className="grid grid-cols-[1.5fr_1fr_1fr_1fr_1fr_80px] gap-2">
              <span>Source</span><span>Person</span><span>Monthly (est.)</span><span>Currency</span><span>Start age</span><span></span>
            </div>
          </TableHead>
          {pensions.map(p => (
            <TableRow key={p.id}>
              <div className="grid grid-cols-[1.5fr_1fr_1fr_1fr_1fr_80px] gap-2 items-center">
                <span>{SOURCE_LABELS[p.source]}</span>
                <span className="capitalize">{p.person}</span>
                <span className="font-medium">{formatCurrency(p.monthlyAmount, p.currency)}</span>
                <Badge variant={p.currency === 'EUR' ? 'eur' : 'usd'}>{p.currency}</Badge>
                <span>{p.startAge}</span>
                <div className="flex gap-2">
                  <button className="text-[11px] text-blue-600 hover:underline" onClick={() => setEditing(p)}>Edit</button>
                  <button className="text-[11px] text-red-500 hover:underline" onClick={() => deletePension(p.id)}>Del</button>
                </div>
              </div>
            </TableRow>
          ))}
          <TableAddRow onClick={() => setEditing(defaultPension())}>+ Add pension source</TableAddRow>
        </Table>
      </div>
    </div>
  )
}
