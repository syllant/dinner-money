import { useState } from 'react'
import { useAppStore } from '../../store/useAppStore'
import { PageHeader } from '../../components/ui/PageHeader'
import { Table, TableHead, TableRow, TableAddRow } from '../../components/ui/Table'
import { SortBtn, useSort } from '../../components/ui/SortBtn'
import { AccountSelect, useAccountName } from '../../components/ui/AccountSelect'
import { NumericInput } from '../../components/ui/NumericInput'
import { RecurringIcon, OneTimeIcon, CUR_BADGE, curBadgeClass, curSymbol } from '../../components/ui/FrequencyDisplay'
import { generateId } from '../../lib/format'
import type { PensionEstimate, PensionSource, ExpenseFrequency } from '../../types'

// ─── Constants ────────────────────────────────────────────────────────────────

const SOURCE_LABELS: Record<string, string> = {
  US_SS:      '🇺🇸 Social Security',
  FR_RETRAITE:'🇫🇷 French pension',
  FR_CNAV:    '🇫🇷 French pension (CNAV)',  // legacy
  FR_AGIRC:   '🇫🇷 French pension (AGIRC)', // legacy
  OTHER:      'Other',
}

const SOURCE_OPTIONS: PensionSource[] = ['US_SS', 'FR_RETRAITE', 'OTHER']

type SortKey = 'source' | 'person' | 'amount' | 'period'

// [freq-icon, period, age, amount, source, person, account, actions]
const GRID_COLS = 'grid grid-cols-[20px_110px_55px_110px_2fr_80px_1fr_72px] gap-x-3 items-center'

const FREQ_LABELS: Record<string, string> = {
  monthly: 'Monthly',
  yearly: 'Yearly',
  one_time: 'One-time',
}

function PensionFreqIcon({ freq }: { freq: ExpenseFrequency }) {
  if (freq === 'monthly') return <RecurringIcon letter="m" />
  if (freq === 'yearly') return <RecurringIcon letter="y" />
  return <OneTimeIcon />
}

const defaultPension = (source: PensionSource = 'US_SS'): PensionEstimate => ({
  id: generateId(),
  source,
  label: SOURCE_LABELS[source] ?? source,
  person: 'self',
  amount: 0,
  currency: source === 'FR_RETRAITE' ? 'EUR' : 'USD',
  frequency: 'monthly',
  startDate: '2040-01',
  endDate: null,
})

import { EditIcon, DelIcon } from '../../components/ui/Icons'

function periodStr(p: PensionEstimate): string {
  if (p.frequency === 'one_time') return p.startDate
  return p.endDate ? `${p.startDate} → ${p.endDate}` : `${p.startDate} →`
}

function getAgeSpan(p: PensionEstimate, profile: any): string {
  const by = p.person === 'self' ? profile.birthYear : profile.spouseBirthYear
  const startY = parseInt(p.startDate.split('-')[0]) || 0
  const age = startY && by ? startY - by : null
  return age ? String(age) : '—'
}

// ─── Row ─────────────────────────────────────────────────────────────────────

function PensionRow({
  p,
  editing,
  profile,
  setEditing,
  onSave,
  onDelete
}: {
  p: PensionEstimate;
  editing: PensionEstimate | null;
  profile: any;
  setEditing: (p: PensionEstimate | null) => void;
  onSave: () => void;
  onDelete: () => void;
}) {
  const accountName = useAccountName(p.targetAccountId)
  const isEditing = editing?.id === p.id

  return (
    <TableRow>
      <div className={GRID_COLS}>
        <span className="flex items-center justify-center text-gray-400" title={FREQ_LABELS[p.frequency]}>
          <PensionFreqIcon freq={p.frequency} />
        </span>
        <span className="text-[10.5px] text-gray-400 truncate">{periodStr(p)}</span>
        <span className="text-[10.5px] text-gray-400">{getAgeSpan(p, profile)}</span>
        <div className="flex items-center justify-end gap-1">
          <span className="font-medium tabular-nums">{p.amount.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}</span>
          <span className={`${CUR_BADGE} ${curBadgeClass(p.currency)}`}>{curSymbol(p.currency)}</span>
        </div>
        <div className="min-w-0 truncate">
          {SOURCE_LABELS[p.source] ?? p.source}
        </div>
        <span className="capitalize text-[12.5px] text-gray-500">{p.person === 'self' ? 'You' : 'Spouse'}</span>
        <span className="text-[10.5px] text-gray-400 truncate">{accountName ?? '—'}</span>
        <div className="flex gap-2 justify-end">
          <button className="text-gray-400 hover:text-blue-500" onClick={() => setEditing(p)}><EditIcon /></button>
          <button className="text-gray-400 hover:text-red-500" onClick={onDelete}><DelIcon /></button>
        </div>
      </div>
      
      {isEditing && (
        <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-700/60 space-y-3">
          {/* Row 1: Source + Person */}
          <div className="grid grid-cols-[1fr_120px] gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-[11px] text-gray-500">Source</label>
              <select className="h-[32px] border border-gray-300 dark:border-gray-600 rounded-[5px] px-2 text-[12px] bg-white dark:bg-gray-800"
                value={editing.source}
                onChange={e => setEditing({ ...editing, source: e.target.value as PensionSource, label: SOURCE_LABELS[e.target.value] ?? e.target.value })}>
                {SOURCE_OPTIONS.map(k => <option key={k} value={k}>{SOURCE_LABELS[k]}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[11px] text-gray-500">Person</label>
              <select className="h-[32px] border border-gray-300 dark:border-gray-600 rounded-[5px] px-2 text-[12px] bg-white dark:bg-gray-800"
                value={editing.person} onChange={e => setEditing({ ...editing, person: e.target.value as 'self' | 'spouse' })}>
                <option value="self">You</option><option value="spouse">Spouse</option>
              </select>
            </div>
          </div>
          {/* Row 2: Amount + Currency + Account */}
          <div className="grid grid-cols-[150px_100px_1fr] gap-3">
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
              <select className="h-[32px] border border-gray-300 dark:border-gray-600 rounded-[5px] px-2 text-[12px] bg-white dark:bg-gray-800"
                value={editing.currency} onChange={e => setEditing({ ...editing, currency: e.target.value as 'USD' | 'EUR' })}>
                <option value="USD">USD</option><option value="EUR">EUR</option>
              </select>
            </div>
            <AccountSelect
              label="Deposited to account"
              placeholder="Cash (unspecified)"
              currency={editing.currency}
              value={editing.targetAccountId}
              onChange={id => setEditing({ ...editing, targetAccountId: id })}
            />
          </div>
          {/* Row 3: Frequency + Dates */}
          <div className="grid grid-cols-[120px_140px_140px] gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-[11px] text-gray-500">Frequency</label>
              <select className="h-[32px] border border-gray-300 dark:border-gray-600 rounded-[5px] px-2 text-[12px] bg-white dark:bg-gray-800"
                value={editing.frequency} onChange={e => setEditing({ ...editing, frequency: e.target.value as ExpenseFrequency })}>
                {Object.entries(FREQ_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[11px] text-gray-500">{editing.frequency === 'one_time' ? 'Date' : 'Start'} (YYYY-MM)</label>
              <input className="h-[32px] border border-gray-300 dark:border-gray-600 rounded-[5px] px-3 text-[12px] bg-white dark:bg-gray-800"
                value={editing.startDate} onChange={e => setEditing({ ...editing, startDate: e.target.value })} placeholder="2040-01" />
              {(() => {
                const y = parseInt(editing.startDate.split('-')[0])
                const by = editing.person === 'self' ? profile?.birthYear : profile?.spouseBirthYear
                return y && by ? <span className="text-[10px] text-gray-400 pl-1">age {y - by}</span> : null
              })()}
            </div>
            {editing.frequency !== 'one_time' && (
              <div className="flex flex-col gap-1">
                <label className="text-[11px] text-gray-500">End (YYYY-MM)</label>
                <input className="h-[32px] border border-gray-300 dark:border-gray-600 rounded-[5px] px-3 text-[12px] bg-white dark:bg-gray-800"
                  value={editing.endDate ?? ''} onChange={e => setEditing({ ...editing, endDate: e.target.value || null })} placeholder="ongoing" />
                {(() => {
                  if (!editing.endDate) return null
                  const y = parseInt(editing.endDate.split('-')[0])
                  const by = editing.person === 'self' ? profile?.birthYear : profile?.spouseBirthYear
                  return y && by ? <span className="text-[10px] text-gray-400 pl-1">age {y - by}</span> : null
                })()}
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

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function Pensions() {
  const { pensions, upsertPension, deletePension, profile } = useAppStore()
  const [editing, setEditing] = useState<PensionEstimate | null>(null)
  const { sort, toggle: handleSort } = useSort<SortKey>('source')

  const sorted = [...pensions].sort((a, b) => {
    let av: string | number, bv: string | number
    if (sort.key === 'source') { av = (SOURCE_LABELS[a.source] ?? a.source).toLowerCase(); bv = (SOURCE_LABELS[b.source] ?? b.source).toLowerCase() }
    else if (sort.key === 'person') { av = a.person; bv = b.person }
    else if (sort.key === 'amount') { av = a.amount; bv = b.amount }
    else { av = a.startDate; bv = b.startDate }
    if (av < bv) return sort.dir === 'asc' ? -1 : 1
    if (av > bv) return sort.dir === 'asc' ? 1 : -1
    return 0
  })

  function save() {
    if (editing) { upsertPension(editing); setEditing(null) }
  }

  return (
    <div>
      <PageHeader title="Pensions">
        <button
          className="text-[11.5px] px-3 py-1 rounded-[5px] border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          onClick={() => setEditing(defaultPension('US_SS'))}
        >
          + Add pension source
        </button>
      </PageHeader>

      <div className="p-4 space-y-4">
        <p className="text-[11.5px] text-gray-500 dark:text-gray-400">
          Enter estimates from your official sources:{' '}
          <a href="https://ssa.gov/myaccount" target="_blank" rel="noreferrer" className="text-blue-600 underline">ssa.gov</a>{' '}
          and{' '}
          <a href="https://www.info-retraite.fr" target="_blank" rel="noreferrer" className="text-blue-600 underline">info-retraite.fr</a>.
        </p>

        {editing && !pensions.find(p => p.id === editing.id) && (
          <div className="border border-blue-200 dark:border-blue-700 rounded-xl p-4 bg-blue-50 dark:bg-blue-900/10 space-y-3 mb-4">
            {/* Row 1: Source + Person */}
            <div className="grid grid-cols-[1fr_120px] gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-[11px] text-gray-500">Source</label>
                <select className="h-[32px] border border-gray-300 dark:border-gray-600 rounded-[5px] px-2 text-[12px] bg-white dark:bg-gray-800"
                  value={editing.source}
                  onChange={e => setEditing({ ...editing, source: e.target.value as PensionSource, label: SOURCE_LABELS[e.target.value] ?? e.target.value })}>
                  {SOURCE_OPTIONS.map(k => <option key={k} value={k}>{SOURCE_LABELS[k]}</option>)}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[11px] text-gray-500">Person</label>
                <select className="h-[32px] border border-gray-300 dark:border-gray-600 rounded-[5px] px-2 text-[12px] bg-white dark:bg-gray-800"
                  value={editing.person} onChange={e => setEditing({ ...editing, person: e.target.value as 'self' | 'spouse' })}>
                  <option value="self">You</option><option value="spouse">Spouse</option>
                </select>
              </div>
            </div>
            {/* Row 2: Amount + Currency + Account */}
            <div className="grid grid-cols-[150px_100px_1fr] gap-3">
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
                <select className="h-[32px] border border-gray-300 dark:border-gray-600 rounded-[5px] px-2 text-[12px] bg-white dark:bg-gray-800"
                  value={editing.currency} onChange={e => setEditing({ ...editing, currency: e.target.value as 'USD' | 'EUR' })}>
                  <option value="USD">USD</option><option value="EUR">EUR</option>
                </select>
              </div>
              <AccountSelect
                label="Deposited to account"
                placeholder="Cash (unspecified)"
                currency={editing.currency}
                value={editing.targetAccountId}
                onChange={id => setEditing({ ...editing, targetAccountId: id })}
              />
            </div>
            {/* Row 3: Frequency + Dates */}
            <div className="grid grid-cols-[120px_140px_140px] gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-[11px] text-gray-500">Frequency</label>
                <select className="h-[32px] border border-gray-300 dark:border-gray-600 rounded-[5px] px-2 text-[12px] bg-white dark:bg-gray-800"
                  value={editing.frequency} onChange={e => setEditing({ ...editing, frequency: e.target.value as ExpenseFrequency })}>
                  {Object.entries(FREQ_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[11px] text-gray-500">{editing.frequency === 'one_time' ? 'Date' : 'Start'} (YYYY-MM)</label>
                <input className="h-[32px] border border-gray-300 dark:border-gray-600 rounded-[5px] px-3 text-[12px] bg-white dark:bg-gray-800"
                  value={editing.startDate} onChange={e => setEditing({ ...editing, startDate: e.target.value })} placeholder="2040-01" />
                {(() => {
                  const y = parseInt(editing.startDate.split('-')[0])
                  const by = editing.person === 'self' ? profile?.birthYear : profile?.spouseBirthYear
                  return y && by ? <span className="text-[10px] text-gray-400 pl-1">age {y - by}</span> : null
                })()}
              </div>
              {editing.frequency !== 'one_time' && (
                <div className="flex flex-col gap-1">
                  <label className="text-[11px] text-gray-500">End (YYYY-MM)</label>
                  <input className="h-[32px] border border-gray-300 dark:border-gray-600 rounded-[5px] px-3 text-[12px] bg-white dark:bg-gray-800"
                    value={editing.endDate ?? ''} onChange={e => setEditing({ ...editing, endDate: e.target.value || null })} placeholder="ongoing" />
                  {(() => {
                    if (!editing.endDate) return null
                    const y = parseInt(editing.endDate.split('-')[0])
                    const by = editing.person === 'self' ? profile?.birthYear : profile?.spouseBirthYear
                    return y && by ? <span className="text-[10px] text-gray-400 pl-1">age {y - by}</span> : null
                  })()}
                </div>
              )}
            </div>
            <div className="flex gap-2">
              <button className="text-[11.5px] px-3 py-1 border border-gray-300 rounded-[5px] hover:bg-gray-50 dark:hover:bg-gray-800" onClick={() => setEditing(null)}>Cancel</button>
              <button className="text-[11.5px] px-3 py-1 bg-green-50 border border-green-300 text-green-700 rounded-[5px] hover:bg-green-100" onClick={save}>Save</button>
            </div>
          </div>
        )}

        <Table>
          <TableHead>
            <div className={GRID_COLS}>
              <span></span>
              <SortBtn col="period" label="Period" sort={sort} onToggle={handleSort} />
              <span className="text-gray-400 font-medium">Age</span>
              <SortBtn col="amount" label="Amount" sort={sort} onToggle={handleSort} />
              <SortBtn col="source" label="Source" sort={sort} onToggle={handleSort} />
              <SortBtn col="person" label="Person" sort={sort} onToggle={handleSort} />
              <span>Account</span>
              <span></span>
            </div>
          </TableHead>
          {sorted.map(p => (
            <PensionRow
              key={p.id}
              p={p}
              profile={profile}
              editing={editing}
              setEditing={setEditing}
              onSave={save}
              onDelete={() => deletePension(p.id)}
            />
          ))}
          <TableAddRow onClick={() => setEditing(defaultPension('US_SS'))}>+ Add pension source</TableAddRow>
        </Table>
      </div>
    </div>
  )
}
