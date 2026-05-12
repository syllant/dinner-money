import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '../../store/useAppStore'
import { PageHeader } from '../../components/ui/PageHeader'
import { Banner } from '../../components/ui/Banner'
import { Table, TableHead, TableRow, TableAddRow } from '../../components/ui/Table'
import { Badge } from '../../components/ui/Badge'
import { InfoTooltip } from '../../components/ui/InfoTooltip'
import { SortBtn, useSort } from '../../components/ui/SortBtn'
import { formatCurrency } from '../../lib/format'
import { PlaidConnect } from '../../components/PlaidConnect'
import { syncPlaidInvestmentAccount } from '../../lib/investmentSync'
import { fetchIbkrFlexXml, parseIbkrFlexAccountIds, syncIbkrFlexAccounts } from '../../lib/ibkrFlex'
import { EditIcon } from '../../components/ui/Icons'
import { CUR_BADGE, curBadgeClass, curSymbol } from '../../components/ui/FrequencyDisplay'
import type { Account, Country } from '../../types'
import type { TaxLot } from '../../types'

// ─── NAV history import ────────────────────────────────────────────────────────

interface NavRow { date: string; value: number }

function tryParseDate(s: string): string | null {
  s = s.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (us) return `${us[3]}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}`
  return null
}

function tryParseNumber(s: string): number | null {
  const n = parseFloat(s.replace(/[$€£,\s]/g, ''))
  return isNaN(n) || !isFinite(n) ? null : n
}

function parseNavCsv(text: string): NavRow[] {
  const rows: NavRow[] = []
  for (const rawLine of text.trim().split(/\r?\n/)) {
    const cells = rawLine.split(/[,\t]/).map(c => c.trim().replace(/^"|"$/g, ''))
    let date: string | null = null
    let value: number | null = null
    for (const cell of cells) {
      if (!date) { date = tryParseDate(cell); continue }
      if (value === null) { value = tryParseNumber(cell); if (value !== null) break }
    }
    if (date && value !== null && value > 0) rows.push({ date, value })
  }
  return rows.sort((a, b) => a.date.localeCompare(b.date))
}

function NavImportModal({ account, onClose }: {
  account: { id: number; name: string; currency: string; navHistory?: NavRow[] }
  onClose: () => void
}) {
  const mergeNavHistory = useAppStore(s => s.mergeNavHistory)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [rows, setRows] = useState<NavRow[]>([])
  const [fileName, setFileName] = useState<string | null>(null)
  const [parseError, setParseError] = useState<string | null>(null)
  const [imported, setImported] = useState(false)

  const existingDates = new Set((account.navHistory ?? []).map(p => p.date))
  const newRows = rows.filter(r => !existingDates.has(r.date))
  const skippedRows = rows.filter(r => existingDates.has(r.date))

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setFileName(file.name)
    setImported(false)
    setParseError(null)
    const reader = new FileReader()
    reader.onload = ev => {
      const text = ev.target?.result as string
      const parsed = parseNavCsv(text)
      if (parsed.length === 0) {
        setParseError('No valid rows found. Each line must have a date and a number.')
        setRows([])
      } else {
        setRows(parsed)
      }
    }
    reader.readAsText(file)
  }

  function handleImport() {
    if (newRows.length === 0) return
    mergeNavHistory(account.id, newRows)
    setImported(true)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onMouseDown={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-lg flex flex-col max-h-[90vh]" onMouseDown={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-gray-200 dark:border-gray-700 shrink-0">
          <div>
            <div className="text-[13px] font-semibold text-gray-900 dark:text-white">Import NAV history</div>
            <div className="text-[11px] text-gray-400 mt-0.5">{account.name}</div>
          </div>
          <button onClick={onClose} className="h-[28px] px-2 rounded-[5px] text-[11px] font-medium text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800">Close</button>
        </div>

        <div className="px-5 py-4 overflow-y-auto flex-1 space-y-4">
          <p className="text-[11.5px] text-gray-500 dark:text-gray-400 leading-relaxed">
            Select a CSV file with a <strong>date</strong> and <strong>total portfolio value</strong> column.
            Dates: <code className="text-[10.5px] bg-gray-100 dark:bg-gray-800 px-1 rounded">YYYY-MM-DD</code> or <code className="text-[10.5px] bg-gray-100 dark:bg-gray-800 px-1 rounded">MM/DD/YYYY</code>.
            Values in <strong>{account.currency.toUpperCase()}</strong>. Headers are skipped automatically.
            Existing IBKR dates are never overwritten.
          </p>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="text-[11.5px] px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            >
              {fileName ? 'Change file…' : 'Choose file…'}
            </button>
            {fileName && <span className="text-[11px] text-gray-500 dark:text-gray-400 truncate">{fileName}</span>}
            <input ref={fileInputRef} type="file" accept=".csv,.txt" className="hidden" onChange={handleFile} />
          </div>

          {parseError && (
            <div className="text-[11.5px] text-amber-600 dark:text-amber-400">{parseError}</div>
          )}

          {rows.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-3 text-[11px]">
                <span className="text-green-600 dark:text-green-400">{newRows.length} new row{newRows.length !== 1 ? 's' : ''}</span>
                {skippedRows.length > 0 && (
                  <span className="text-gray-400">{skippedRows.length} skipped (date already exists)</span>
                )}
              </div>
              <div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
                <div className="flex text-[9.5px] font-medium text-gray-400 uppercase tracking-wider px-3 py-1.5 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
                  <span className="flex-1">Date</span>
                  <span className="text-right">Value ({account.currency.toUpperCase()})</span>
                  <span className="w-16 text-right">Status</span>
                </div>
                <div className="max-h-48 overflow-y-auto divide-y divide-gray-100 dark:divide-gray-800">
                  {rows.map((r, i) => {
                    const isNew = !existingDates.has(r.date)
                    return (
                      <div key={i} className="flex items-center px-3 py-[5px] text-[11px]">
                        <span className="flex-1 font-mono text-gray-700 dark:text-gray-300">{r.date}</span>
                        <span className="font-mono text-gray-700 dark:text-gray-300">
                          {r.value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                        <span className={`w-16 text-right text-[10px] ${isNew ? 'text-green-600 dark:text-green-400' : 'text-gray-400'}`}>
                          {isNew ? 'import' : 'skip'}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          )}

          {imported && (
            <div className="text-[11.5px] text-green-600 dark:text-green-400">
              {newRows.length} rows imported into {account.name}.
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-gray-200 dark:border-gray-700 shrink-0">
          {imported ? (
            <button
              onClick={onClose}
              className="text-[11.5px] px-4 py-1.5 rounded-lg bg-green-600 text-white font-medium hover:bg-green-700 transition-colors"
            >
              Close
            </button>
          ) : (
            <>
              <button onClick={onClose} className="text-[11.5px] px-3 py-1.5 rounded-lg text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors">
                Cancel
              </button>
              <button
                onClick={handleImport}
                disabled={newRows.length === 0}
                className="text-[11.5px] px-4 py-1.5 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Import {newRows.length > 0 ? `${newRows.length} row${newRows.length !== 1 ? 's' : ''}` : ''}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────────

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

type SortKey = 'name' | 'balance' | 'currency' | 'taxCountry' | 'type'
type Provider = 'ibkr-flex' | 'plaid'
type ProviderHealth = 'healthy' | 'unhealthy' | 'syncing'

const COLS = 'grid-cols-[2fr_1fr_1.5fr_92px_1fr_52px]'

function hasSyncedPositions(account: Account): boolean {
  return (account.holdings?.length ?? 0) > 0 || (account.taxLots?.length ?? 0) > 0
}

function hasProviderData(account: Account, provider: Provider): boolean {
  if (provider === 'ibkr-flex') {
    return !!account.ibkrAccountId && (account.taxLots ?? []).some(lot => lot.source === 'ibkr-flex')
  }
  return !!account.plaidAccessToken && (
    (account.taxLots ?? []).some(lot => lot.source === 'plaid') ||
    (!account.ibkrAccountId && hasSyncedPositions(account))
  )
}

function providerHealth(account: Account, provider: Provider, syncing: boolean, message?: string | null): { state: ProviderHealth; tooltip: string } {
  if (syncing) return { state: 'syncing', tooltip: message ?? 'Sync in progress.' }
  const providerName = provider === 'ibkr-flex' ? 'IBKR' : 'Plaid'
  if (hasProviderData(account, provider)) {
    const syncedAt = account.syncedAt ? new Date(account.syncedAt).toLocaleString() : 'unknown'
    return { state: 'healthy', tooltip: `${providerName} synced positions. Last sync: ${syncedAt}.` }
  }
  return { state: 'unhealthy', tooltip: message ?? `${providerName} is linked, but no positions or lots are available.` }
}

function ProviderBadge({ provider, health }: { provider: Provider; health: { state: ProviderHealth; tooltip: string } }) {
  const label = provider === 'ibkr-flex' ? 'IBKR' : 'Plaid'
  const baseClass = provider === 'ibkr-flex'
    ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400'
    : 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
  const dotClass = health.state === 'healthy'
    ? 'bg-green-500'
    : health.state === 'syncing'
      ? 'bg-blue-500 animate-pulse'
      : 'bg-red-500'
  return (
    <span className={`shrink-0 inline-flex items-center gap-1 text-[9.5px] font-medium px-1 py-0.5 rounded ${baseClass}`}>
      {label}
      <span className={`h-1.5 w-1.5 rounded-full ${dotClass}`} />
      <InfoTooltip text={health.tooltip} position="left" />
    </span>
  )
}

function isLikelyIbkrAccount(account: Account): boolean {
  return /\b(ibkr|interactive\s*brokers?)\b/i.test(`${account.name} ${account.institutionName ?? ''}`)
}

type DisplayLot = TaxLot & { isCash?: boolean }

function accountDisplayLots(account: Account): DisplayLot[] {
  const lots: DisplayLot[] = [...(account.taxLots ?? [])]
  const cashRows: DisplayLot[] = (account.holdings ?? [])
    .filter(holding => holding.ticker?.startsWith('CUR:') || holding.securityType.toLowerCase().includes('cash'))
    .map((holding, index) => ({
      id: `cash-${holding.ticker ?? holding.currency}-${index}`,
      ticker: holding.ticker,
      name: holding.name,
      quantity: holding.quantity,
      marketValue: holding.institutionValue,
      costBasis: holding.costBasis,
      currency: holding.currency,
      source: account.ibkrAccountId ? 'ibkr-flex' : 'plaid',
      isCash: true,
    }))
  return [...lots, ...cashRows]
}

function TaxLotsModal({ account, onClose }: { account: Account; onClose: () => void }) {
  const lots = accountDisplayLots(account)
  const totals = lots.reduce((acc, lot) => {
    acc.marketValue += lot.marketValue
    if (lot.costBasis != null) {
      acc.costBasis += lot.costBasis
      acc.hasBasis = true
    }
    return acc
  }, { marketValue: 0, costBasis: 0, hasBasis: false })
  const totalCurrency = lots[0]?.currency ?? account.currency
  const totalGain = totals.hasBasis ? totals.marketValue - totals.costBasis : null
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 px-4 py-8" onMouseDown={onClose}>
      <div className="w-full max-w-4xl max-h-full overflow-hidden rounded-[8px] bg-white dark:bg-gray-900 shadow-2xl border border-gray-200 dark:border-gray-700" onMouseDown={event => event.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-gray-100 dark:border-gray-800">
          <div>
            <div className="text-[13px] font-semibold text-gray-800 dark:text-gray-100">Tax lots — {account.name}</div>
            <div className="text-[10.5px] text-gray-500 dark:text-gray-400">Lot-level data from IBKR when configured; cash positions are shown separately in the same table.</div>
          </div>
          <button type="button" onClick={onClose} className="h-[28px] px-2 rounded-[5px] text-[11px] font-medium text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800">
            Close
          </button>
        </div>
        <div className="p-4 overflow-auto max-h-[calc(100vh-120px)]">
          <table className="w-full text-[11px]">
            <thead className="sticky top-0 bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400">
              <tr>
                <th className="text-left font-medium px-2 py-1.5">Ticker</th>
                <th className="text-left font-medium px-2 py-1.5">Name</th>
                <th className="text-right font-medium px-2 py-1.5">Quantity</th>
                <th className="text-right font-medium px-2 py-1.5">Market value</th>
                <th className="text-right font-medium px-2 py-1.5">Cost basis</th>
                <th className="text-right font-medium px-2 py-1.5">Unrealized gain</th>
                <th className="text-left font-medium px-2 py-1.5">Acquired</th>
              </tr>
            </thead>
            <tbody>
              {lots.map(lot => {
                const gain = lot.costBasis != null ? lot.marketValue - lot.costBasis : null
                return (
                  <tr key={lot.id} className="border-t border-gray-50 dark:border-gray-800">
                    <td className="px-2 py-1.5">{lot.ticker ?? '—'}</td>
                    <td className="px-2 py-1.5 max-w-[260px] truncate">{lot.name}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{lot.quantity.toLocaleString(undefined, { maximumFractionDigits: 4 })}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{formatCurrency(lot.marketValue, lot.currency)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{lot.costBasis != null ? formatCurrency(lot.costBasis, lot.currency) : '—'}</td>
                    <td className={`px-2 py-1.5 text-right tabular-nums ${gain == null ? 'text-gray-400' : gain >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400'}`}>
                      {gain != null ? formatCurrency(gain, lot.currency) : '—'}
                    </td>
                    <td className="px-2 py-1.5 text-gray-500">{lot.isCash ? 'Cash' : lot.acquiredDate ?? '—'}</td>
                  </tr>
                )
              })}
              {lots.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-2 py-8 text-center text-gray-400">No synced tax lots or cash positions for this account.</td>
                </tr>
              )}
            </tbody>
            {lots.length > 0 && (
              <tfoot className="sticky bottom-0 bg-gray-50 dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700">
                <tr>
                  <td className="px-2 py-2 font-semibold" colSpan={3}>Total</td>
                  <td className="px-2 py-2 text-right tabular-nums font-semibold">{formatCurrency(totals.marketValue, totalCurrency)}</td>
                  <td className="px-2 py-2 text-right tabular-nums font-semibold">{totals.hasBasis ? formatCurrency(totals.costBasis, totalCurrency) : '—'}</td>
                  <td className={`px-2 py-2 text-right tabular-nums font-semibold ${totalGain == null ? 'text-gray-400' : totalGain >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400'}`}>
                    {totalGain != null ? formatCurrency(totalGain, totalCurrency) : '—'}
                  </td>
                  <td className="px-2 py-2"></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  )
}

function CharacteristicsView({ acc, onShowLots }: { acc: Account; onShowLots: (account: Account) => void }) {
  const lotCount = acc.taxLots?.length ?? 0
  if (acc.type === 'investment' || acc.type === 'retirement') {
    return (
      <div className="text-[11px] text-gray-500 dark:text-gray-400">
        {lotCount > 0 ? (
          <button type="button" className="text-blue-600 dark:text-blue-400 hover:underline" onClick={() => onShowLots(acc)}>
            {lotCount} synced lot{lotCount === 1 ? '' : 's'}
          </button>
        ) : (
          <span className="text-gray-400">No synced lots</span>
        )}
      </div>
    )
  }
  if (acc.type === 'cash' || acc.type === 'loan') {
    return <div className="text-[11px] text-gray-500 dark:text-gray-400">{acc.interestRate != null ? `${acc.interestRate}% APY` : '—'}</div>
  }
  if (acc.type === 'credit') {
    return <div className="text-[11px] text-gray-500 dark:text-gray-400">{acc.dueDate != null ? `Due day ${acc.dueDate}` : '—'}</div>
  }
  return <div className="text-[11px] text-gray-400">—</div>
}

function CharacteristicsEdit({ acc, onUpdate }: { acc: Account; onUpdate: (patch: Partial<Account>) => void }) {
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

export default function Accounts() {
  const {
    lmApiKey, lmProxyUrl, accounts, setAccounts, upsertAccount,
    ibkrFlexToken, ibkrFlexQueryId,
  } = useAppStore()
  const [navImportAccount, setNavImportAccount] = useState<Account | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [syncAccountId, setSyncAccountId] = useState<number | null>(null)
  const [syncStatus, setSyncStatus] = useState<string | null>(null)
  const [syncStatusAccountId, setSyncStatusAccountId] = useState<number | null>(null)
  const [editing, setEditing] = useState<Account | null>(null)
  const [lotDetailsAccount, setLotDetailsAccount] = useState<Account | null>(null)
  const [showIbkr, setShowIbkr] = useState(false)
  const [ibkrAccountIds, setIbkrAccountIds] = useState<string[]>([])
  const [ibkrIdsLoading, setIbkrIdsLoading] = useState(false)
  const [ibkrIdsError, setIbkrIdsError] = useState<string | null>(null)
  const [syncError, setSyncError] = useState<string | null>(null)
  const { sort, toggle: handleSort } = useSort<SortKey>('name')

  useEffect(() => {
    setShowIbkr(!!editing && (isLikelyIbkrAccount(editing) || !!editing.ibkrAccountId))
  }, [editing?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!editing || !showIbkr || ibkrAccountIds.length > 0 || ibkrIdsLoading) return
    if (!lmProxyUrl || !ibkrFlexToken || !ibkrFlexQueryId) return
    void loadIbkrAccountIds()
  }, [editing?.id, showIbkr, lmProxyUrl, ibkrFlexToken, ibkrFlexQueryId]) // eslint-disable-line react-hooks/exhaustive-deps
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

  function setAccountSyncStatus(accountId: number | null, message: string | null) {
    setSyncStatusAccountId(accountId)
    setSyncStatus(message)
  }

  async function syncSinglePlaid(accountId: number, accessToken: string) {
    if (!lmProxyUrl) return
    const acc = useAppStore.getState().accounts.find(a => a.id === accountId)
    if (!acc) return
    setSyncing(true)
    setSyncAccountId(accountId)
    setAccountSyncStatus(accountId, 'Refreshing Plaid investment holdings...')
    try {
      upsertAccount(await syncPlaidInvestmentAccount({ ...acc, plaidAccessToken: accessToken }, lmProxyUrl))
      setAccountSyncStatus(accountId, `Plaid synced positions for ${acc.name}.`)
    } catch (err: any) {
      setAccountSyncStatus(accountId, `Plaid refresh failed: ${err.message}`)
    } finally {
      setSyncAccountId(null)
      setSyncing(false)
    }
  }

  async function loadIbkrAccountIds() {
    if (!lmProxyUrl || !ibkrFlexToken || !ibkrFlexQueryId) return
    setIbkrIdsLoading(true)
    setIbkrIdsError(null)
    try {
      const xml = await fetchIbkrFlexXml(lmProxyUrl, ibkrFlexToken, ibkrFlexQueryId)
      setIbkrAccountIds(parseIbkrFlexAccountIds(xml))
    } catch (err) {
      setIbkrIdsError(err instanceof Error ? err.message : String(err))
    } finally {
      setIbkrIdsLoading(false)
    }
  }

  async function refreshIbkrFlex(account: Account) {
    if (!lmProxyUrl) { setSyncError('Set the Cloudflare Worker proxy URL in Settings first.'); return }
    if (!ibkrFlexToken || !ibkrFlexQueryId) { setSyncError('Set the IBKR Flex token and Query ID in Settings first.'); return }
    if (!account?.ibkrAccountId?.trim()) { setSyncError('Enter this account’s IBKR account ID first.'); return }
    const accountId = account.id
    setSyncing(true)
    setSyncAccountId(accountId)
    setSyncError(null)
    setAccountSyncStatus(accountId, 'Refreshing IBKR tax lots...')
    try {
      const currentAccounts = useAppStore.getState().accounts
      const withDraft = currentAccounts.some(item => item.id === account.id)
        ? currentAccounts.map(item => item.id === account.id ? account : item)
        : [...currentAccounts, account]
      const next = await syncIbkrFlexAccounts(withDraft, lmProxyUrl, ibkrFlexToken, ibkrFlexQueryId)
      setAccounts(next)
      const updated = next.find(item => item.id === accountId)
      if (updated) setEditing(updated)
      const lotCount = updated?.taxLots?.filter(lot => lot.source === 'ibkr-flex').length ?? 0
      setAccountSyncStatus(accountId, `IBKR synced ${lotCount} lot${lotCount === 1 ? '' : 's'} for ${account.name}.`)
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      setAccountSyncStatus(accountId, `IBKR refresh failed: ${detail}`)
    } finally {
      setSyncAccountId(null)
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
    else if (sort.key === 'taxCountry') { av = a.taxCountry ?? ''; bv = b.taxCountry ?? '' }
    else { av = a.type; bv = b.type }
    if (av < bv) return sort.dir === 'asc' ? -1 : 1
    if (av > bv) return sort.dir === 'asc' ? 1 : -1
    return 0
  })

  return (
    <div>
      <PageHeader title="Accounts" />
      <div className="p-4 space-y-3">
        {!lmApiKey && (
          <Banner variant="warning">
            No LunchMoney API key — <a href="#/settings" className="underline font-medium">add one in Settings</a> to sync accounts.
          </Banner>
        )}
        {lmApiKey && !lmProxyUrl && accounts.length === 0 && (
          <Banner variant="info">
            A CORS proxy is required to sync from LunchMoney.{' '}
            <a href="#/settings" className="underline font-medium">Set up a Cloudflare Worker in Settings</a>, then come back here to sync.
          </Banner>
        )}

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
              <input type="checkbox" checked={showExcluded} onChange={e => setShowExcluded(e.target.checked)} className="rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
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
              <SortBtn col="taxCountry" label="Tax domicile" sort={sort} onToggle={handleSort} />
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
                <div className={`grid ${COLS} gap-2 items-center`}>
                  <span className="font-medium truncate flex items-center gap-1.5 min-w-0">
                    <span className="truncate">{acc.name}</span>
                    {acc.ibkrAccountId && (
                      <ProviderBadge provider="ibkr-flex" health={providerHealth(acc, 'ibkr-flex', syncing && syncAccountId === acc.id, syncStatusAccountId === acc.id ? syncStatus : null)} />
                    )}
                    {acc.plaidAccessToken && (
                      <ProviderBadge provider="plaid" health={providerHealth(acc, 'plaid', syncing && syncAccountId === acc.id && !acc.ibkrAccountId, syncStatusAccountId === acc.id ? syncStatus : null)} />
                    )}
                  </span>
                  <div className="flex items-center justify-end gap-1">
                    <span className={`font-medium tabular-nums ${acc.balance >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-500'}`}>
                      {acc.balance >= 0 ? '+' : '−'}{Math.abs(acc.balance).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                    </span>
                    <span className={`${CUR_BADGE} ${curBadgeClass(acc.currency)}`}>{curSymbol(acc.currency)}</span>
                  </div>
                  <CharacteristicsView acc={acc} onShowLots={setLotDetailsAccount} />
                  <span>
                    {acc.taxCountry ? (
                      <Badge variant={acc.taxCountry === 'FR' ? 'fr' : 'us'}>{acc.taxCountry === 'FR' ? 'France' : 'US'}</Badge>
                    ) : (
                      <span className="text-[11px] text-gray-400">Unset</span>
                    )}
                  </span>
                  <span>
                    <Badge variant={TYPE_META[acc.type].variant}>
                      {TYPE_META[acc.type].label}
                      {acc.typeOverridden && <span className="ml-1 opacity-60">✎</span>}
                    </Badge>
                  </span>
                  <div className="flex justify-end items-center gap-1.5">
                    {(acc.type === 'investment' || acc.type === 'retirement') && acc.navHistory && acc.navHistory.length > 0 && (
                      <span className="text-[9.5px] text-gray-400 tabular-nums whitespace-nowrap">
                        {'from ' + acc.navHistory.reduce((min, r) => r.date < min ? r.date : min, acc.navHistory[0].date).slice(0, 7)}
                      </span>
                    )}
                    <button className="text-[11px] cursor-pointer transition-colors text-gray-400 hover:text-blue-500" onClick={() => setEditing(acc)}>
                      <EditIcon />
                    </button>
                  </div>
                </div>

                {isEditing && (
                  <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-700/60 space-y-4">
                    <div className="flex items-center gap-4 flex-wrap">
                      <div className="flex items-center gap-1.5 text-[11px]">
                        <span className="text-gray-500">Type</span>
                        <select className="h-[26px] text-[11px] border border-gray-300 dark:border-gray-600 rounded px-1.5 bg-white dark:bg-gray-800" value={eAcc.type} onChange={e => setEditing({ ...eAcc, type: e.target.value as Account['type'], typeOverridden: true })}>
                          <option value="investment">Investment</option>
                          <option value="retirement">Retirement</option>
                          <option value="cash">Cash</option>
                          <option value="real_estate">Real estate</option>
                          <option value="loan">Loan / Mortgage</option>
                          <option value="credit">Credit card</option>
                          <option value="other">Other</option>
                        </select>
                      </div>
                      <div className="h-4 w-px bg-gray-200 dark:bg-gray-700 shrink-0" />
                      <div className="flex items-center gap-1.5 text-[11px]">
                        <span className="text-gray-500">Tax domicile</span>
                        <select className="h-[26px] text-[11px] border border-gray-300 dark:border-gray-600 rounded px-1.5 bg-white dark:bg-gray-800" value={eAcc.taxCountry ?? ''} onChange={e => setEditing({ ...eAcc, taxCountry: e.target.value ? e.target.value as Country : undefined })}>
                          <option value="">Unset</option>
                          <option value="US">US</option>
                          <option value="FR">France</option>
                        </select>
                      </div>
                      {eAcc.type !== 'other' && eAcc.type !== 'real_estate' && eAcc.type !== 'investment' && eAcc.type !== 'retirement' && (
                        <>
                          <div className="h-4 w-px bg-gray-200 dark:bg-gray-700 shrink-0" />
                          <CharacteristicsEdit acc={eAcc} onUpdate={patch => setEditing({ ...eAcc, ...patch })} />
                        </>
                      )}
                      <label className="ml-auto flex items-center gap-1.5 cursor-pointer text-[11px] text-gray-500 dark:text-gray-400">
                        <input
                          type="checkbox"
                          checked={eAcc.includedInPlanning === false}
                          onChange={e => setEditing({ ...eAcc, includedInPlanning: e.target.checked ? false : undefined })}
                          className="rounded border-gray-300 focus:ring-gray-400"
                        />
                        Ignore
                      </label>
                    </div>

                    {(eAcc.type === 'investment' || eAcc.type === 'retirement') && (() => {
                      const ibkrLinked = !!eAcc.ibkrAccountId?.trim()
                      const plaidLinked = !!eAcc.plaidAccessToken
                      const assignedIbkrIds = new Set(
                        accounts
                          .filter(account => account.id !== eAcc.id)
                          .map(account => account.ibkrAccountId?.trim().toUpperCase())
                          .filter(Boolean) as string[]
                      )
                      const likelyIbkr = isLikelyIbkrAccount(eAcc)
                      const ibkrConfigured = !!(lmProxyUrl && ibkrFlexToken && ibkrFlexQueryId)
                      const selectedIbkrMissingFromQuery = !!eAcc.ibkrAccountId && ibkrAccountIds.length > 0 && !ibkrAccountIds.includes(eAcc.ibkrAccountId)
                      const selectIbkrAccount = (accountId: string) => {
                        if (assignedIbkrIds.has(accountId)) return
                        const updated = { ...eAcc, ibkrAccountId: accountId || undefined }
                        setEditing(updated)
                        if (accountId && ibkrConfigured) void refreshIbkrFlex(updated)
                      }
                      const plaidOnLinked = async (token: string, itemId: string) => {
                        const updated = { ...eAcc, plaidAccessToken: token, plaidItemId: itemId }
                        setEditing(updated)
                        if (lmProxyUrl) {
                          setAccountSyncStatus(eAcc.id, 'Syncing Plaid holdings...')
                          setSyncing(true)
                          setSyncAccountId(eAcc.id)
                          try {
                            const synced = await syncPlaidInvestmentAccount(updated, lmProxyUrl)
                            setEditing(synced)
                            upsertAccount(synced)
                          } catch {
                            upsertAccount(updated)
                          } finally {
                            setSyncAccountId(null)
                            setSyncing(false)
                            setAccountSyncStatus(eAcc.id, null)
                          }
                        } else {
                          upsertAccount(updated)
                        }
                      }
                      const plaidOnUnlink = () => setEditing({
                        ...eAcc,
                        plaidAccessToken: undefined,
                        plaidItemId: undefined,
                        holdings: ibkrLinked ? eAcc.holdings : undefined,
                        taxLots: ibkrLinked ? eAcc.taxLots : undefined,
                      })

                      return (
                        <div className="space-y-2.5">
                          {syncStatus && syncStatusAccountId === eAcc.id && (
                            <div className="rounded-[6px] border border-blue-200 dark:border-blue-900 bg-blue-50 dark:bg-blue-950/30 px-2.5 py-1.5 text-[11px] text-blue-800 dark:text-blue-200">
                              {syncStatus}
                            </div>
                          )}

                          <div className="rounded-lg border border-gray-200 dark:border-gray-700 px-2.5 py-2 bg-gray-50/50 dark:bg-gray-800/40 text-[11px]">
                            <div className="flex items-center gap-2 flex-wrap">
                              <PlaidConnect
                                accountId={eAcc.id}
                                isLinked={plaidLinked}
                                holdingsCount={eAcc.holdings?.length}
                                onLinked={plaidOnLinked}
                                onUnlink={plaidOnUnlink}
                                onRefresh={plaidLinked ? () => syncSinglePlaid(eAcc.id, eAcc.plaidAccessToken!) : undefined}
                              />
                              {!showIbkr && (
                                <button type="button" onClick={() => setShowIbkr(true)} className="text-[10.5px] px-2 py-0.5 rounded border border-blue-300 dark:border-blue-700 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20">
                                  Use IBKR
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => setNavImportAccount(eAcc)}
                                className="ml-auto text-[10.5px] px-2 py-0.5 rounded border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-500 dark:text-gray-400 transition-colors"
                              >
                                Import past history…
                              </button>
                            </div>
                          </div>

                          {showIbkr && (
                            <div className="rounded-lg border border-gray-200 dark:border-gray-700 px-2.5 py-2 bg-gray-50/50 dark:bg-gray-800/40 text-[11px] space-y-2">
                              <div className="flex items-center gap-2 flex-wrap">
                                {ibkrLinked ? (
                                  <ProviderBadge provider="ibkr-flex" health={providerHealth(eAcc, 'ibkr-flex', syncing && syncAccountId === eAcc.id, syncStatusAccountId === eAcc.id ? syncStatus : null)} />
                                ) : (
                                  <span className="shrink-0 inline-flex items-center gap-1 text-[9.5px] font-medium px-1 py-0.5 rounded bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400">
                                    IBKR
                                    <InfoTooltip text={likelyIbkr ? 'This account name looks like Interactive Brokers.' : 'Use this only for Interactive Brokers accounts.'} position="left" />
                                  </span>
                                )}
                                {ibkrConfigured ? (
                                  <span className="text-gray-500 dark:text-gray-400">Token and Query ID are configured in <a href="#/settings" className="underline">Settings</a>.</span>
                                ) : (
                                  <span className="text-amber-600 dark:text-amber-400">Set the IBKR token and Query ID in <a href="#/settings" className="underline font-medium">Settings</a>.</span>
                                )}
                                {ibkrConfigured && (
                                  <button type="button" onClick={loadIbkrAccountIds} disabled={ibkrIdsLoading} className="ml-auto px-2 py-0.5 rounded border border-gray-300 dark:border-gray-600 hover:bg-white dark:hover:bg-gray-800 disabled:opacity-50">
                                    {ibkrIdsLoading ? 'Finding IDs…' : 'Find IDs'}
                                  </button>
                                )}
                              </div>

                              <div className="flex items-center gap-2 flex-wrap">
                                <label className="flex items-center gap-1.5">
                                  <span className="text-gray-500 dark:text-gray-400">Account ID</span>
                                  {ibkrAccountIds.length > 0 ? (
                                    <select
                                      className="h-[24px] min-w-32 border border-gray-300 dark:border-gray-600 rounded px-1.5 bg-white dark:bg-gray-800 text-[11px]"
                                      value={eAcc.ibkrAccountId ?? ''}
                                      onChange={event => selectIbkrAccount(event.target.value)}
                                    >
                                      <option value="">Choose account</option>
                                      {ibkrAccountIds.map(accountId => (
                                        <option key={accountId} value={accountId} disabled={assignedIbkrIds.has(accountId)}>
                                          {accountId}{assignedIbkrIds.has(accountId) ? ' — already assigned' : ''}
                                        </option>
                                      ))}
                                    </select>
                                  ) : (
                                    <input
                                      type="text"
                                      className="h-[24px] w-28 border border-gray-300 dark:border-gray-600 rounded px-1.5 bg-white dark:bg-gray-800 text-[11px]"
                                      value={eAcc.ibkrAccountId ?? ''}
                                      onChange={event => setEditing({ ...eAcc, ibkrAccountId: event.target.value.trim().toUpperCase() || undefined })}
                                      placeholder="U1234567"
                                    />
                                  )}
                                </label>
                                <button type="button" onClick={() => refreshIbkrFlex(eAcc)} disabled={syncing || !ibkrConfigured || !eAcc.ibkrAccountId?.trim()} className="px-2 py-0.5 rounded border border-gray-300 dark:border-gray-600 hover:bg-white dark:hover:bg-gray-800 disabled:opacity-50">Refresh</button>
                                {ibkrLinked && (
                                  <button type="button" onClick={() => setEditing({ ...eAcc, ibkrAccountId: undefined, holdings: plaidLinked ? eAcc.holdings : undefined, taxLots: plaidLinked ? eAcc.taxLots?.filter(lot => lot.source === 'plaid') : undefined })} className="px-2 py-0.5 rounded border border-gray-300 dark:border-gray-600 hover:bg-white dark:hover:bg-gray-800">Unlink</button>
                                )}
                                {!likelyIbkr && !ibkrLinked && (
                                  <button type="button" onClick={() => setShowIbkr(false)} className="ml-auto text-[10.5px] text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300">Hide IBKR</button>
                                )}
                              </div>

                              {ibkrIdsError && (
                                <div className="text-[10.5px] text-red-500 dark:text-red-400">{ibkrIdsError}</div>
                              )}
                              {syncError && (
                                <div className="text-[10.5px] text-red-500 dark:text-red-400">{syncError}</div>
                              )}
                              {ibkrConfigured && !ibkrIdsLoading && ibkrAccountIds.length === 0 && !ibkrIdsError && (
                                <div className="text-[10.5px] text-gray-500 dark:text-gray-400">No account IDs found yet. Use Find IDs after the Flex query is configured for open positions.</div>
                              )}
                              {selectedIbkrMissingFromQuery && (
                                <div className="text-[10.5px] text-amber-600 dark:text-amber-400">This account ID is not in the Flex query response. Add the account to the Flex query in IBKR, then find IDs again.</div>
                              )}
                            </div>
                          )}

                        </div>
                      )
                    })()}

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
      {lotDetailsAccount && (
        <TaxLotsModal account={lotDetailsAccount} onClose={() => setLotDetailsAccount(null)} />
      )}
      {navImportAccount && (
        <NavImportModal account={navImportAccount} onClose={() => setNavImportAccount(null)} />
      )}
    </div>
  )
}
