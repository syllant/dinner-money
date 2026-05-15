import { useState } from 'react'
import { useAppStore } from '../../store/useAppStore'
import { PageHeader } from '../../components/ui/PageHeader'
import { Table, TableHead, TableRow, TableAddRow } from '../../components/ui/Table'
import { SortBtn, useSort } from '../../components/ui/SortBtn'
import { AccountSelect, useAccountName } from '../../components/ui/AccountSelect'
import { NumericInput } from '../../components/ui/NumericInput'
import { RecurringIcon, OneTimeIcon, CUR_BADGE, curBadgeClass, curSymbol } from '../../components/ui/FrequencyDisplay'
import { generateId } from '../../lib/format'
import { confirmDelete } from '../../lib/confirm'
import type { Transfer, TransferFrequency } from '../../types'

// ─── Constants ────────────────────────────────────────────────────────────────

const FREQ_LABELS: Record<TransferFrequency, string> = {
  once: 'One-time',
  monthly: 'Monthly',
  yearly: 'Yearly',
}

type SortKey = 'name' | 'amount' | 'period' | 'from' | 'to'

// [freq-icon, period, amount+cur, name, from, →, to, actions]
const GRID_COLS = 'grid grid-cols-[20px_120px_110px_2fr_1fr_14px_1fr_72px] gap-x-3 items-center'

const blank = (): Transfer => ({
  id: generateId(), name: '', fromAccountId: 0, toAccountId: 0,
  amount: 0, currency: 'USD', frequency: 'once', startDate: '2026-06', endDate: null,
})

// ─── Frequency icon ───────────────────────────────────────────────────────────

function TransferFreqIcon({ freq }: { freq: TransferFrequency }) {
  if (freq === 'monthly') return <RecurringIcon letter="m" />
  if (freq === 'yearly') return <RecurringIcon letter="y" />
  return <OneTimeIcon />
}

function periodStr(t: Transfer): string {
  if (t.frequency === 'once') return t.startDate
  return t.endDate ? `${t.startDate} → ${t.endDate}` : `${t.startDate} →`
}

import { EditIcon, DupIcon, DelIcon } from '../../components/ui/Icons'

// ─── Row ─────────────────────────────────────────────────────────────────────

function TransferRow({ t, editing, setEditing, onDuplicate, onDelete, onSave }: {
  t: Transfer;
  editing: Transfer | null;
  setEditing: (t: Transfer | null) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onSave: () => void;
}) {
  const fromName = useAccountName(t.fromAccountId)
  const toName = useAccountName(t.toAccountId)
  return (
    <TableRow>
      <div className={GRID_COLS}>
        <span className="flex items-center justify-center text-gray-400" title={FREQ_LABELS[t.frequency]}>
          <TransferFreqIcon freq={t.frequency} />
        </span>
        <span className="text-[10.5px] text-gray-400 truncate">{periodStr(t)}</span>
        <div className="flex items-center justify-end gap-1">
          <span className="font-medium tabular-nums">{t.amount.toLocaleString()}</span>
          <span className={`${CUR_BADGE} ${curBadgeClass(t.currency)}`}>{curSymbol(t.currency)}</span>
        </div>
        <span className="truncate">{t.name || '—'}</span>
        <span className="text-[11px] text-blue-500 truncate">{fromName ?? `#${t.fromAccountId}`}</span>
        <span className="text-gray-400 text-[11px]">→</span>
        <span className="text-[11px] text-green-600 truncate">{toName ?? `#${t.toAccountId}`}</span>
        <div className="flex gap-2 justify-end">
          <button className="text-gray-400 hover:text-blue-500" onClick={() => setEditing(t)}><EditIcon /></button>
          <button className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300" onClick={onDuplicate}><DupIcon /></button>
          <button className="text-gray-400 hover:text-red-500" onClick={onDelete}><DelIcon /></button>
        </div>
      </div>

      {editing?.id === t.id && editing && (
        <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-700/60 space-y-3">
          {/* Row 1: Label (wide) */}
          <div className="flex flex-col gap-1">
            <label className="text-[11px] text-gray-500">Label</label>
            <input
              className="h-[32px] border border-gray-300 dark:border-gray-600 rounded-[5px] px-3 text-[12px] bg-white dark:bg-gray-800"
              value={editing.name}
              onChange={e => setEditing({ ...editing, name: e.target.value })}
              placeholder="e.g. Liquidate IBKR → Checking"
              autoFocus
            />
          </div>
          {/* Row 2: Amount + Currency + From + To */}
          <div className="grid grid-cols-[1fr_100px_1fr_1fr] gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-[11px] text-gray-500">Amount</label>
              <NumericInput
                className="h-[32px] border border-gray-300 dark:border-gray-600 rounded-[5px] px-3 text-[12px] bg-white dark:bg-gray-800 w-full"
                value={editing.amount}
                onChange={v => setEditing({ ...editing, amount: v ?? 0 })}
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
              value={editing.toAccountId || undefined}
              onChange={id => setEditing({ ...editing, toAccountId: id ?? 0 })}
            />
          </div>
          {/* Row 3: Frequency + Start + End */}
          <div className="flex gap-3">
            <div className="flex flex-col gap-1 w-[160px] shrink-0">
              <label className="text-[11px] text-gray-500">Frequency</label>
              <select
                className="h-[32px] border border-gray-300 dark:border-gray-600 rounded-[5px] px-2 text-[12px] bg-white dark:bg-gray-800"
                value={editing.frequency}
                onChange={e => setEditing({ ...editing, frequency: e.target.value as TransferFrequency })}
              >
                {Object.entries(FREQ_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1 w-[120px] shrink-0">
              <label className="text-[11px] text-gray-500">{editing.frequency === 'once' ? 'Date (YYYY-MM)' : 'Start (YYYY-MM)'}</label>
              <input
                className="h-[32px] border border-gray-300 dark:border-gray-600 rounded-[5px] px-3 text-[12px] bg-white dark:bg-gray-800"
                value={editing.startDate}
                onChange={e => setEditing({ ...editing, startDate: e.target.value })}
                placeholder="2026-06"
              />
            </div>
            {editing.frequency !== 'once' && (
              <div className="flex flex-col gap-1 w-[130px] shrink-0">
                <label className="text-[11px] text-gray-500">End (YYYY-MM)</label>
                <input
                  className="h-[32px] border border-gray-300 dark:border-gray-600 rounded-[5px] px-3 text-[12px] bg-white dark:bg-gray-800"
                  value={editing.endDate ?? ''}
                  onChange={e => setEditing({ ...editing, endDate: e.target.value || null })}
                  placeholder="ongoing"
                />
              </div>
            )}
          </div>
          {(!editing.fromAccountId || !editing.toAccountId) && (
            <p className="text-[11px] text-amber-600">Both source and target accounts are required.</p>
          )}
          <div className="flex gap-2">
            <button className="text-[11.5px] px-3 py-1 border border-gray-300 rounded-[5px] hover:bg-gray-50 dark:hover:bg-gray-800" onClick={() => setEditing(null)}>Cancel</button>
            <button
              className="text-[11.5px] px-3 py-1 bg-green-50 border border-green-300 text-green-700 rounded-[5px] hover:bg-green-100 disabled:opacity-40"
              onClick={onSave}
              disabled={!editing.fromAccountId || !editing.toAccountId}
            >Save</button>
          </div>
        </div>
      )}
    </TableRow>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function Transfers({ showHeader = true }: { showHeader?: boolean }) {
  const { transfers, upsertTransfer, deleteTransfer } = useAppStore()
  const [editing, setEditing] = useState<Transfer | null>(null)
  const { sort, toggle: handleSort } = useSort<SortKey>('period')

  const sorted = [...transfers].sort((a, b) => {
    let av: string | number, bv: string | number
    if (sort.key === 'period') { av = a.startDate; bv = b.startDate }
    else if (sort.key === 'amount') { av = a.amount; bv = b.amount }
    else if (sort.key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase() }
    else if (sort.key === 'from') { av = a.fromAccountId; bv = b.fromAccountId }
    else { av = a.toAccountId; bv = b.toAccountId }
    if (av < bv) return sort.dir === 'asc' ? -1 : 1
    if (av > bv) return sort.dir === 'asc' ? 1 : -1
    return 0
  })

  function duplicate(t: Transfer) { setEditing({ ...t, id: generateId() }) }

  function save() {
    if (!editing || !editing.fromAccountId || !editing.toAccountId) return
    upsertTransfer(editing)
    setEditing(null)
  }

  return (
    <div>
      {showHeader && (
        <PageHeader title="Transfers">
          <button
            className="text-[11.5px] px-3 py-1 rounded-[5px] border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            onClick={() => setEditing(blank())}
          >
            + Add transfer
          </button>
        </PageHeader>
      )}

      <div className="p-4 space-y-4">
        <p className="text-[11.5px] text-gray-500 dark:text-gray-400">
          Define planned money movements between accounts — e.g. liquidating an investment account to top up cash,
          or moving house sale proceeds to a brokerage. The Cash Flow page uses these to project your cash balance.
        </p>

        {editing && !transfers.find(t => t.id === editing.id) && (
          <div className="border border-blue-200 dark:border-blue-700 rounded-xl p-4 bg-blue-50 dark:bg-blue-900/10 space-y-3 mb-4">
            {/* Row 1: Label (wide) */}
            <div className="flex flex-col gap-1">
              <label className="text-[11px] text-gray-500">Label</label>
              <input
                className="h-[32px] border border-gray-300 dark:border-gray-600 rounded-[5px] px-3 text-[12px] bg-white dark:bg-gray-800"
                value={editing.name}
                onChange={e => setEditing({ ...editing, name: e.target.value })}
                placeholder="e.g. Liquidate IBKR → Checking"
                autoFocus
              />
            </div>
            {/* Row 2: Amount + Currency + From + To */}
            <div className="grid grid-cols-[1fr_100px_1fr_1fr] gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-[11px] text-gray-500">Amount</label>
                <NumericInput
                  className="h-[32px] border border-gray-300 dark:border-gray-600 rounded-[5px] px-3 text-[12px] bg-white dark:bg-gray-800 w-full"
                  value={editing.amount}
                  onChange={v => setEditing({ ...editing, amount: v ?? 0 })}
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
                value={editing.toAccountId || undefined}
                onChange={id => setEditing({ ...editing, toAccountId: id ?? 0 })}
              />
            </div>
            {/* Row 3: Frequency + Start + End */}
            <div className="flex gap-3">
              <div className="flex flex-col gap-1 w-[160px] shrink-0">
                <label className="text-[11px] text-gray-500">Frequency</label>
                <select
                  className="h-[32px] border border-gray-300 dark:border-gray-600 rounded-[5px] px-2 text-[12px] bg-white dark:bg-gray-800"
                  value={editing.frequency}
                  onChange={e => setEditing({ ...editing, frequency: e.target.value as TransferFrequency })}
                >
                  {Object.entries(FREQ_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div className="flex flex-col gap-1 w-[120px] shrink-0">
                <label className="text-[11px] text-gray-500">{editing.frequency === 'once' ? 'Date (YYYY-MM)' : 'Start (YYYY-MM)'}</label>
                <input
                  className="h-[32px] border border-gray-300 dark:border-gray-600 rounded-[5px] px-3 text-[12px] bg-white dark:bg-gray-800"
                  value={editing.startDate}
                  onChange={e => setEditing({ ...editing, startDate: e.target.value })}
                  placeholder="2026-06"
                />
              </div>
              {editing.frequency !== 'once' && (
                <div className="flex flex-col gap-1 w-[130px] shrink-0">
                  <label className="text-[11px] text-gray-500">End (YYYY-MM)</label>
                  <input
                    className="h-[32px] border border-gray-300 dark:border-gray-600 rounded-[5px] px-3 text-[12px] bg-white dark:bg-gray-800"
                    value={editing.endDate ?? ''}
                    onChange={e => setEditing({ ...editing, endDate: e.target.value || null })}
                    placeholder="ongoing"
                  />
                </div>
              )}
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
            <div className={GRID_COLS}>
              <span></span>
              <SortBtn col="period" label="Period" sort={sort} onToggle={handleSort} />
              <SortBtn col="amount" label="Amount" sort={sort} onToggle={handleSort} />
              <SortBtn col="name" label="Label" sort={sort} onToggle={handleSort} />
              <SortBtn col="from" label="From" sort={sort} onToggle={handleSort} />
              <span></span>
              <SortBtn col="to" label="To" sort={sort} onToggle={handleSort} />
              <span></span>
            </div>
          </TableHead>
          {transfers.length === 0 && (
            <TableRow><div className="text-gray-400 text-[12px]">No transfers defined yet.</div></TableRow>
          )}
          {sorted.map(t => (
            <TransferRow
              key={t.id}
              t={t}
              editing={editing}
              setEditing={setEditing}
              onDuplicate={() => duplicate(t)}
              onDelete={() => { if (confirmDelete(t.name || 'this transfer')) deleteTransfer(t.id) }}
              onSave={save}
            />
          ))}
          <TableAddRow onClick={() => setEditing(blank())}>+ Add transfer</TableAddRow>
        </Table>
      </div>
    </div>
  )
}
