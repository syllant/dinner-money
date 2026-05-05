import { useState } from 'react'
import { useAppStore } from '../../store/useAppStore'
import { PageHeader } from '../../components/ui/PageHeader'
import { Table, TableHead, TableRow, TableAddRow } from '../../components/ui/Table'
import { AccountSelect, useAccountName } from '../../components/ui/AccountSelect'
import { generateId } from '../../lib/format'
import { confirmDelete } from '../../lib/confirm'
import type { RealEstateEvent } from '../../types'

const TYPE_LABELS = { sell: '🏠 Sell', buy: '🏡 Buy', rent: '🔑 Rent' }

const blank = (): RealEstateEvent => ({
  id: generateId(), eventType: 'sell', date: '2026-06', amount: 0,
  currency: 'USD', isRecurring: false, endDate: null, notes: '',
})

import { EditIcon, DelIcon } from '../../components/ui/Icons'
import { OneTimeIcon, RecurringIcon, CUR_BADGE, curBadgeClass, curSymbol } from '../../components/ui/FrequencyDisplay'

const GRID_COLS = 'grid grid-cols-[20px_130px_110px_1fr_2fr_72px] gap-x-3 items-center'

function RealEstateRow({
  e,
  editing,
  setEditing,
  onSave,
  onDelete
}: {
  e: RealEstateEvent;
  editing: RealEstateEvent | null;
  setEditing: (e: RealEstateEvent | null) => void;
  onSave: () => void;
  onDelete: () => void;
}) {
  const flowAccountId = e.eventType === 'sell' ? e.targetAccountId : e.sourceAccountId
  const flowAccountName = useAccountName(flowAccountId)
  const propertyAccountName = useAccountName(e.sourceRealEstateAccountId)
  const mortgageAccountName = useAccountName(e.sourceMortgageAccountId)
  const arrow = e.eventType === 'sell' ? '→' : '←'
  const isEditing = editing?.id === e.id
  
  const period = e.endDate ? `${e.date} → ${e.endDate}` : (e.isRecurring ? `${e.date} →` : e.date)

  return (
    <TableRow>
      <div className={GRID_COLS}>
        <span className="flex items-center justify-center text-gray-400">
          {e.isRecurring ? <RecurringIcon letter="m" /> : <OneTimeIcon />}
        </span>
        <span className="text-[10.5px] text-gray-400 truncate">{period}</span>
        <div className="flex items-center justify-end gap-1">
          <span className="font-medium tabular-nums">{e.amount.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}</span>
          <span className={`${CUR_BADGE} ${curBadgeClass(e.currency)}`}>{curSymbol(e.currency)}</span>
        </div>
        <span className="truncate">{TYPE_LABELS[e.eventType]}</span>
        <span className="text-[10.5px] text-gray-400 truncate">
          {e.eventType === 'sell' && propertyAccountName ? `${propertyAccountName} · ` : ''}
          {flowAccountName ? `${arrow} ${flowAccountName}` : '—'}
          {e.eventType === 'sell' && mortgageAccountName ? ` · closes ${mortgageAccountName}` : ''}
        </span>
        <div className="flex gap-2">
          <button className="text-gray-400 hover:text-blue-500" onClick={() => setEditing(e)}><EditIcon /></button>
          <button className="text-gray-400 hover:text-red-500" onClick={onDelete}><DelIcon /></button>
        </div>
      </div>

      {isEditing && (
        <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-700/60 space-y-3">
          <h3 className="text-[13px] font-medium">Edit event</h3>
          {/* Row 1: Type */}
          <div className="grid grid-cols-[1fr] gap-3">
            <div className="flex flex-col gap-1 w-[150px]">
              <label className="text-[11px] text-gray-500">Type</label>
              <select className="h-[32px] border border-gray-300 rounded-[5px] px-2 text-[12px] bg-white dark:bg-gray-800"
                value={editing.eventType}
                onChange={ev => setEditing({ ...editing, eventType: ev.target.value as RealEstateEvent['eventType'] })}>
                <option value="sell">Sell</option><option value="buy">Buy</option><option value="rent">Rent</option>
              </select>
            </div>
          </div>
          {/* Row 2: Amount + Currency + Account */}
          <div className="grid grid-cols-[150px_100px_1fr] gap-3 mt-3">
            <div className="flex flex-col gap-1">
              <label className="text-[11px] text-gray-500">Amount</label>
              <input type="number" className="h-[32px] border border-gray-300 rounded-[5px] px-3 text-[12px] bg-white dark:bg-gray-800"
                value={editing.amount} onChange={ev => setEditing({ ...editing, amount: parseFloat(ev.target.value) })} />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[11px] text-gray-500">Currency</label>
              <select className="h-[32px] border border-gray-300 rounded-[5px] px-2 text-[12px] bg-white dark:bg-gray-800"
                value={editing.currency} onChange={ev => setEditing({ ...editing, currency: ev.target.value as 'USD' | 'EUR' })}>
                <option value="USD">USD</option><option value="EUR">EUR</option>
              </select>
            </div>
            {editing.eventType === 'sell' ? (
              <div className="grid grid-cols-2 gap-3">
                <AccountSelect
                  label="Property account"
                  placeholder="Select real estate"
                  allowedTypes={['real_estate']}
                  value={editing.sourceRealEstateAccountId}
                  onChange={id => setEditing({ ...editing, sourceRealEstateAccountId: id })}
                />
                <AccountSelect
                    label="Proceeds deposited to"
                    placeholder="Cash (unspecified)"
                    currency={editing.currency}
                    value={editing.targetAccountId}
                    onChange={id => setEditing({ ...editing, targetAccountId: id })}
                  />
              </div>
            ) : (
              <AccountSelect
                label="Payment funded by"
                placeholder="Cash (unspecified)"
                currency={editing.currency}
                value={editing.sourceAccountId}
                onChange={id => setEditing({ ...editing, sourceAccountId: id })}
              />
            )}
          </div>
          {editing.eventType === 'sell' && (
            <div className="grid grid-cols-[250px] gap-3 mt-3">
              <AccountSelect
                label="Associated mortgage account"
                placeholder="None"
                allowedTypes={['loan']}
                value={editing.sourceMortgageAccountId}
                onChange={id => setEditing({ ...editing, sourceMortgageAccountId: id })}
              />
            </div>
          )}
          {/* Row 3: Frequency + Dates */}
          <div className="grid grid-cols-[120px_140px_140px] gap-3 mt-3">
            <div className="flex flex-col gap-1">
              <label className="text-[11px] text-gray-500">Frequency</label>
              <select className="h-[32px] border border-gray-300 rounded-[5px] px-2 text-[12px] bg-white dark:bg-gray-800"
                value={editing.isRecurring ? 'monthly' : 'one_time'}
                onChange={ev => setEditing({ ...editing, isRecurring: ev.target.value === 'monthly' })}>
                <option value="monthly">Monthly</option>
                <option value="one_time">One-time</option>
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[11px] text-gray-500">{editing.isRecurring ? 'Start' : 'Date'} (YYYY-MM)</label>
              <input className="h-[32px] border border-gray-300 rounded-[5px] px-3 text-[12px] bg-white dark:bg-gray-800"
                value={editing.date} onChange={ev => setEditing({ ...editing, date: ev.target.value })} />
            </div>
            {editing.isRecurring && (
              <div className="flex flex-col gap-1">
                <label className="text-[11px] text-gray-500">End date (YYYY-MM)</label>
                <input className="h-[32px] border border-gray-300 rounded-[5px] px-3 text-[12px] bg-white dark:bg-gray-800"
                  value={editing.endDate ?? ''} placeholder="ongoing"
                  onChange={ev => setEditing({ ...editing, endDate: ev.target.value || null })} />
              </div>
            )}
          </div>
          <div className="flex gap-2">
            <button className="text-[11.5px] px-3 py-1 border border-gray-300 rounded-[5px] hover:bg-gray-50 dark:hover:bg-gray-800" onClick={() => setEditing(null)}>Cancel</button>
            <button className="text-[11.5px] px-3 py-1 bg-green-50 border border-green-300 text-green-700 rounded-[5px] hover:bg-green-100" onClick={onSave}>Save</button>
          </div>
        </div>
      )}
    </TableRow>
  )
}

export default function RealEstate() {
  const { realEstateEvents, upsertRealEstateEvent, deleteRealEstateEvent } = useAppStore()
  const [editing, setEditing] = useState<RealEstateEvent | null>(null)

  return (
    <div>
      <PageHeader title="Real estate" />
      <div className="p-4 space-y-3">
        {editing && !realEstateEvents.find(e => e.id === editing.id) && (
          <div className="border border-blue-200 dark:border-blue-700 rounded-xl p-4 bg-blue-50 dark:bg-blue-900/10 space-y-3 mb-4">
            <h3 className="text-[13px] font-medium">Add event</h3>
            {/* Row 1: Type */}
            <div className="grid grid-cols-[1fr] gap-3">
              <div className="flex flex-col gap-1 w-[150px]">
                <label className="text-[11px] text-gray-500">Type</label>
                <select className="h-[32px] border border-gray-300 rounded-[5px] px-2 text-[12px] bg-white dark:bg-gray-800"
                  value={editing.eventType}
                  onChange={e => setEditing({ ...editing, eventType: e.target.value as RealEstateEvent['eventType'] })}>
                  <option value="sell">Sell</option><option value="buy">Buy</option><option value="rent">Rent</option>
                </select>
              </div>
            </div>
            {/* Row 2: Amount + Currency + Account */}
            <div className="grid grid-cols-[150px_100px_1fr] gap-3 mt-3">
              <div className="flex flex-col gap-1">
                <label className="text-[11px] text-gray-500">Amount</label>
                <input type="number" className="h-[32px] border border-gray-300 rounded-[5px] px-3 text-[12px] bg-white dark:bg-gray-800"
                  value={editing.amount} onChange={e => setEditing({ ...editing, amount: parseFloat(e.target.value) })} />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[11px] text-gray-500">Currency</label>
                <select className="h-[32px] border border-gray-300 rounded-[5px] px-2 text-[12px] bg-white dark:bg-gray-800"
                  value={editing.currency} onChange={e => setEditing({ ...editing, currency: e.target.value as 'USD' | 'EUR' })}>
                  <option value="USD">USD</option><option value="EUR">EUR</option>
                </select>
              </div>
              {editing.eventType === 'sell' ? (
                <div className="grid grid-cols-2 gap-3">
                  <AccountSelect
                    label="Property account"
                    placeholder="Select real estate"
                    allowedTypes={['real_estate']}
                    value={editing.sourceRealEstateAccountId}
                    onChange={id => setEditing({ ...editing, sourceRealEstateAccountId: id })}
                  />
                  <AccountSelect
                      label="Proceeds deposited to"
                      placeholder="Cash (unspecified)"
                      currency={editing.currency}
                      value={editing.targetAccountId}
                      onChange={id => setEditing({ ...editing, targetAccountId: id })}
                    />
                </div>
              ) : (
                <AccountSelect
                  label="Payment funded by"
                  placeholder="Cash (unspecified)"
                  currency={editing.currency}
                  value={editing.sourceAccountId}
                  onChange={id => setEditing({ ...editing, sourceAccountId: id })}
                />
              )}
            </div>
            {editing.eventType === 'sell' && (
              <div className="grid grid-cols-[250px] gap-3 mt-3">
                <AccountSelect
                  label="Associated mortgage account"
                  placeholder="None"
                  allowedTypes={['loan']}
                  value={editing.sourceMortgageAccountId}
                  onChange={id => setEditing({ ...editing, sourceMortgageAccountId: id })}
                />
              </div>
            )}
            {/* Row 3: Frequency + Dates */}
            <div className="grid grid-cols-[120px_140px_140px] gap-3 mt-3">
              <div className="flex flex-col gap-1">
                <label className="text-[11px] text-gray-500">Frequency</label>
                <select className="h-[32px] border border-gray-300 rounded-[5px] px-2 text-[12px] bg-white dark:bg-gray-800"
                  value={editing.isRecurring ? 'monthly' : 'one_time'}
                  onChange={e => setEditing({ ...editing, isRecurring: e.target.value === 'monthly' })}>
                  <option value="monthly">Monthly</option>
                  <option value="one_time">One-time</option>
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[11px] text-gray-500">{editing.isRecurring ? 'Start' : 'Date'} (YYYY-MM)</label>
                <input className="h-[32px] border border-gray-300 rounded-[5px] px-3 text-[12px] bg-white dark:bg-gray-800"
                  value={editing.date} onChange={e => setEditing({ ...editing, date: e.target.value })} />
              </div>
              {editing.isRecurring && (
                <div className="flex flex-col gap-1">
                  <label className="text-[11px] text-gray-500">End date (YYYY-MM)</label>
                  <input className="h-[32px] border border-gray-300 rounded-[5px] px-3 text-[12px] bg-white dark:bg-gray-800"
                    value={editing.endDate ?? ''} placeholder="ongoing"
                    onChange={e => setEditing({ ...editing, endDate: e.target.value || null })} />
                </div>
              )}
            </div>
            <div className="flex gap-2">
              <button className="text-[11.5px] px-3 py-1 border border-gray-300 rounded-[5px] hover:bg-gray-50 dark:hover:bg-gray-800" onClick={() => setEditing(null)}>Cancel</button>
              <button className="text-[11.5px] px-3 py-1 bg-green-50 border border-green-300 text-green-700 rounded-[5px] hover:bg-green-100"
                onClick={() => { upsertRealEstateEvent(editing); setEditing(null) }}>Save</button>
            </div>
          </div>
        )}
        <Table>
          <TableHead>
            <div className={GRID_COLS}>
              <span></span>
              <span>Period</span>
              <span className="text-right pr-1">Amount</span>
              <span>Event</span>
              <span>Account</span>
              <span></span>
            </div>
          </TableHead>
          {realEstateEvents.map(e => (
            <RealEstateRow
              key={e.id}
              e={e}
              editing={editing}
              setEditing={setEditing}
              onSave={() => { upsertRealEstateEvent(editing!); setEditing(null) }}
              onDelete={() => { if (confirmDelete(e.notes || TYPE_LABELS[e.eventType])) deleteRealEstateEvent(e.id) }}
            />
          ))}
          <TableAddRow onClick={() => setEditing(blank())}>+ Add event</TableAddRow>
        </Table>
      </div>
    </div>
  )
}
