import { useState } from 'react'
import { useAppStore } from '../../store/useAppStore'
import { PageHeader } from '../../components/ui/PageHeader'
import { Table, TableHead, TableRow, TableAddRow } from '../../components/ui/Table'
import { SortBtn, useSort } from '../../components/ui/SortBtn'
import { AccountSelect, useAccountName } from '../../components/ui/AccountSelect'
import { NumericInput } from '../../components/ui/NumericInput'
import {
  periodLabel, getFrequencyDisplay,
  CUR_BADGE, curBadgeClass, curSymbol,
} from '../../components/ui/FrequencyDisplay'
import { generateId } from '../../lib/format'
import { confirmDelete } from '../../lib/confirm'
import type { Windfall, TaxTreatment, ExpenseFrequency, RealizedGainLot, TaxLot } from '../../types'

// ─── Constants ────────────────────────────────────────────────────────────────

const TAX_LABELS: Record<TaxTreatment, string> = {
  CAPITAL_GAINS_LT: 'Capital gains',
  CAPITAL_GAINS_ST: 'Capital gains',
  ORDINARY_INCOME: 'Ordinary income',
  TAX_FREE: 'Tax-free',
}

const TAX_OPTIONS: Array<{ value: TaxTreatment; label: string }> = [
  { value: 'ORDINARY_INCOME', label: 'Ordinary income' },
  { value: 'CAPITAL_GAINS_LT', label: 'Capital gains' },
  { value: 'TAX_FREE', label: 'Tax-free' },
]

const INCOME_CATEGORIES = [
  'Bonus', 'Gift', 'Inheritance', 'Insurance', 'Other income',
  'Property sale', 'Rental income', 'Salary', 'Stock sale',
]

function isCapitalGainTreatment(treatment: TaxTreatment): boolean {
  return treatment === 'CAPITAL_GAINS_LT' || treatment === 'CAPITAL_GAINS_ST'
}

function realizedGainLotsTotal(lots: RealizedGainLot[] | undefined): number {
  return (lots ?? []).reduce((sum, lot) => sum + Math.max(0, lot.proceeds - lot.costBasis), 0)
}

function holdingPeriodLabel(lot: RealizedGainLot, saleMonth: string, fallback: TaxTreatment): string {
  if (!lot.acquiredDate) return TAX_LABELS[fallback]
  const acquired = new Date(lot.acquiredDate)
  const sold = new Date(`${saleMonth.slice(0, 7)}-01`)
  if (Number.isNaN(acquired.getTime()) || Number.isNaN(sold.getTime())) return TAX_LABELS[fallback]
  return sold.getTime() - acquired.getTime() > 365 * 24 * 60 * 60 * 1000 ? 'LT cap. gains' : 'ST cap. gains'
}

function realizedLotsFromAccountLots(taxLots: TaxLot[] | undefined, saleAmount: number, currency: 'USD' | 'EUR'): RealizedGainLot[] {
  const lots = (taxLots ?? []).filter(lot => lot.marketValue > 0)
  const totalValue = lots.reduce((sum, lot) => sum + lot.marketValue, 0)
  if (lots.length === 0 || totalValue <= 0 || saleAmount <= 0) return []
  const scale = Math.min(1, saleAmount / totalValue)
  return lots.map(lot => ({
    id: generateId(),
    description: lot.ticker ?? lot.name,
    proceeds: Math.round(lot.marketValue * scale),
    costBasis: Math.round(Math.max(0, lot.costBasis ?? 0) * scale),
    currency: (lot.currency.toUpperCase() === 'EUR' ? 'EUR' : currency),
    acquiredDate: lot.acquiredDate ?? '',
  }))
}

type SortKey = 'period' | 'amount' | 'name' | 'category'

// ─── Helpers ─────────────────────────────────────────────────────────────────

const blank = (): Windfall => ({
  id: generateId(), name: '', date: '2027-06', endDate: null,
  frequency: 'one_time', amount: 0,
  currency: 'USD', taxTreatment: 'ORDINARY_INCOME', category: '',
})

// [icon, period, amount+cur, name, tax, account, actions]
const GRID_COLS = 'grid grid-cols-[20px_130px_110px_2fr_190px_1fr_72px] gap-x-3 items-center'

import { EditIcon, DupIcon, DelIcon } from '../../components/ui/Icons'

// ─── Row ─────────────────────────────────────────────────────────────────────

function IncomeRow({
  w,
  editing,
  setEditing,
  onSave,
  onDuplicate,
  onDelete,
  categoryOptions
}: {
  w: Windfall;
  editing: Windfall | null;
  setEditing: (w: Windfall | null) => void;
  onSave: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  categoryOptions: string[];
}) {
  const accountName = useAccountName(w.targetAccountId)
  const sourceAccountName = useAccountName(w.sourceAccountId)
  const freq = getFrequencyDisplay({ frequency: w.frequency })
  const period = periodLabel(w.frequency, w.date, w.endDate ?? null)
  const realizedGain = realizedGainLotsTotal(w.realizedLots)

  return (
    <TableRow>
      <div className={GRID_COLS}>
        <span className="flex items-center justify-center text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 cursor-help" title={freq.title}>
          {freq.node}
        </span>
        <span className="text-[10.5px] text-gray-400 truncate">{period}</span>
        <div className="flex items-center justify-end gap-1">
          <span className="font-medium tabular-nums">{w.amount.toLocaleString()}</span>
          <span className={`${CUR_BADGE} ${curBadgeClass(w.currency)}`}>{curSymbol(w.currency)}</span>
        </div>
        <div className="min-w-0 truncate pl-2">
          <span>{w.name}</span>
        </div>
        <span className="text-[10.5px] text-gray-400 whitespace-normal leading-snug">
          {TAX_LABELS[w.taxTreatment]}
          {realizedGain > 0 && <span className="ml-1">gain {realizedGain.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>}
        </span>
        <span className="text-[10.5px] text-gray-400 truncate">{sourceAccountName ? `${sourceAccountName} → ` : ''}{accountName ?? '—'}</span>
        <div className="flex gap-2 justify-end">
          <button className="text-gray-400 hover:text-blue-500" onClick={() => setEditing(w)}><EditIcon /></button>
          <button className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300" onClick={onDuplicate}><DupIcon /></button>
          <button className="text-gray-400 hover:text-red-500" onClick={onDelete}><DelIcon /></button>
        </div>
      </div>
      {editing?.id === w.id && editing && (
        <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-700/60">
          <EditForm
            editing={editing as Windfall}
            onChange={patch => setEditing({ ...editing, ...patch })}
            onSave={onSave}
            onCancel={() => setEditing(null)}
            categoryOptions={categoryOptions}
            embedded
          />
        </div>
      )}
    </TableRow>
  )
}

// ─── Edit form ────────────────────────────────────────────────────────────────

function EditForm({ editing, onChange, onSave, onCancel, categoryOptions, embedded }: {
  editing: Windfall
  onChange: (patch: Partial<Windfall>) => void
  onSave: () => void
  onCancel: () => void
  categoryOptions: string[]
  embedded?: boolean
}) {
  const accounts = useAppStore(s => s.accounts)
  const isOneTime = editing.frequency === 'one_time'
  const usesCapitalGainLots = isCapitalGainTreatment(editing.taxTreatment)
  const realizedGain = realizedGainLotsTotal(editing.realizedLots)
  function updateLot(index: number, patch: Partial<RealizedGainLot>) {
    const lots = [...(editing.realizedLots ?? [])]
    lots[index] = { ...lots[index], ...patch }
    onChange({ realizedLots: lots })
  }
  function addLot() {
    const lots = editing.realizedLots ?? []
    onChange({
      realizedLots: [
        ...lots,
        {
          id: generateId(),
          description: '',
          proceeds: editing.amount || 0,
          costBasis: 0,
          currency: editing.currency,
          acquiredDate: '',
        },
      ],
    })
  }
  function deleteLot(index: number) {
    onChange({ realizedLots: (editing.realizedLots ?? []).filter((_, i) => i !== index) })
  }
  function syncLotsFromAccount(accountId: number | undefined) {
    const account = accountId != null
      ? accounts.find(item => item.id === accountId && item.includedInPlanning !== false)
      : undefined
    const lots = realizedLotsFromAccountLots(account?.taxLots, editing.amount, editing.currency)
    onChange({ sourceAccountId: accountId, realizedLots: lots.length > 0 ? lots : editing.realizedLots })
  }
  return (
    <div className={embedded ? "space-y-3 mb-1" : "border border-blue-200 rounded-xl p-4 bg-blue-50 dark:bg-blue-900/10 space-y-3 mb-4"}>
      {/* Row 1: Name + Category */}
      <div className="grid grid-cols-[1fr_180px] gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-[11px] text-gray-500">Name</label>
          <input className="h-[32px] border border-gray-300 rounded-[5px] px-3 text-[12px] bg-white dark:bg-gray-800"
            value={editing.name} onChange={e => onChange({ name: e.target.value })} autoFocus />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[11px] text-gray-500">Category</label>
          <input
            className="h-[32px] border border-gray-300 rounded-[5px] px-3 text-[12px] bg-white dark:bg-gray-800"
            list="income-categories"
            value={editing.category ?? ''}
            onChange={e => onChange({ category: e.target.value })}
            onFocus={e => e.target.select()}
            placeholder="e.g. Salary"
          />
          <datalist id="income-categories">
            {categoryOptions.map(c => <option key={c} value={c} />)}
          </datalist>
        </div>
      </div>
      {/* Row 2: Amount + Currency + Tax treatment + Account */}
      <div className="grid grid-cols-[1fr_100px_1fr_1fr] gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-[11px] text-gray-500">Amount</label>
          <NumericInput
            className="h-[32px] border border-gray-300 rounded-[5px] px-3 text-[12px] bg-white dark:bg-gray-800 w-full"
            value={editing.amount}
            onChange={v => onChange({ amount: v ?? 0 })}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[11px] text-gray-500">Currency</label>
          <select className="h-[32px] border border-gray-300 rounded-[5px] px-2 text-[12px] bg-white dark:bg-gray-800"
            value={editing.currency} onChange={e => onChange({ currency: e.target.value as 'USD' | 'EUR' })}>
            <option value="USD">USD</option><option value="EUR">EUR</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[11px] text-gray-500">Tax treatment</label>
          <select className="h-[32px] border border-gray-300 rounded-[5px] px-2 text-[12px] bg-white dark:bg-gray-800"
            value={editing.taxTreatment} onChange={e => onChange({ taxTreatment: e.target.value as TaxTreatment })}>
            {TAX_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </div>
        <AccountSelect
          label="Proceeds deposited to"
          placeholder="Cash (unspecified)"
          currency={editing.currency}
          value={editing.targetAccountId}
          onChange={id => onChange({ targetAccountId: id })}
        />
      </div>
      {usesCapitalGainLots && (
        <div className="grid grid-cols-[1fr_1fr] gap-3">
          <AccountSelect
            label="Sold from account"
            placeholder="[Other] private equity / external"
            allowedTypes={['investment', 'retirement']}
            value={editing.sourceAccountId}
            onChange={syncLotsFromAccount}
          />
          <div className="flex flex-col gap-1">
            <label className="text-[11px] text-gray-500">Taxable gain from lots</label>
            <div className="h-[32px] flex items-center px-3 text-[12px] rounded-[5px] border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 text-gray-600 dark:text-gray-300">
              {realizedGain.toLocaleString(undefined, { maximumFractionDigits: 0 })} {editing.currency}
            </div>
          </div>
        </div>
      )}
      {usesCapitalGainLots && (
        <div className="rounded-[8px] border border-gray-200 dark:border-gray-700 p-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-[12px] font-medium">Realized gain lots</div>
              <div className="text-[10.5px] text-gray-500 dark:text-gray-400">
                Tax uses proceeds minus cost basis for each lot. Holding period is derived from acquired date.
              </div>
            </div>
            <button
              type="button"
              className="text-[11px] px-2.5 py-1 rounded-[5px] border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800"
              onClick={addLot}
            >
              + Add lot
            </button>
          </div>
          {(editing.realizedLots ?? []).length > 0 ? (
            <div className="space-y-1.5">
              {(editing.realizedLots ?? []).map((lot, index) => (
                <div key={lot.id} className="grid grid-cols-[1.2fr_92px_92px_70px_110px_78px_24px] gap-2 items-end">
                  <label className="flex flex-col gap-1">
                    <span className="text-[10.5px] text-gray-500">Lot / ticker</span>
                    <input
                      className="h-[28px] border border-gray-300 rounded-[5px] px-2 text-[11px] bg-white dark:bg-gray-800"
                      value={lot.description}
                      onChange={event => updateLot(index, { description: event.target.value })}
                      placeholder="VTI lot"
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-[10.5px] text-gray-500">Proceeds</span>
                    <NumericInput
                      className="h-[28px] border border-gray-300 rounded-[5px] px-2 text-[11px] bg-white dark:bg-gray-800"
                      value={lot.proceeds}
                      onChange={value => updateLot(index, { proceeds: value ?? 0 })}
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-[10.5px] text-gray-500">Basis</span>
                    <NumericInput
                      className="h-[28px] border border-gray-300 rounded-[5px] px-2 text-[11px] bg-white dark:bg-gray-800"
                      value={lot.costBasis}
                      onChange={value => updateLot(index, { costBasis: value ?? 0 })}
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-[10.5px] text-gray-500">Currency</span>
                    <select
                      className="h-[28px] border border-gray-300 rounded-[5px] px-1 text-[11px] bg-white dark:bg-gray-800"
                      value={lot.currency}
                      onChange={event => updateLot(index, { currency: event.target.value as 'USD' | 'EUR' })}
                    >
                      <option value="USD">USD</option>
                      <option value="EUR">EUR</option>
                    </select>
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-[10.5px] text-gray-500">Acquired</span>
                    <input
                      className="h-[28px] border border-gray-300 rounded-[5px] px-2 text-[11px] bg-white dark:bg-gray-800"
                      value={lot.acquiredDate ?? ''}
                      onChange={event => updateLot(index, { acquiredDate: event.target.value })}
                      placeholder="YYYY-MM-DD"
                    />
                  </label>
                  <div className="pb-1 text-[10.5px] text-gray-500">{holdingPeriodLabel(lot, editing.date, editing.taxTreatment)}</div>
                  <button
                    type="button"
                    className="h-[28px] text-gray-400 hover:text-red-500"
                    onClick={() => deleteLot(index)}
                    aria-label="Delete lot"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-[11px] text-gray-400">
              No lots yet. Without lots, tax falls back to treating the full amount as taxable gain.
            </div>
          )}
        </div>
      )}
      {/* Row 3: Frequency + Date + End */}
      <div className="flex gap-3">
        <div className="flex flex-col gap-1 w-[160px] shrink-0">
          <label className="text-[11px] text-gray-500">Frequency</label>
          <select className="h-[32px] border border-gray-300 rounded-[5px] px-2 text-[12px] bg-white dark:bg-gray-800"
            value={editing.frequency}
            onChange={e => onChange({ frequency: e.target.value as ExpenseFrequency })}>
            <option value="one_time">One-time</option>
            <option value="monthly">Monthly</option>
            <option value="yearly">Yearly</option>
          </select>
        </div>
        <div className="flex flex-col gap-1 w-[120px] shrink-0">
          <label className="text-[11px] text-gray-500">{isOneTime ? 'Date (YYYY-MM)' : 'Start (YYYY-MM)'}</label>
          <input className="h-[32px] border border-gray-300 rounded-[5px] px-3 text-[12px] bg-white dark:bg-gray-800"
            value={editing.date} onChange={e => onChange({ date: e.target.value })} placeholder="2027-06" />
        </div>
        {!isOneTime && (
          <div className="flex flex-col gap-1 w-[130px] shrink-0">
            <label className="text-[11px] text-gray-500">End (YYYY-MM)</label>
            <input className="h-[32px] border border-gray-300 rounded-[5px] px-3 text-[12px] bg-white dark:bg-gray-800"
              value={editing.endDate ?? ''} onChange={e => onChange({ endDate: e.target.value || null })} placeholder="ongoing" />
          </div>
        )}
      </div>
      <div className="flex gap-2">
        <button className="text-[11.5px] px-3 py-1 border border-gray-300 rounded-[5px] hover:bg-gray-50" onClick={onCancel}>Cancel</button>
        <button className="text-[11.5px] px-3 py-1 bg-green-50 border border-green-300 text-green-700 rounded-[5px] hover:bg-green-100" onClick={onSave}>Save</button>
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function Windfalls({ showHeader = true }: { showHeader?: boolean }) {
  const { windfalls, upsertWindfall, deleteWindfall } = useAppStore()
  const [editing, setEditing] = useState<Windfall | null>(null)
  const { sort, toggle: handleSort } = useSort<SortKey>('period')

  // All categories: predefined + any already in use, sorted
  const allCategoryOptions = Array.from(
    new Set([...INCOME_CATEGORIES, ...windfalls.map(w => w.category ?? '').filter(Boolean)])
  ).sort((a, b) => a.localeCompare(b))

  // Group by category for display
  const allCats = Array.from(new Set(['', ...windfalls.map(w => w.category ?? '')]))
    .sort((a, b) => {
      if (!a) return -1
      if (!b) return 1
      return a.localeCompare(b)
    })

  function sortItems(items: Windfall[]) {
    return [...items].sort((a, b) => {
      let av: string | number, bv: string | number
      if (sort.key === 'period') { av = a.date; bv = b.date }
      else if (sort.key === 'amount') { av = a.amount; bv = b.amount }
      else if (sort.key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase() }
      else { av = (a.category ?? '').toLowerCase(); bv = (b.category ?? '').toLowerCase() }
      if (av < bv) return sort.dir === 'asc' ? -1 : 1
      if (av > bv) return sort.dir === 'asc' ? 1 : -1
      return 0
    })
  }

  return (
    <div>
      {showHeader && (
        <PageHeader title="Income">
          <button
            className="text-[11.5px] px-3 py-1 rounded-[5px] border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            onClick={() => setEditing(blank())}
          >
            + Add income
          </button>
        </PageHeader>
      )}

      <div className="p-4 space-y-4">
        {editing && !windfalls.find(w => w.id === editing.id) && (
          <EditForm
            editing={editing}
            onChange={patch => setEditing(e => e ? { ...e, ...patch } : e)}
            onSave={() => { upsertWindfall(editing); setEditing(null) }}
            onCancel={() => setEditing(null)}
            categoryOptions={allCategoryOptions}
          />
        )}

        <Table>
          <TableHead>
            <div className={GRID_COLS}>
              <span></span>
              <SortBtn col="period" label="Period" sort={sort} onToggle={handleSort} />
              <SortBtn col="amount" label="Amount" sort={sort} onToggle={handleSort} />
              <SortBtn col="name" label="Name" sort={sort} onToggle={handleSort} />
              <span>Tax</span>
              <span>Account</span>
              <span></span>
            </div>
          </TableHead>
          {allCats.map(cat => {
            const items = windfalls.filter(w => (w.category ?? '') === cat)
            if (items.length === 0) return null
            const sorted = sortItems(items)
            return (
              <div key={cat}>
                <div className="px-3 py-[6px] bg-gray-50/80 dark:bg-gray-800/40 border-t border-gray-200 dark:border-gray-700 text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                  {cat || '[No category]'}
                </div>
                {sorted.map(w => (
                  <IncomeRow
                    key={w.id}
                    w={w}
                    editing={editing}
                    setEditing={setEditing}
                    onSave={() => { upsertWindfall(editing!); setEditing(null) }}
                    onDuplicate={() => setEditing({ ...w, id: generateId() })}
                    onDelete={() => { if (confirmDelete(w.name || 'this income item')) deleteWindfall(w.id) }}
                    categoryOptions={allCategoryOptions}
                  />
                ))}
              </div>
            )
          })}
          <TableAddRow onClick={() => setEditing(blank())}>+ Add income</TableAddRow>
        </Table>
      </div>
    </div>
  )
}
