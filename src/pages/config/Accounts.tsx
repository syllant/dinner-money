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

export default function Accounts() {
  const { lmApiKey, lmProxyUrl, accounts, setAccounts, upsertAccount } = useAppStore()
  const [syncing, setSyncing] = useState(false)
  const [syncError, setSyncError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<number | null>(null)

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
            id: a.id,
            lmId: a.id,
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
            id: a.id,
            lmId: a.id,
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
      // Preserve allocation for existing accounts
      const existing = new Map(accounts.map(a => [a.id, a]))
      const merged = mapped.map(a => existing.has(a.id) ? { ...a, allocation: existing.get(a.id)!.allocation, type: existing.get(a.id)!.type } : a)
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

  function updateAllocation(id: number, field: 'equity' | 'bonds' | 'cash', value: number) {
    const acc = accounts.find(a => a.id === id)
    if (!acc) return
    upsertAccount({ ...acc, allocation: { ...acc.allocation, [field]: value } })
  }

  function updateType(id: number, type: Account['type']) {
    const acc = accounts.find(a => a.id === id)
    if (!acc) return
    upsertAccount({ ...acc, type })
  }

  const syncedAt = accounts[0]?.syncedAt
    ? new Date(accounts[0].syncedAt).toLocaleString()
    : null

  return (
    <div>
      <PageHeader title="Accounts">
        <Button variant="success" onClick={syncFromLM} disabled={syncing}>
          {syncing ? 'Syncing…' : 'Sync from LunchMoney'}
        </Button>
      </PageHeader>
      <div className="p-4 space-y-3">
        {syncedAt && (
          <Banner variant="info" className="flex justify-between">
            <span>Last synced {syncedAt} · {accounts.length} accounts</span>
            <button onClick={syncFromLM} className="underline font-medium cursor-pointer">Re-sync</button>
          </Banner>
        )}
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
        {syncError && (
          <Banner variant="warning">⚠ {syncError}</Banner>
        )}

        <Table>
          <TableHead>
            <div className="grid grid-cols-[2fr_1fr_1fr_1.5fr_1fr_60px] gap-2">
              <span>Account</span><span>Balance</span><span>Currency</span>
              <span>Asset allocation</span><span>Type</span><span></span>
            </div>
          </TableHead>
          {accounts.map(acc => (
            <TableRow key={acc.id}>
              <div className="grid grid-cols-[2fr_1fr_1fr_1.5fr_1fr_60px] gap-2 items-center">
                <span className="font-medium truncate">{acc.name}</span>
                <span className={`font-medium ${acc.balance >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                  {acc.balance >= 0 ? '+' : ''}{formatCurrency(acc.balance, acc.currency)}
                </span>
                <span><Badge variant={acc.currency.toUpperCase() === 'EUR' ? 'eur' : 'usd'}>{acc.currency.toUpperCase()}</Badge></span>
                {editingId === acc.id ? (
                  <div className="flex gap-1 text-[11px]">
                    <label>Eq%<input type="number" min={0} max={100} className="w-12 border rounded px-1 ml-1"
                      value={acc.allocation.equity} onChange={e => updateAllocation(acc.id, 'equity', +e.target.value)} /></label>
                    <label>Bd%<input type="number" min={0} max={100} className="w-12 border rounded px-1 ml-1"
                      value={acc.allocation.bonds} onChange={e => updateAllocation(acc.id, 'bonds', +e.target.value)} /></label>
                  </div>
                ) : (
                  <div>
                    <div className="text-[11px] text-gray-500">{acc.allocation.equity}% eq / {acc.allocation.bonds}% bonds / {acc.allocation.cash}% cash</div>
                    <div className="h-[4px] rounded-full bg-gray-100 dark:bg-gray-700 overflow-hidden mt-1">
                      <div className="h-full rounded-full bg-green-500" style={{ width: `${acc.allocation.equity}%` }} />
                    </div>
                  </div>
                )}
                <select
                  className="h-[26px] text-[11px] border border-gray-300 dark:border-gray-600 rounded px-1 bg-white dark:bg-gray-800"
                  value={acc.type}
                  onChange={e => updateType(acc.id, e.target.value as Account['type'])}
                >
                  <option value="investment">Investment</option>
                  <option value="retirement">Retirement</option>
                  <option value="cash">Cash</option>
                  <option value="real_estate">Real estate</option>
                  <option value="loan">Loan / Mortgage</option>
                  <option value="credit">Credit card</option>
                  <option value="other">Other</option>
                </select>
                <button
                  className="text-[11px] text-blue-600 hover:underline cursor-pointer"
                  onClick={() => setEditingId(editingId === acc.id ? null : acc.id)}
                >
                  {editingId === acc.id ? 'Done' : 'Edit'}
                </button>
              </div>
            </TableRow>
          ))}
          <TableAddRow>+ Add manual account</TableAddRow>
        </Table>
      </div>
    </div>
  )
}
