import { useState } from 'react'
import { useAppStore } from '../../store/useAppStore'
import { PageHeader } from '../../components/ui/PageHeader'
import { Table, TableHead, TableRow, TableAddRow } from '../../components/ui/Table'
import { AccountSelect, useAccountName } from '../../components/ui/AccountSelect'
import { formatCurrency, generateId } from '../../lib/format'
import type { Transfer, TransferFrequency } from '../../types'

const FREQ_LABELS: Record<TransferFrequency, string> = {
  once: 'One-time',
  monthly: 'Monthly',
  yearly: 'Yearly',
}

const blank = (): Transfer => ({
  id: generateId(),
  name: '',
  fromAccountId: 0,
  toAccountId: 0,
  amount: 0,
  currency: 'USD',
  frequency: 'once',
  startDate: '2026-06',
  endDate: null,
})

function TransferRow({ t, onEdit, onDelete }: { t: Transfer; onEdit: () => void; onDelete: () => void }) {
  const fromName = useAccountName(t.fromAccountId)
  const toName = useAccountName(t.toAccountId)
  return (
    <TableRow>
      <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr_60px] gap-2 items-center text-[12px]">
        <div>
          <div className="font-medium">{t.name || '—'}</div>
          <div className="text-[10px] text-gray-400 mt-0.5">{FREQ_LABELS[t.frequency]}</div>
        </div>
        <span className="text-blue-600 truncate">{fromName ?? `#${t.fromAccountId}`}</span>
        <span className="text-gray-400 text-[11px]">→</span>
        <span className="text-green-600 truncate">{toName ?? `#${t.toAccountId}`}</span>
        <span className="font-medium">{formatCurrency(t.amount, t.currency)}</span>
        <span className="text-gray-500">{t.startDate}{t.endDate ? ` → ${t.endDate}` : ''}</span>
        <div className="flex gap-2">
          <button className="text-[11px] text-blue-600 hover:underline" onClick={onEdit}>Edit</button>
          <button className="text-[11px] text-red-500 hover:underline" onClick={onDelete}>Del</button>
        </div>
      </div>
    </TableRow>
  )
}

export default function Transfers() {
  const { transfers, upsertTransfer, deleteTransfer } = useAppStore()
  const [editing, setEditing] = useState<Transfer | null>(null)

  function save() {
    if (!editing || !editing.fromAccountId || !editing.toAccountId) return
    upsertTransfer(editing)
    setEditing(null)
  }

  return (
    <div>
      <PageHeader title="Transfers">
        <button
          className="text-[11.5px] px-3 py-1 rounded-[5px] border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          onClick={() => setEditing(blank())}
        >
          + Add transfer
        </button>
      </PageHeader>

      <div className="p-4 space-y-3">
        <p className="text-[11.5px] text-gray-500 dark:text-gray-400">
          Define planned money movements between accounts — e.g. liquidating an investment account to top up cash,
          or moving house sale proceeds to a brokerage. The Cash Flow page uses these to project your cash balance.
        </p>

        {editing && (
          <div className="border border-blue-200 dark:border-blue-700 rounded-xl p-4 bg-blue-50 dark:bg-blue-900/10 space-y-3">
            <h3 className="text-[13px] font-medium">Edit transfer</h3>
            <div className="grid grid-cols-3 gap-3">
              <div className="flex flex-col gap-1 col-span-2">
                <label className="text-[11px] text-gray-500">Label</label>
                <input
                  className="h-[32px] border border-gray-300 dark:border-gray-600 rounded-[5px] px-3 text-[12px] bg-white dark:bg-gray-800"
                  value={editing.name}
                  onChange={e => setEditing({ ...editing, name: e.target.value })}
                  placeholder="e.g. Liquidate IBKR → Checking"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[11px] text-gray-500">Frequency</label>
                <select
                  className="h-[32px] border border-gray-300 dark:border-gray-600 rounded-[5px] px-2 text-[12px] bg-white dark:bg-gray-800"
                  value={editing.frequency}
                  onChange={e => setEditing({ ...editing, frequency: e.target.value as TransferFrequency })}
                >
                  {Object.entries(FREQ_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[11px] text-gray-500">Amount</label>
                <input
                  type="number"
                  className="h-[32px] border border-gray-300 dark:border-gray-600 rounded-[5px] px-3 text-[12px] bg-white dark:bg-gray-800"
                  value={editing.amount}
                  onChange={e => setEditing({ ...editing, amount: parseFloat(e.target.value) || 0 })}
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[11px] text-gray-500">Currency</label>
                <select
                  className="h-[32px] border border-gray-300 dark:border-gray-600 rounded-[5px] px-2 text-[12px] bg-white dark:bg-gray-800"
                  value={editing.currency}
                  onChange={e => setEditing({ ...editing, currency: e.target.value as 'USD' | 'EUR' })}
                >
                  <option value="USD">USD</option><option value="EUR">EUR</option>
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[11px] text-gray-500">Start date (YYYY-MM)</label>
                <input
                  className="h-[32px] border border-gray-300 dark:border-gray-600 rounded-[5px] px-3 text-[12px] bg-white dark:bg-gray-800"
                  value={editing.startDate}
                  onChange={e => setEditing({ ...editing, startDate: e.target.value })}
                  placeholder="2026-06"
                />
              </div>
              {editing.frequency !== 'once' && (
                <div className="flex flex-col gap-1">
                  <label className="text-[11px] text-gray-500">End date (blank = ongoing)</label>
                  <input
                    className="h-[32px] border border-gray-300 dark:border-gray-600 rounded-[5px] px-3 text-[12px] bg-white dark:bg-gray-800"
                    value={editing.endDate ?? ''}
                    onChange={e => setEditing({ ...editing, endDate: e.target.value || null })}
                    placeholder="ongoing"
                  />
                </div>
              )}
              <AccountSelect
                label="From account"
                placeholder="Select source account"
                currency={editing.currency}
                value={editing.fromAccountId || undefined}
                onChange={id => setEditing({ ...editing, fromAccountId: id ?? 0 })}
              />
              <AccountSelect
                label="To account"
                placeholder="Select target account"
                currency={editing.currency}
                value={editing.toAccountId || undefined}
                onChange={id => setEditing({ ...editing, toAccountId: id ?? 0 })}
              />
            </div>
            {(!editing.fromAccountId || !editing.toAccountId) && (
              <p className="text-[11px] text-amber-600">Both source and target accounts are required.</p>
            )}
            <div className="flex gap-2">
              <button className="text-[11.5px] px-3 py-1 border border-gray-300 rounded-[5px] hover:bg-gray-50 dark:hover:bg-gray-800" onClick={() => setEditing(null)}>Cancel</button>
              <button
                className="text-[11.5px] px-3 py-1 bg-green-50 border border-green-300 text-green-700 rounded-[5px] hover:bg-green-100 disabled:opacity-40"
                onClick={save}
                disabled={!editing.fromAccountId || !editing.toAccountId}
              >Save</button>
            </div>
          </div>
        )}

        <Table>
          <TableHead>
            <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr_60px] gap-2">
              <span>Label</span><span>From</span><span></span><span>To</span><span>Amount</span><span>Date</span><span></span>
            </div>
          </TableHead>
          {transfers.length === 0 && (
            <TableRow><div className="text-gray-400 text-[12px]">No transfers defined yet.</div></TableRow>
          )}
          {transfers.map(t => (
            <TransferRow key={t.id} t={t} onEdit={() => setEditing(t)} onDelete={() => deleteTransfer(t.id)} />
          ))}
          <TableAddRow onClick={() => setEditing(blank())}>+ Add transfer</TableAddRow>
        </Table>
      </div>
    </div>
  )
}
