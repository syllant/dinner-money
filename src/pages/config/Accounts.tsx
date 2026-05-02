import { useState, useEffect } from 'react'
import { useAppStore } from '../../store/useAppStore'
import { PageHeader } from '../../components/ui/PageHeader'
import { Banner } from '../../components/ui/Banner'
import { Table, TableHead, TableRow, TableAddRow } from '../../components/ui/Table'
import { Badge } from '../../components/ui/Badge'
import { SortBtn, useSort } from '../../components/ui/SortBtn'
import { fetchAllAccounts, mapLMType, LunchMoneyError } from '../../lib/lunchmoney'
import { formatCurrency } from '../../lib/format'
import { convertToBase, DEFAULT_EUR_USD_RATE } from '../../lib/currency'
import { NumericInput } from '../../components/ui/NumericInput'
import { PlaidConnect } from '../../components/PlaidConnect'
import { fetchPlaidHoldings, fetchPlaidInvestmentData, computeAllocationFromHoldings } from '../../lib/plaid'
import { EditIcon } from '../../components/ui/Icons'
import { CUR_BADGE, curBadgeClass, curSymbol } from '../../components/ui/FrequencyDisplay'
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

// ─── Column layout ─────────────────────────────────────────────────────────────

type SortKey = 'name' | 'balance' | 'currency' | 'type'


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

const COLS = 'grid-cols-[2fr_1fr_1.5fr_1fr_52px]'

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function Accounts() {
  const { lmApiKey, lmProxyUrl, accounts, setAccounts, upsertAccount } = useAppStore()
  const [syncing, setSyncing] = useState(false)
  const [syncError, setSyncError] = useState<string | null>(null)
  const [editing, setEditing] = useState<Account | null>(null)

  useEffect(() => { if (lmApiKey) syncFromLM() }, []) // eslint-disable-line
  const { sort, toggle: handleSort } = useSort<SortKey>('name')
  
  const [filterTypes, setFilterTypesState] = useState<Set<Account['type']>>(() => {
    try {
      const saved = localStorage.getItem('dm_accounts_filter')
      if (saved) return new Set(JSON.parse(saved))
    } catch {}
    return new Set()
  })
  function setFilterTypes(next: Set<Account['type']>) {
    setFilterTypesState(next)
    localStorage.setItem('dm_accounts_filter', JSON.stringify([...next]))
  }

  const [showExcluded, setShowExcludedState] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('dm_accounts_showExcluded')
      if (saved) return JSON.parse(saved)
    } catch {}
    return true
  })
  function setShowExcluded(v: boolean) {
    setShowExcludedState(v)
    localStorage.setItem('dm_accounts_showExcluded', JSON.stringify(v))
  }

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
            balance: (type === 'loan' || type === 'credit') ? -rawBalance : rawBalance,
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
            balance: (type === 'loan' || type === 'credit') ? -rawBalance : rawBalance,
            currency: a.currency,
            type,
            allocation: { equity: 0, bonds: 0, cash: 100 },
            syncedAt: now,
            isManual: false,
          }
        }),
      ]
      // Use getState() to get fresh accounts at sync time (avoids stale closure on auto-sync)
      const existing = new Map(useAppStore.getState().accounts.map(a => [a.id, a]))
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
          plaidAccessToken: ex.plaidAccessToken,
          plaidItemId: ex.plaidItemId,
          fxSplitEUR: ex.fxSplitEUR,
          fxSplitEURRef: ex.fxSplitEURRef,
          holdings: ex.holdings,
          dividends: ex.dividends,
        }
      })

      // Sync Plaid data for linked accounts
      if (lmProxyUrl) {
        for (const acc of merged) {
          if (acc.plaidAccessToken) {
            try {
              acc.holdings = await fetchPlaidHoldings(lmProxyUrl, acc.plaidAccessToken)
              acc.allocation = computeAllocationFromHoldings(acc.holdings)
            } catch (err) {
              console.error(`[Plaid] Holdings sync failed for ${acc.name}:`, err)
            }
            try {
              const txData = await fetchPlaidInvestmentData(lmProxyUrl, acc.plaidAccessToken)
              acc.dividends = txData.dividends
              if (acc.holdings) {
                acc.holdings = acc.holdings.map(h => ({
                  ...h,
                  purchaseDate: h.ticker ? txData.buyDates[h.ticker] ?? undefined : undefined,
                }))
              }
            } catch (err) {
              console.error(`[Plaid] Investment data sync failed for ${acc.name}:`, err)
            }
          }
        }
      }

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


  async function syncSinglePlaid(accountId: number, accessToken: string) {
    if (!lmProxyUrl) return
    const acc = useAppStore.getState().accounts.find(a => a.id === accountId)
    if (!acc) return
    setSyncing(true)
    try {
      const holdings = await fetchPlaidHoldings(lmProxyUrl, accessToken)
      const allocation = computeAllocationFromHoldings(holdings)
      let dividends = acc.dividends
      let annotatedHoldings = holdings
      try {
        const txData = await fetchPlaidInvestmentData(lmProxyUrl, accessToken)
        dividends = txData.dividends
        annotatedHoldings = holdings.map(h => ({
          ...h,
          purchaseDate: h.ticker ? txData.buyDates[h.ticker] ?? undefined : undefined,
        }))
      } catch (_) {}
      upsertAccount({ ...acc, plaidAccessToken: accessToken, holdings: annotatedHoldings, allocation, dividends })
    } catch (err: any) {
      alert(`Failed to refresh Plaid holdings: ${err.message}`)
    } finally {
      setSyncing(false)
    }
  }

  const filtered = accounts.filter(a => {
    if (filterTypes.size > 0 && !filterTypes.has(a.type)) return false
    if (!showExcluded && a.includedInPlanning === false) return false
    return true
  })
  const sorted = [...filtered].sort((a, b) => {
    let av: string | number, bv: string | number
    if (sort.key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase() }
    else if (sort.key === 'balance') { av = a.balance; bv = b.balance }
    else if (sort.key === 'currency') { av = a.currency.toUpperCase(); bv = b.currency.toUpperCase() }
    else { av = a.type; bv = b.type }
    if (av < bv) return sort.dir === 'asc' ? -1 : 1
    if (av > bv) return sort.dir === 'asc' ? 1 : -1
    return 0
  })

  const syncedAt = accounts[0]?.syncedAt
    ? new Date(accounts[0].syncedAt).toLocaleString()
    : null

  return (
    <div>
      <PageHeader title="Accounts">
        <span className="text-[11px] text-gray-400">
          {syncing ? 'Syncing…' : syncedAt ? `Synced ${syncedAt}` : ''}
        </span>
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

        {/* Filters */}
        {accounts.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap gap-1.5">
              {(['investment', 'retirement', 'cash', 'loan', 'credit', 'real_estate', 'other'] as const).map(t => {
                const count = accounts.filter(a => a.type === t).length
                if (count === 0) return null
                const active = filterTypes.has(t)
                return (
                  <button
                    key={t}
                    onClick={() => {
                      const next = new Set(filterTypes)
                      if (next.has(t)) next.delete(t)
                      else next.add(t)
                      setFilterTypes(next)
                    }}
                    className={`text-[11px] px-2.5 py-[3px] rounded-full border transition-colors ${
                      active
                        ? 'bg-gray-900 dark:bg-white text-white dark:text-gray-900 border-gray-900 dark:border-white font-medium'
                        : 'border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:border-gray-400 dark:hover:border-gray-500'
                    }`}
                  >
                    {TYPE_META[t].label} <span className="opacity-50">{count}</span>
                  </button>
                )
              })}
            </div>
            
            <label className="flex items-center gap-1.5 text-[11.5px] text-gray-600 dark:text-gray-400 cursor-pointer">
              <input 
                type="checkbox" 
                checked={showExcluded}
                onChange={e => setShowExcluded(e.target.checked)}
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              Show excluded
            </label>
          </div>
        )}

        <Table>
          <TableHead>
            <div className={`grid ${COLS} gap-2 items-center`}>
              <SortBtn col="name" label="Account" sort={sort} onToggle={handleSort} />
              <SortBtn col="balance" label="Balance" sort={sort} onToggle={handleSort} />
              <span>Characteristics</span>
              <SortBtn col="type" label="Type" sort={sort} onToggle={handleSort} />
              <span></span>
            </div>
          </TableHead>
          {sorted.map(acc => {
            const included = acc.includedInPlanning !== false
            const isEditing = editing?.id === acc.id
            const eAcc = isEditing ? editing : acc
            return (
              <TableRow key={acc.id} dimmed={!included}>
                {/* ── Main row ── */}
                <div className={`grid ${COLS} gap-2 items-center`}>
                  {/* Account name */}
                  <span className="font-medium truncate flex items-center gap-1.5 min-w-0">
                    <span className="truncate">{acc.name}</span>
                    {acc.plaidAccessToken && (
                      <span className="shrink-0 inline-flex items-center gap-0.5 text-[9.5px] font-medium px-1 py-0.5 rounded bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400">
                        Plaid
                      </span>
                    )}
                  </span>

                  {/* Balance */}
                  <div className="flex items-center justify-end gap-1">
                    <span className={`font-medium tabular-nums ${acc.balance >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-500'}`}>
                      {acc.balance >= 0 ? '+' : '−'}{Math.abs(acc.balance).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                    </span>
                    <span className={`${CUR_BADGE} ${curBadgeClass(acc.currency)}`}>{curSymbol(acc.currency)}</span>
                  </div>

                  {/* Characteristics (view only in main row) */}
                  <CharacteristicsView acc={acc} />

                  {/* Type */}
                  <span>
                    <Badge variant={TYPE_META[acc.type].variant}>
                      {TYPE_META[acc.type].label}
                      {acc.typeOverridden && <span className="ml-1 opacity-60">✎</span>}
                    </Badge>
                  </span>

                  {/* Edit / Done */}
                  <div className="flex justify-end">
                    <button
                      className="text-[11px] cursor-pointer transition-colors text-gray-400 hover:text-blue-500"
                      onClick={() => setEditing(acc)}
                    >
                      <EditIcon />
                    </button>
                  </div>
                </div>

                {/* ── Edit panel (expands below row) ── */}
                {isEditing && (
                  <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-700/60 space-y-4">
                    {/* Top row: Inclusion, Type, Characteristics */}
                    <div className="flex items-center gap-4 flex-wrap">
                      <label className="flex items-center gap-2 cursor-pointer text-[12px] font-medium text-gray-700 dark:text-gray-300">
                        <input type="checkbox" checked={eAcc.includedInPlanning !== false} onChange={e => setEditing({ ...eAcc, includedInPlanning: e.target.checked })} className="rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                        Include in planning & cash flow
                      </label>
                      
                      <div className="h-4 w-px bg-gray-200 dark:bg-gray-700 shrink-0" />
                      
                      <div className="flex items-center gap-1.5 text-[11px]">
                        <span className="text-gray-500">Type</span>
                        <select
                          className="h-[26px] text-[11px] border border-gray-300 dark:border-gray-600 rounded px-1.5 bg-white dark:bg-gray-800"
                          value={eAcc.type}
                          onChange={e => setEditing({ ...eAcc, type: e.target.value as Account['type'], typeOverridden: true })}
                        >
                          <option value="investment">Investment</option>
                          <option value="retirement">Retirement</option>
                          <option value="cash">Cash</option>
                          <option value="real_estate">Real estate</option>
                          <option value="loan">Loan / Mortgage</option>
                          <option value="credit">Credit card</option>
                          <option value="other">Other</option>
                        </select>
                      </div>

                      {eAcc.type !== 'other' && eAcc.type !== 'real_estate' && eAcc.type !== 'investment' && eAcc.type !== 'retirement' && (
                        <>
                          <div className="h-4 w-px bg-gray-200 dark:bg-gray-700 shrink-0" />
                          <CharacteristicsEdit acc={eAcc} onUpdate={patch => setEditing({ ...eAcc, ...patch })} />
                        </>
                      )}
                    </div>

                    {/* Advanced configuration for Investment / Retirement */}
                    {(eAcc.type === 'investment' || eAcc.type === 'retirement') && (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {/* Allocations */}
                        <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 bg-gray-50/50 dark:bg-gray-800/40">
                          <div className="text-[10px] font-medium text-gray-400 dark:text-gray-500 uppercase tracking-[0.05em] mb-2 flex justify-between items-center">
                            <span>Allocations</span>
                          </div>
                          
                          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px]">
                            {!eAcc.plaidAccessToken ? (
                              <>
                                <div className="flex gap-4 items-center">
                                  <label className="flex items-center gap-1.5">
                                    Equity
                                    <input type="number" min={0} max={100} className="w-12 h-[24px] border border-gray-300 dark:border-gray-600 rounded px-1.5 bg-white dark:bg-gray-800"
                                      value={eAcc.allocation.equity}
                                      onChange={e => setEditing({ ...eAcc, allocation: { ...eAcc.allocation, equity: +e.target.value } })} />
                                    %
                                  </label>
                                  <label className="flex items-center gap-1.5">
                                    Bonds
                                    <input type="number" min={0} max={100} className="w-12 h-[24px] border border-gray-300 dark:border-gray-600 rounded px-1.5 bg-white dark:bg-gray-800"
                                      value={eAcc.allocation.bonds}
                                      onChange={e => setEditing({ ...eAcc, allocation: { ...eAcc.allocation, bonds: +e.target.value } })} />
                                    %
                                  </label>
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className="text-gray-500">or sync automatically with Plaid</span>
                                  <PlaidConnect
                                    accountId={eAcc.id}
                                    isLinked={!!eAcc.plaidAccessToken}
                                    holdingsCount={eAcc.holdings?.length}
                                    onLinked={async (token, itemId) => {
                                      setEditing({ ...eAcc, plaidAccessToken: token, plaidItemId: itemId })
                                    }}
                                    onUnlink={() => setEditing({ ...eAcc, plaidAccessToken: undefined, plaidItemId: undefined, holdings: undefined })}
                                    onRefresh={undefined}
                                  />
                                </div>
                              </>
                            ) : (
                              <>
                                <div className="text-[11px] text-gray-400 dark:text-gray-500 italic">
                                  Auto-computed from Plaid holdings
                                </div>
                                <PlaidConnect
                                  accountId={eAcc.id}
                                  isLinked={!!eAcc.plaidAccessToken}
                                  holdingsCount={eAcc.holdings?.length}
                                  onLinked={async (token, itemId) => {
                                    setEditing({ ...eAcc, plaidAccessToken: token, plaidItemId: itemId })
                                  }}
                                  onUnlink={() => setEditing({ ...eAcc, plaidAccessToken: undefined, plaidItemId: undefined, holdings: undefined })}
                                  onRefresh={eAcc.plaidAccessToken ? () => syncSinglePlaid(eAcc.id, eAcc.plaidAccessToken!) : undefined}
                                />
                              </>
                            )}
                          </div>
                        </div>

                        {/* Multi-currency split */}
                        {eAcc.currency.toUpperCase() !== 'EUR' && (() => {
                          const curUSDHolding = eAcc.holdings?.find(h => h.ticker === 'CUR:USD')
                          const currentRef = curUSDHolding ? curUSDHolding.institutionValue : eAcc.balance
                          const hasChanged = eAcc.fxSplitEUR != null && eAcc.fxSplitEUR > 0
                            && eAcc.fxSplitEURRef != null
                            && Math.abs(currentRef - eAcc.fxSplitEURRef) / Math.max(1, eAcc.fxSplitEURRef) > 0.01
                          return (
                            <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 bg-gray-50/50 dark:bg-gray-800/40 flex flex-col justify-center">
                              <div className="flex items-center gap-2 text-[11px] flex-wrap">
                                <span className="text-gray-700 dark:text-gray-300">EUR portion of USD position:</span>
                                <NumericInput
                                  className="w-24 h-[24px] border border-gray-300 dark:border-gray-600 rounded px-1.5 bg-white dark:bg-gray-800 text-[11px]"
                                  placeholder="0"
                                  value={eAcc.fxSplitEUR ?? null}
                                  onChange={val => setEditing({ ...eAcc, fxSplitEUR: val, fxSplitEURRef: val != null ? currentRef : undefined })}
                                />
                                <span className="text-gray-500 italic">(useful when the provider consolidates all the cash in USD)</span>
                              </div>
                              {hasChanged && (
                                <div className="mt-2 text-amber-600 dark:text-amber-400 text-[10.5px]">
                                  ⚠ CUR:USD position changed ({formatCurrency(eAcc.fxSplitEURRef!, 'USD')} → {formatCurrency(currentRef, 'USD')}) — verify the EUR amount is still accurate
                                </div>
                              )}
                            </div>
                          )
                        })()}
                      </div>
                    )}
                    
                    <div className="flex gap-2 justify-start mt-2">
                      <button className="text-[11.5px] px-3 py-1 border border-gray-300 rounded-[5px] hover:bg-gray-50 dark:hover:bg-gray-800" onClick={() => setEditing(null)}>Cancel</button>
                      <button className="text-[11.5px] px-3 py-1 bg-green-50 border border-green-300 text-green-700 rounded-[5px] hover:bg-green-100" onClick={() => { upsertAccount(editing); setEditing(null) }}>Save</button>
                    </div>
                  </div>
                )}
              </TableRow>
            )
          })}
          <TableAddRow>+ Add manual account</TableAddRow>
        </Table>
      </div>
    </div>
  )
}
