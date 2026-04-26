import { useState } from 'react'
import { useAppStore } from '../../store/useAppStore'
import { PageHeader } from '../../components/ui/PageHeader'
import { Button } from '../../components/ui/Button'
import { Banner } from '../../components/ui/Banner'
import { Table, TableHead, TableRow, TableAddRow } from '../../components/ui/Table'
import { Badge } from '../../components/ui/Badge'
import { fetchAllAccounts, mapLMType, LunchMoneyError } from '../../lib/lunchmoney'
import { formatCurrency } from '../../lib/format'
import type { Account } from '../../types'

// ─── Type chip config ──────────────────────────────────────────────────────────

type BadgeVariant = 'eur' | 'usd' | 'fr' | 'us' | 'success' | 'warning' | 'info' | 'purple' | 'neutral'

const TYPE_META: Record<Account['type'], { label: string; variant: BadgeVariant }> = {
  investment:  { label: 'Investment',  variant: 'info' },
  retirement:  { label: 'Retirement',  variant: 'purple' },
  cash:        { label: 'Cash',        variant: 'success' },
  real_estate: { label: 'Real estate', variant: 'warning' },
  loan:        { label: 'Loan',        variant: 'neutral' },
  credit:      { label: 'Credit card', variant: 'neutral' },
  other:       { label: 'Other',       variant: 'neutral' },
}

// ─── Sort button ───────────────────────────────────────────────────────────────

type SortKey = 'name' | 'balance' | 'currency' | 'type'

function SortBtn({ col, label, sortKey, sortDir, onClick }: {
  col: SortKey; label: string; sortKey: SortKey | null; sortDir: 'asc' | 'desc'; onClick: () => void
}) {
  const active = sortKey === col
  return (
    <button
      className="flex items-center gap-0.5 cursor-pointer hover:text-gray-700 dark:hover:text-gray-200 transition-colors text-left"
      onClick={onClick}
    >
      {label}
      <span className={`text-[9px] ${active ? 'text-blue-500' : 'text-gray-300 dark:text-gray-600'}`}>
        {active ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}
      </span>
    </button>
  )
}

// ─── Characteristics view / edit ───────────────────────────────────────────────

function CharacteristicsView({ acc }: { acc: Account }) {
  if (acc.type === 'investment' || acc.type === 'retirement') {
    return (
      <div>
        <div className="text-[11px] text-gray-500 dark:text-gray-400">
          {acc.allocation.equity}% eq / {acc.allocation.bonds}% bd / {acc.allocation.cash}% cash
        </div>
        <div className="h-[4px] rounded-full bg-gray-100 dark:bg-gray-700 overflow-hidden mt-1">
          <div className="h-full rounded-full bg-green-500" style={{ width: `${acc.allocation.equity}%` }} />
        </div>
      </div>
    )
  }
  if (acc.type === 'cash' || acc.type === 'loan') {
    return (
      <div className="text-[11px] text-gray-500 dark:text-gray-400">
        {acc.interestRate != null ? `${acc.interestRate}% APY` : '—'}
      </div>
    )
  }
  if (acc.type === 'credit') {
    return (
      <div className="text-[11px] text-gray-500 dark:text-gray-400">
        {acc.dueDate != null ? `Due day ${acc.dueDate}` : '—'}
      </div>
    )
  }
  return <div className="text-[11px] text-gray-400">—</div>
}

function CharacteristicsEdit({ acc, onUpdate }: {
  acc: Account
  onUpdate: (patch: Partial<Account>) => void
}) {
  if (acc.type === 'investment' || acc.type === 'retirement') {
    return (
      <div className="flex gap-1 text-[11px]">
        <label className="flex items-center gap-1">
          Eq%
          <input type="number" min={0} max={100} className="w-12 border border-gray-300 dark:border-gray-600 rounded px-1 bg-white dark:bg-gray-800"
            value={acc.allocation.equity}
            onChange={e => onUpdate({ allocation: { ...acc.allocation, equity: +e.target.value } })} />
        </label>
        <label className="flex items-center gap-1">
          Bd%
          <input type="number" min={0} max={100} className="w-12 border border-gray-300 dark:border-gray-600 rounded px-1 bg-white dark:bg-gray-800"
            value={acc.allocation.bonds}
            onChange={e => onUpdate({ allocation: { ...acc.allocation, bonds: +e.target.value } })} />
        </label>
      </div>
    )
  }
  if (acc.type === 'cash' || acc.type === 'loan') {
    return (
      <label className="flex items-center gap-1 text-[11px]">
        Rate%
        <input type="number" min={0} step={0.1} className="w-16 border border-gray-300 dark:border-gray-600 rounded px-1 bg-white dark:bg-gray-800"
          value={acc.interestRate ?? ''}
          onChange={e => onUpdate({ interestRate: e.target.value === '' ? undefined : +e.target.value })} />
      </label>
    )
  }
  if (acc.type === 'credit') {
    return (
      <label className="flex items-center gap-1 text-[11px]">
        Due day
        <input type="number" min={1} max={31} className="w-14 border border-gray-300 dark:border-gray-600 rounded px-1 bg-white dark:bg-gray-800"
          value={acc.dueDate ?? ''}
          onChange={e => onUpdate({ dueDate: e.target.value === '' ? undefined : +e.target.value })} />
      </label>
    )
  }
  return null
}

// ─── Column layout ─────────────────────────────────────────────────────────────

const COLS = 'grid-cols-[2fr_1fr_1fr_1.5fr_1fr_60px_44px]'

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function Accounts() {
  const { lmApiKey, lmProxyUrl, accounts, setAccounts, upsertAccount } = useAppStore()
  const [syncing, setSyncing] = useState(false)
  const [syncError, setSyncError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [sortKey, setSortKey] = useState<SortKey | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  async function syncFromLM() {
    if (!lmApiKey) { setSyncError('No API key — configure it in Settings'); return }
    setSyncing(true)
    setSyncError(null)
    try {
      const { manual, synced } = await fetchAllAccounts(lmApiKey, lmProxyUrl)
      const now = new Date().toISOString()
      const mapped: Account[] = [
        ...manual.filter(a => !a.closed_on).map(a => {
          const type = mapLMType(a.type_name)
          const rawBalance = parseFloat(a.balance)
          return {
            id: a.id, lmId: a.id,
            name: a.display_name ?? a.name,
            balance: type === 'loan' ? -rawBalance : rawBalance,
            currency: a.currency,
            type,
            allocation: { equity: 0, bonds: 0, cash: 100 },
            syncedAt: now,
            isManual: true,
          }
        }),
        ...synced.map(a => {
          const type = mapLMType(a.subtype || a.type)
          const rawBalance = parseFloat(a.balance)
          return {
            id: a.id, lmId: a.id,
            name: a.display_name ?? a.name,
            balance: type === 'loan' ? -rawBalance : rawBalance,
            currency: a.currency,
            type,
            allocation: { equity: 0, bonds: 0, cash: 100 },
            syncedAt: now,
            isManual: false,
          }
        }),
      ]
      // Preserve allocation always; preserve type only if user explicitly overrode it
      const existing = new Map(accounts.map(a => [a.id, a]))
      const merged = mapped.map(a => {
        const ex = existing.get(a.id)
        if (!ex) return a
        return {
          ...a,
          allocation: ex.allocation,
          includedInPlanning: ex.includedInPlanning,
          interestRate: ex.interestRate,
          dueDate: ex.dueDate,
          ...(ex.typeOverridden ? { type: ex.type, typeOverridden: true } : {}),
        }
      })
      setAccounts(merged)
    } catch (err) {
      if (err instanceof LunchMoneyError) {
        const is401 = err.status === 401
        setSyncError(
          is401
            ? 'Invalid API key (401). Go to Settings to update your token.'
            : `LunchMoney returned an error (${err.status}). ${lmProxyUrl ? 'Check that the proxy URL is correct in Settings.' : 'A CORS proxy is required — configure one in Settings.'}`
        )
      } else if (err instanceof TypeError && err.message.toLowerCase().includes('fetch')) {
        setSyncError(
          lmProxyUrl
            ? `Could not reach the proxy at ${lmProxyUrl}. Make sure the Cloudflare Worker is deployed and the URL in Settings is correct.`
            : 'Blocked by CORS — LunchMoney only allows requests from its own app. Deploy the Cloudflare Worker proxy and add its URL in Settings.'
        )
      } else {
        const detail = err instanceof Error ? err.message : String(err)
        setSyncError(`Sync failed — ${detail}. Check the browser console for details.`)
      }
    } finally {
      setSyncing(false)
    }
  }

  function handleSort(col: SortKey) {
    if (sortKey === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(col); setSortDir('asc') }
  }

  const sorted = [...accounts].sort((a, b) => {
    if (!sortKey) return 0
    let av: string | number, bv: string | number
    if (sortKey === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase() }
    else if (sortKey === 'balance') { av = a.balance; bv = b.balance }
    else if (sortKey === 'currency') { av = a.currency.toUpperCase(); bv = b.currency.toUpperCase() }
    else { av = a.type; bv = b.type }
    if (av < bv) return sortDir === 'asc' ? -1 : 1
    if (av > bv) return sortDir === 'asc' ? 1 : -1
    return 0
  })

  const syncedAt = accounts[0]?.syncedAt
    ? new Date(accounts[0].syncedAt).toLocaleString()
    : null

  return (
    <div>
      <PageHeader title="Accounts">
        <div className="flex items-center gap-3">
          {syncedAt && <span className="text-[11px] text-gray-400">Synced {syncedAt}</span>}
          <Button variant="success" onClick={syncFromLM} disabled={syncing}>
            {syncing ? 'Syncing…' : 'Sync from LunchMoney'}
          </Button>
        </div>
      </PageHeader>
      <div className="p-4 space-y-3">
        {!lmApiKey && (
          <Banner variant="warning">
            No LunchMoney API key — <a href="#/settings" className="underline font-medium">add one in Settings</a> to sync accounts.
          </Banner>
        )}
        {lmApiKey && !lmProxyUrl && accounts.length === 0 && !syncError && (
          <Banner variant="info">
            A CORS proxy is required to sync from LunchMoney.{' '}
            <a href="#/settings" className="underline font-medium">Set up a Cloudflare Worker in Settings</a>, then come back here to sync.
          </Banner>
        )}
        {syncError && <Banner variant="warning">⚠ {syncError}</Banner>}

        <Table>
          <TableHead>
            <div className={`grid ${COLS} gap-2 items-center`}>
              <SortBtn col="name" label="Account" sortKey={sortKey} sortDir={sortDir} onClick={() => handleSort('name')} />
              <SortBtn col="balance" label="Balance" sortKey={sortKey} sortDir={sortDir} onClick={() => handleSort('balance')} />
              <SortBtn col="currency" label="Currency" sortKey={sortKey} sortDir={sortDir} onClick={() => handleSort('currency')} />
              <span>Characteristics</span>
              <SortBtn col="type" label="Type" sortKey={sortKey} sortDir={sortDir} onClick={() => handleSort('type')} />
              <span></span>
              <span></span>
            </div>
          </TableHead>
          {sorted.map(acc => {
            const included = acc.includedInPlanning !== false
            return (
              <TableRow key={acc.id} dimmed={!included}>
                <div className={`grid ${COLS} gap-2 items-center`}>
                  {/* Account name */}
                  <span className="font-medium truncate">{acc.name}</span>

                  {/* Balance */}
                  <span className={`font-medium ${acc.balance >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                    {acc.balance >= 0 ? '+' : ''}{formatCurrency(acc.balance, acc.currency)}
                  </span>

                  {/* Currency chip */}
                  <span>
                    <Badge variant={acc.currency.toUpperCase() === 'EUR' ? 'eur' : 'usd'}>
                      {acc.currency.toUpperCase()}
                    </Badge>
                  </span>

                  {/* Characteristics */}
                  {editingId === acc.id ? (
                    <CharacteristicsEdit acc={acc} onUpdate={patch => upsertAccount({ ...acc, ...patch })} />
                  ) : (
                    <CharacteristicsView acc={acc} />
                  )}

                  {/* Type */}
                  {editingId === acc.id ? (
                    <select
                      className="h-[26px] text-[11px] border border-gray-300 dark:border-gray-600 rounded px-1 bg-white dark:bg-gray-800"
                      value={acc.type}
                      onChange={e => upsertAccount({ ...acc, type: e.target.value as Account['type'], typeOverridden: true })}
                    >
                      <option value="investment">Investment</option>
                      <option value="retirement">Retirement</option>
                      <option value="cash">Cash</option>
                      <option value="real_estate">Real estate</option>
                      <option value="loan">Loan / Mortgage</option>
                      <option value="credit">Credit card</option>
                      <option value="other">Other</option>
                    </select>
                  ) : (
                    <span>
                      <Badge variant={TYPE_META[acc.type].variant}>
                        {TYPE_META[acc.type].label}
                        {acc.typeOverridden && <span className="ml-1 opacity-60">✎</span>}
                      </Badge>
                    </span>
                  )}

                  {/* Edit / Done */}
                  <button
                    className="text-[11px] text-blue-600 hover:underline cursor-pointer"
                    onClick={() => setEditingId(editingId === acc.id ? null : acc.id)}
                  >
                    {editingId === acc.id ? 'Done' : 'Edit'}
                  </button>

                  {/* Include toggle (right) */}
                  <button
                    onClick={() => upsertAccount({ ...acc, includedInPlanning: included ? false : true })}
                    title={included ? 'Included in planning — click to exclude' : 'Excluded — click to include'}
                    className={`relative w-8 h-[17px] rounded-full transition-colors cursor-pointer shrink-0 ${
                      included ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600'
                    }`}
                  >
                    <span className={`absolute top-[2px] w-[13px] h-[13px] bg-white rounded-full shadow transition-all ${
                      included ? 'left-[17px]' : 'left-[2px]'
                    }`} />
                  </button>
                </div>
              </TableRow>
            )
          })}
          <TableAddRow>+ Add manual account</TableAddRow>
        </Table>
      </div>
    </div>
  )
}
