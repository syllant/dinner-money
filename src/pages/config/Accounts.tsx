import { useState, useEffect, useRef } from 'react'
import { useAppStore } from '../../store/useAppStore'
import { PageHeader } from '../../components/ui/PageHeader'
import { Banner } from '../../components/ui/Banner'
import { Button } from '../../components/ui/Button'
import { Table, TableHead, TableRow, TableAddRow } from '../../components/ui/Table'
import { Badge } from '../../components/ui/Badge'
import { InfoTooltip } from '../../components/ui/InfoTooltip'
import { SortBtn, useSort } from '../../components/ui/SortBtn'
import { fetchAllAccounts, mapLMType, LunchMoneyError } from '../../lib/lunchmoney'
import { formatCurrency } from '../../lib/format'
import { NumericInput } from '../../components/ui/NumericInput'
import { PlaidConnect } from '../../components/PlaidConnect'
import { syncPlaidInvestmentAccount } from '../../lib/investmentSync'
import { createSnapTradeLoginLink, fetchSnapTradeAccountsRaw, fetchSnapTradeConnectionDetail, fetchSnapTradeConnections, refreshSnapTradeConnection, registerSnapTradeUser, syncSnapTradeAccounts } from '../../lib/snaptrade'
import { EditIcon } from '../../components/ui/Icons'
import { CUR_BADGE, curBadgeClass, curSymbol } from '../../components/ui/FrequencyDisplay'
import type { Account, Country } from '../../types'

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

type SortKey = 'name' | 'balance' | 'currency' | 'taxCountry' | 'type'
type Provider = 'snaptrade' | 'plaid'
type ProviderHealth = 'healthy' | 'pending' | 'unhealthy' | 'syncing'

function isSnapTradeLinked(account: Account): boolean {
  return !!(account.snapTradeAccountId || account.snapTradeAuthorizationId)
}

function hasSyncedPositions(account: Account): boolean {
  return (account.holdings?.length ?? 0) > 0 || (account.taxLots?.length ?? 0) > 0
}

function hasProviderData(account: Account, provider: Provider): boolean {
  if (provider === 'snaptrade') {
    return !!account.snapTradeAccountId && (
      (account.holdings?.length ?? 0) > 0 ||
      (account.taxLots ?? []).some(lot => lot.source === 'snaptrade')
    )
  }
  return !!account.plaidAccessToken && (
    (account.taxLots ?? []).some(lot => lot.source === 'plaid') ||
    (!account.snapTradeAccountId && hasSyncedPositions(account))
  )
}

function snapTradeCallbackParams(): URLSearchParams {
  const hashQuery = window.location.hash.includes('?') ? window.location.hash.split('?').slice(1).join('?') : ''
  const search = window.location.search.startsWith('?') ? window.location.search.slice(1) : window.location.search
  return new URLSearchParams([search, hashQuery].filter(Boolean).join('&'))
}

function TaxLotsModal({ account, onClose }: { account: Account; onClose: () => void }) {
  const lots = account.taxLots ?? []
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
            <div className="text-[10.5px] text-gray-500 dark:text-gray-400">Best-effort lots derived from synced holding cost basis and investment transactions.</div>
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
                    <td className="px-2 py-1.5 text-gray-500">{lot.acquiredDate ?? '—'}</td>
                  </tr>
                )
              })}
              {lots.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-2 py-8 text-center text-gray-400">No synced tax lots for this account.</td>
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
          <button
            type="button"
            className="text-blue-600 dark:text-blue-400 hover:underline"
            onClick={() => onShowLots(acc)}
          >
            {lotCount} synced lot{lotCount === 1 ? '' : 's'}
          </button>
        ) : (
          <span className="text-gray-400">No synced lots</span>
        )}
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

const COLS = 'grid-cols-[2fr_1fr_1.5fr_92px_1fr_52px]'

function providerHealth(account: Account, provider: Provider, syncing: boolean, message?: string | null): { state: ProviderHealth; tooltip: string } {
  if (syncing) return { state: 'syncing', tooltip: message ?? 'Sync in progress.' }
  const providerName = provider === 'snaptrade' ? 'SnapTrade' : 'Plaid'
  if (hasProviderData(account, provider)) {
    const syncedAt = account.syncedAt ? new Date(account.syncedAt).toLocaleString() : 'unknown'
    return { state: 'healthy', tooltip: `${providerName} synced positions. Last sync: ${syncedAt}.` }
  }
  if (provider === 'snaptrade' && account.snapTradeAuthorizationId && !account.snapTradeAccountId) {
    return { state: 'pending', tooltip: message ?? 'SnapTrade authorization is linked, but account data is not available yet.' }
  }
  return { state: 'unhealthy', tooltip: message ?? `${providerName} is linked, but no positions or lots are available.` }
}

function ProviderBadge({ provider, health }: { provider: Provider; health: { state: ProviderHealth; tooltip: string } }) {
  const label = provider === 'snaptrade' ? 'SnapTrade' : 'Plaid'
  const baseClass = provider === 'snaptrade'
    ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400'
    : 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
  const dotClass = health.state === 'healthy'
    ? 'bg-green-500'
    : health.state === 'syncing'
      ? 'bg-blue-500 animate-pulse'
      : health.state === 'pending'
        ? 'bg-amber-500'
        : 'bg-red-500'
  return (
    <span className={`shrink-0 inline-flex items-center gap-1 text-[9.5px] font-medium px-1 py-0.5 rounded ${baseClass}`}>
      {label}
      <span className={`h-1.5 w-1.5 rounded-full ${dotClass}`} />
      <InfoTooltip text={health.tooltip} position="left" />
    </span>
  )
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function Accounts() {
  const {
    lmApiKey, lmProxyUrl, accounts, setAccounts, upsertAccount,
    snapTradeClientId, snapTradeConsumerKey,
    snapTradeUserId, snapTradeUserSecret, setSnapTradeUser,
  } = useAppStore()
  const [syncing, setSyncing] = useState(false)
  const [syncAccountId, setSyncAccountId] = useState<number | null>(null)
  const [syncError, setSyncError] = useState<string | null>(null)
  const [snapTradeStatus, setSnapTradeStatus] = useState<string | null>(null)
  const [snapTradeStatusAccountId, setSnapTradeStatusAccountId] = useState<number | null>(null)
  const [editing, setEditing] = useState<Account | null>(null)
  const [lotDetailsAccount, setLotDetailsAccount] = useState<Account | null>(null)
  const snapTradeAttachRef = useRef<null | { accountId: number; beforeIds: Set<string>; beforeAuthorizationIds: Set<string> }>(null)

  useEffect(() => { if (lmApiKey) syncFromLM(false) }, []) // eslint-disable-line
  useEffect(() => {
    if (!window.location.hash.includes('snaptrade=done')) return
    if (window.opener && !window.opener.closed) {
      const params = snapTradeCallbackParams()
      window.opener.postMessage({
        type: 'dinner-money:snaptrade-done',
        status: params.get('status'),
        connectionId: params.get('connection_id') ?? params.get('authorization_id') ?? params.get('authorizationId') ?? params.get('brokerage_authorization'),
        errorCode: params.get('error_code'),
        statusCode: params.get('status_code'),
        detail: params.get('detail') ?? params.get('error_message'),
      }, window.location.origin)
      window.close()
    }
  }, [])
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return
      if (event.data?.type !== 'dinner-money:snaptrade-done') return
      const pending = snapTradeAttachRef.current
      if (!pending) return
      snapTradeAttachRef.current = null
      if (event.data.status === 'ERROR') {
        const code = event.data.errorCode ?? event.data.statusCode ?? 'unknown error'
        const isPendingFlexStatement = String(code) === '1066'
        setAccountSyncStatus(
          pending.accountId,
          isPendingFlexStatement
            ? 'IBKR Flex statement is still generating; linking the SnapTrade authorization and checking for account data...'
            : `SnapTrade portal returned ${code}; checking connected authorizations...`
        )
        void syncAndAttachSnapTradeAccount(
          pending.accountId,
          pending.beforeIds,
          pending.beforeAuthorizationIds,
          event.data.connectionId ?? undefined,
          `SnapTrade connection failed — ${code}${event.data.detail ? `: ${event.data.detail}` : ''}`,
          isPendingFlexStatement
        )
        return
      }
      if (event.data.status === 'ABANDONED') {
        setAccountSyncStatus(pending.accountId, 'SnapTrade connection was cancelled.')
        return
      }
      void syncAndAttachSnapTradeAccount(pending.accountId, pending.beforeIds, pending.beforeAuthorizationIds, event.data.connectionId ?? undefined)
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [lmProxyUrl, snapTradeClientId, snapTradeConsumerKey])
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

  function setAccountSyncStatus(accountId: number | null, message: string | null) {
    setSnapTradeStatusAccountId(accountId)
    setSnapTradeStatus(message)
  }

  async function syncFromLM(allowSnapTradeConnect = false) {
    if (!lmApiKey) { setSyncError('No API key — configure it in Settings'); return }
    setSyncing(true)
    setSyncAccountId(null)
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
          taxCountry: ex.taxCountry,
          ...(ex.typeOverridden ? { type: ex.type, typeOverridden: true } : {}),
          plaidAccessToken: ex.plaidAccessToken,
          plaidItemId: ex.plaidItemId,
          fxSplitEUR: ex.fxSplitEUR,
          fxSplitEURRef: ex.fxSplitEURRef,
          holdings: ex.holdings,
          dividends: ex.dividends,
          taxLots: ex.taxLots,
          snapTradeAccountId: ex.snapTradeAccountId,
          snapTradeAuthorizationId: ex.snapTradeAuthorizationId,
        }
      })

      // Sync Plaid data for linked accounts
      if (lmProxyUrl) {
        for (const acc of merged) {
          if (acc.plaidAccessToken) {
            try {
              const synced = await syncPlaidInvestmentAccount(acc, lmProxyUrl)
              Object.assign(acc, synced)
            } catch (err) {
              console.error(`[Plaid] Investment sync failed for ${acc.name}:`, err)
            }
          }
        }
      }

      const mappedIds = new Set(merged.map(account => account.id))
      const nonLunchMoneyAccounts = useAppStore.getState().accounts.filter(account => isSnapTradeLinked(account) && !mappedIds.has(account.id))
      let nextAccounts = [...nonLunchMoneyAccounts, ...merged]
      if (lmProxyUrl && snapTradeClientId && snapTradeConsumerKey) {
        if (snapTradeUserId && snapTradeUserSecret) {
          nextAccounts = await syncSnapTradeAccounts(lmProxyUrl, snapTradeUserId, snapTradeUserSecret, nextAccounts, {
            clientId: snapTradeClientId,
            consumerKey: snapTradeConsumerKey,
          })
          const count = nextAccounts.filter(isSnapTradeLinked).length
          if (allowSnapTradeConnect) setAccountSyncStatus(null, `Synced ${count} SnapTrade account${count === 1 ? '' : 's'}.`)
        }
      }
      setAccounts(nextAccounts)
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

  function openSnapTradePortal(url: string, preparedPopup: Window | null, accountId: number, onClosed: () => void) {
    const popup = preparedPopup && !preparedPopup.closed
      ? preparedPopup
      : window.open('', 'snaptrade-connect', 'width=980,height=780')
    if (!popup) {
      throw new Error('The browser blocked the SnapTrade popup. Allow popups for this app and sync again.')
    }
    popup.location.href = url
    popup.focus()
    setAccountSyncStatus(accountId, 'Finish the SnapTrade connection in the popup. Accounts will sync automatically when it closes.')
    let handled = false
    const finish = () => {
      if (handled) return
      handled = true
      setAccountSyncStatus(accountId, 'SnapTrade popup closed. Syncing connected accounts...')
      onClosed()
    }
    const poll = window.setInterval(() => {
      if (!popup.closed) return
      window.clearInterval(poll)
      finish()
    }, 1000)
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

  async function ensureSnapTradeUser(): Promise<{ userId: string; userSecret: string }> {
    if (!lmProxyUrl) throw new Error('Set the Cloudflare Worker proxy URL in Settings first.')
    if (snapTradeUserId && snapTradeUserSecret) return { userId: snapTradeUserId, userSecret: snapTradeUserSecret }
    const user = await registerSnapTradeUser(lmProxyUrl, `dinner-money-${crypto.randomUUID()}`, {
      clientId: snapTradeClientId,
      consumerKey: snapTradeConsumerKey,
    })
    setSnapTradeUser(user.userId, user.userSecret)
    return { userId: user.userId, userSecret: user.userSecret }
  }

  async function connectSnapTradeAccount(accountId: number) {
    if (!lmProxyUrl) { setSyncError('Set the Cloudflare Worker proxy URL in Settings first.'); return }
    if (!snapTradeClientId || !snapTradeConsumerKey) { setSyncError('Set SnapTrade Client ID and Consumer key in Settings first.'); return }
    const popup = window.open('', 'snaptrade-connect', 'width=980,height=780')
    if (!popup) { setSyncError('The browser blocked the SnapTrade popup. Allow popups for this app and try again.'); return }
    const beforeSnapTradeIds = new Set(useAppStore.getState().accounts.map(account => account.snapTradeAccountId).filter(Boolean) as string[])
    snapTradeAttachRef.current = { accountId, beforeIds: beforeSnapTradeIds, beforeAuthorizationIds: new Set() }
    setSyncing(true)
    setSyncAccountId(accountId)
    setSyncError(null)
    setAccountSyncStatus(accountId, null)
    try {
      const user = await ensureSnapTradeUser()
      const beforeAuthorizationIds = await fetchSnapTradeAuthorizationIds(user.userId, user.userSecret)
      snapTradeAttachRef.current = { accountId, beforeIds: beforeSnapTradeIds, beforeAuthorizationIds }
      const redirect = `${window.location.origin}${window.location.pathname}#/config/accounts?snaptrade=done`
      const url = await createSnapTradeLoginLink(lmProxyUrl, user.userId, user.userSecret, redirect, {
        clientId: snapTradeClientId,
        consumerKey: snapTradeConsumerKey,
      })
      if (!url) throw new Error('SnapTrade did not return a connection portal URL.')
      openSnapTradePortal(url, popup, accountId, () => {
        const pending = snapTradeAttachRef.current
        if (!pending) return
        snapTradeAttachRef.current = null
        void syncAndAttachSnapTradeAccount(pending.accountId, pending.beforeIds, pending.beforeAuthorizationIds)
      })
    } catch (err) {
      if (!popup.closed) popup.close()
      const detail = err instanceof Error ? err.message : String(err)
      setSyncError(`SnapTrade connect failed — ${detail}`)
    } finally {
      setSyncAccountId(null)
      setSyncing(false)
    }
  }

  async function refreshSnapTradeAccount(accountId: number) {
    setSyncing(true)
    setSyncAccountId(accountId)
    setSyncError(null)
    setAccountSyncStatus(accountId, null)
    try {
      const { snapTradeUserId: userId, snapTradeUserSecret: userSecret } = useAppStore.getState()
      if (lmProxyUrl && userId && userSecret) {
        const account = useAppStore.getState().accounts.find(item => item.id === accountId)
        const authorizationId = account?.snapTradeAuthorizationId?.startsWith('pending-')
          ? await findLatestSnapTradeAuthorizationId(userId, userSecret)
          : account?.snapTradeAuthorizationId
        if (authorizationId) {
          setAccountSyncStatus(accountId, 'Requesting a SnapTrade holdings refresh for this connection...')
          await refreshSnapTradeConnection(lmProxyUrl, userId, userSecret, authorizationId, {
            clientId: snapTradeClientId,
            consumerKey: snapTradeConsumerKey,
          }).catch(err => {
            console.warn('[SnapTrade] Holdings refresh request failed:', err)
          })
        }
      }
      await syncAndAttachSnapTradeAccount(accountId, new Set(), new Set())
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      setSyncError(`SnapTrade refresh failed — ${detail}`)
    } finally {
      setSyncAccountId(null)
      setSyncing(false)
    }
  }

  async function diagnoseSnapTradeAccount(accountId: number) {
    const { snapTradeUserId: userId, snapTradeUserSecret: userSecret } = useAppStore.getState()
    if (!lmProxyUrl || !userId || !userSecret) {
      setSyncError('SnapTrade diagnostic failed — missing proxy URL or SnapTrade user credentials.')
      return
    }
    setSyncing(true)
    setSyncAccountId(accountId)
    setSyncError(null)
    setAccountSyncStatus(accountId, 'Checking raw SnapTrade account and authorization state...')
    try {
      const auth = { clientId: snapTradeClientId, consumerKey: snapTradeConsumerKey }
      const account = useAppStore.getState().accounts.find(item => item.id === accountId)
      const [accountsRaw, connections] = await Promise.all([
        fetchSnapTradeAccountsRaw(lmProxyUrl, userId, userSecret, auth),
        fetchSnapTradeConnections(lmProxyUrl, userId, userSecret, auth),
      ])
      const requestedAuthorizationId = account?.snapTradeAuthorizationId?.startsWith('pending-')
        ? undefined
        : account?.snapTradeAuthorizationId
      const latestConnection = [...connections]
        .filter(connection => connection.id && !connection.disabled)
        .sort((a, b) => snapTradeConnectionTime(b) - snapTradeConnectionTime(a))[0]
      const detailId = requestedAuthorizationId ?? (latestConnection?.id ? String(latestConnection.id) : undefined)
      const connectionDetail = detailId
        ? await fetchSnapTradeConnectionDetail(lmProxyUrl, userId, userSecret, detailId, auth).catch(error => ({ error: error instanceof Error ? error.message : String(error) }))
        : null
      const activeConnections = connections.filter(connection => !connection.disabled)
      console.info('[SnapTrade diagnostic]', {
        account: account ? { id: account.id, name: account.name, snapTradeAccountId: account.snapTradeAccountId, snapTradeAuthorizationId: account.snapTradeAuthorizationId } : null,
        accountsRaw,
        connections,
        connectionDetail,
      })
      const latestBrokerage = latestConnection?.brokerage?.display_name ?? latestConnection?.brokerage?.name ?? latestConnection?.name ?? 'unknown brokerage'
      setAccountSyncStatus(
        accountId,
        `SnapTrade diagnostic: ${accountsRaw.length} account${accountsRaw.length === 1 ? '' : 's'}, ${activeConnections.length} active authorization${activeConnections.length === 1 ? '' : 's'}; latest authorization is ${latestBrokerage}. Details logged to the browser console.`
      )
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      setSyncError(`SnapTrade diagnostic failed — ${detail}`)
    } finally {
      setSyncAccountId(null)
      setSyncing(false)
    }
  }

  async function syncAndAttachSnapTradeAccount(
    accountId: number,
    preferNewIds: Set<string>,
    beforeAuthorizationIds: Set<string>,
    connectionId?: string,
    fallbackError?: string,
    allowLatestAuthorizationFallback = false
  ) {
    const { snapTradeUserId: userId, snapTradeUserSecret: userSecret } = useAppStore.getState()
    if (!lmProxyUrl || !userId || !userSecret) return
    setSyncing(true)
    setSyncAccountId(accountId)
    setSyncError(null)
    try {
      let syncedAccounts = useAppStore.getState().accounts
      let target = syncedAccounts.find(account => account.id === accountId)
      if (!target) return
      const resolvedInitialConnectionId = connectionId
        ?? target.snapTradeAuthorizationId
        ?? await findNewSnapTradeAuthorizationId(userId, userSecret, beforeAuthorizationIds)
        ?? (allowLatestAuthorizationFallback ? await findLatestSnapTradeAuthorizationId(userId, userSecret) : undefined)
      if (resolvedInitialConnectionId && !isSnapTradeLinked(target)) {
        const pendingLinked: Account = {
          ...target,
          snapTradeAuthorizationId: resolvedInitialConnectionId,
          holdings: target.plaidAccessToken ? target.holdings : undefined,
          dividends: target.plaidAccessToken ? target.dividends : undefined,
          taxLots: target.plaidAccessToken ? target.taxLots : undefined,
        }
        setAccounts([
          ...syncedAccounts.filter(account => account.id !== accountId),
          pendingLinked,
        ])
        setEditing(current => current?.id === accountId ? pendingLinked : current)
        target = pendingLinked
      }
      let selected: Account | undefined
      for (let attempt = 0; attempt < 6; attempt++) {
        if (attempt > 0) {
          setAccountSyncStatus(accountId, `Waiting for SnapTrade account data... attempt ${attempt + 1}/6`)
          await new Promise(resolve => window.setTimeout(resolve, attempt < 3 ? 2500 : 5000))
        }
        const currentAccounts = useAppStore.getState().accounts
        target = currentAccounts.find(account => account.id === accountId)
        if (!target) return
        syncedAccounts = await syncSnapTradeAccounts(lmProxyUrl, userId, userSecret, currentAccounts, {
          clientId: snapTradeClientId,
          consumerKey: snapTradeConsumerKey,
        })
        const snapTradeAccounts = syncedAccounts.filter(account => account.snapTradeAccountId)
        const newCandidates = snapTradeAccounts.filter(account =>
          account.id === accountId ||
          !preferNewIds.size ||
          !preferNewIds.has(account.snapTradeAccountId!)
        )
        const candidates = (newCandidates.length > 0 ? newCandidates : snapTradeAccounts)
          .sort((a, b) => snapTradeMatchScore(b, target!) - snapTradeMatchScore(a, target!))
        selected = candidates[0]
        if (selected) break
      }
      if (!selected) {
        const resolvedConnectionId = resolvedInitialConnectionId
          ?? target.snapTradeAuthorizationId
          ?? await findNewSnapTradeAuthorizationId(userId, userSecret, beforeAuthorizationIds)
          ?? (allowLatestAuthorizationFallback ? await findLatestSnapTradeAuthorizationId(userId, userSecret) : undefined)
        if (resolvedConnectionId) {
          const connectionStatus = await snapTradeConnectionStatus(resolvedConnectionId)
          const pendingLinked: Account = {
            ...target,
            snapTradeAuthorizationId: resolvedConnectionId,
            holdings: target.plaidAccessToken ? target.holdings : undefined,
            dividends: target.plaidAccessToken ? target.dividends : undefined,
            taxLots: target.plaidAccessToken ? target.taxLots : undefined,
          }
          setAccounts([
            ...syncedAccounts.filter(account => account.id !== accountId),
            pendingLinked,
          ])
          setEditing(current => current?.id === accountId ? pendingLinked : current)
          setAccountSyncStatus(
            accountId,
            allowLatestAuthorizationFallback
              ? `SnapTrade is linked to ${target.name}, but no accounts were returned yet. ${connectionStatus}`
              : `SnapTrade is linked to ${target.name}. ${connectionStatus}`
          )
        } else {
          if (allowLatestAuthorizationFallback) {
            const pendingAuthorizationId = target.snapTradeAuthorizationId ?? `pending-ibkr-flex-${accountId}`
            const pendingLinked: Account = {
              ...target,
              snapTradeAuthorizationId: pendingAuthorizationId,
              holdings: target.plaidAccessToken ? target.holdings : undefined,
              dividends: target.plaidAccessToken ? target.dividends : undefined,
              taxLots: target.plaidAccessToken ? target.taxLots : undefined,
            }
            setAccounts([
              ...syncedAccounts.filter(account => account.id !== accountId),
              pendingLinked,
            ])
            setEditing(current => current?.id === accountId ? pendingLinked : current)
            setSyncError(null)
            const connectionStatus = await snapTradeUserConnectionSummary(userId, userSecret)
            setAccountSyncStatus(accountId, `SnapTrade is linked to ${target.name}, but no account objects were returned yet. ${connectionStatus}`)
          } else {
            setAccounts(syncedAccounts)
            setAccountSyncStatus(accountId, null)
            setSyncError(fallbackError ?? 'No connected SnapTrade account was returned yet. Try again after the brokerage finishes syncing.')
          }
        }
        return
      }
      const attached: Account = {
        ...target,
        balance: selected.balance,
        currency: selected.currency,
        allocation: selected.allocation,
        syncedAt: selected.syncedAt,
        isManual: target.isManual,
        snapTradeAccountId: selected.snapTradeAccountId,
        snapTradeAuthorizationId: selected.snapTradeAuthorizationId,
        holdings: selected.holdings,
        dividends: undefined,
        taxLots: selected.taxLots,
      }
      const selectedSnapTradeId = selected.snapTradeAccountId
      setAccounts([
        ...syncedAccounts.filter(account => account.id !== accountId && account.snapTradeAccountId !== selectedSnapTradeId),
        attached,
      ])
      setEditing(current => current?.id === accountId ? attached : current)
      setAccountSyncStatus(accountId, `Connected SnapTrade data to ${target.name}.`)
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      setSyncError(`SnapTrade attach failed — ${detail}`)
    } finally {
      setSyncAccountId(null)
      setSyncing(false)
    }
  }

  async function fetchSnapTradeAuthorizationIds(userId: string, userSecret: string): Promise<Set<string>> {
    if (!lmProxyUrl) return new Set()
    const connections = await fetchSnapTradeConnections(lmProxyUrl, userId, userSecret, {
      clientId: snapTradeClientId,
      consumerKey: snapTradeConsumerKey,
    }).catch(() => [])
    return new Set(connections.map(connection => String(connection.id)).filter(Boolean))
  }

  async function findNewSnapTradeAuthorizationId(userId: string, userSecret: string, beforeIds: Set<string>): Promise<string | undefined> {
    if (!lmProxyUrl) return undefined
    const connections = await fetchSnapTradeConnections(lmProxyUrl, userId, userSecret, {
      clientId: snapTradeClientId,
      consumerKey: snapTradeConsumerKey,
    }).catch(() => [])
    const newConnections = connections
      .filter(connection => connection.id && !beforeIds.has(String(connection.id)))
      .sort((a, b) => snapTradeConnectionTime(b) - snapTradeConnectionTime(a))
    return newConnections[0]?.id ? String(newConnections[0].id) : undefined
  }

  async function findLatestSnapTradeAuthorizationId(userId: string, userSecret: string): Promise<string | undefined> {
    if (!lmProxyUrl) return undefined
    const connections = await fetchSnapTradeConnections(lmProxyUrl, userId, userSecret, {
      clientId: snapTradeClientId,
      consumerKey: snapTradeConsumerKey,
    }).catch(() => [])
    const latestConnection = connections
      .filter(connection => connection.id && !connection.disabled)
      .sort((a, b) => snapTradeConnectionTime(b) - snapTradeConnectionTime(a))[0]
    return latestConnection?.id ? String(latestConnection.id) : undefined
  }

  async function snapTradeUserConnectionSummary(userId: string, userSecret: string): Promise<string> {
    if (!lmProxyUrl) return 'Check the proxy settings, then refresh.'
    const connections = await fetchSnapTradeConnections(lmProxyUrl, userId, userSecret, {
      clientId: snapTradeClientId,
      consumerKey: snapTradeConsumerKey,
    }).catch(() => [])
    const activeConnections = connections.filter(connection => !connection.disabled)
    if (activeConnections.length === 0) return 'SnapTrade reports 0 active authorizations for this user.'
    const latest = activeConnections.sort((a, b) => snapTradeConnectionTime(b) - snapTradeConnectionTime(a))[0]
    const brokerage = latest?.brokerage?.display_name ?? latest?.brokerage?.name ?? latest?.name ?? 'brokerage'
    return `SnapTrade reports ${activeConnections.length} active authorization${activeConnections.length === 1 ? '' : 's'}; latest is ${brokerage}.`
  }

  function snapTradeConnectionTime(connection: Record<string, any>): number {
    const raw = connection.created_date ?? connection.createdDate ?? connection.updated_date ?? connection.updatedDate
    const time = raw ? Date.parse(String(raw)) : NaN
    return Number.isFinite(time) ? time : 0
  }

  async function snapTradeConnectionStatus(connectionId: string): Promise<string> {
    const { snapTradeUserId: userId, snapTradeUserSecret: userSecret } = useAppStore.getState()
    if (!lmProxyUrl || !userId || !userSecret) return 'Holdings are still syncing; use Refresh shortly.'
    const connections = await fetchSnapTradeConnections(lmProxyUrl, userId, userSecret, {
      clientId: snapTradeClientId,
      consumerKey: snapTradeConsumerKey,
    }).catch(() => [])
    const connection = connections.find(item => item.id === connectionId)
    if (!connection) return 'The connection exists, but accounts are not available yet; use Refresh shortly.'
    if (connection.disabled) return 'The connection is disabled; reconnect it from this account.'
    const brokerage = connection.brokerage?.display_name ?? connection.brokerage?.name ?? connection.name ?? 'brokerage'
    const matchingConnections = connections.filter(item => item.brokerage?.id && item.brokerage.id === connection.brokerage?.id)
    const duplicateNote = matchingConnections.length > 1
      ? ` ${matchingConnections.length} ${brokerage} connections exist for this SnapTrade user.`
      : ''
    if (connection.brokerage?.slug === 'INTERACTIVE-BROKERS-FLEX') {
      return `${brokerage} Flex is connected, but SnapTrade returned zero accounts. In IBKR, use Performance & Reports > Third-Party Reports > Third-Party Services > SnapTrade and paste that Query ID and Token into SnapTrade, not a custom Flex Web Service query/token.${duplicateNote}`
    }
    return `${brokerage} is connected, but SnapTrade returned zero accounts for this connection; use Refresh after the brokerage sync finishes.${duplicateNote}`
  }

  function snapTradeMatchScore(candidate: Account, target: Account): number {
    let score = 0
    if (candidate.snapTradeAccountId && candidate.snapTradeAccountId === target.snapTradeAccountId) score += 1000
    if (candidate.snapTradeAuthorizationId && candidate.snapTradeAuthorizationId === target.snapTradeAuthorizationId) score += 500
    if (candidate.currency.toUpperCase() === target.currency.toUpperCase()) score += 20
    const candidateWords = new Set(candidate.name.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean))
    for (const word of target.name.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)) {
      if (candidateWords.has(word)) score += 5
    }
    return score
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

  const syncedAt = accounts[0]?.syncedAt
    ? new Date(accounts[0].syncedAt).toLocaleString()
    : null

  return (
    <div>
      <PageHeader title="Accounts">
        <span className="text-[11px] text-gray-400">
          {syncing ? 'Syncing…' : syncedAt ? `Synced ${syncedAt}` : ''}
        </span>
        <Button variant="default" onClick={() => syncFromLM(true)} disabled={syncing || !lmApiKey}>
          {syncing ? 'Syncing…' : 'Sync accounts'}
        </Button>
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
        {snapTradeStatus && snapTradeStatusAccountId == null && <Banner variant="info">{snapTradeStatus}</Banner>}

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
                {/* ── Main row ── */}
                <div className={`grid ${COLS} gap-2 items-center`}>
                  {/* Account name */}
                  <span className="font-medium truncate flex items-center gap-1.5 min-w-0">
                    <span className="truncate">{acc.name}</span>
                    {isSnapTradeLinked(acc) && (
                      <ProviderBadge
                        provider="snaptrade"
                        health={providerHealth(acc, 'snaptrade', syncing && syncAccountId === acc.id, snapTradeStatusAccountId === acc.id ? snapTradeStatus : null)}
                      />
                    )}
                    {acc.plaidAccessToken && (
                      <ProviderBadge
                        provider="plaid"
                        health={providerHealth(acc, 'plaid', syncing && syncAccountId === acc.id && !isSnapTradeLinked(acc), snapTradeStatusAccountId === acc.id ? snapTradeStatus : null)}
                      />
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
                  <CharacteristicsView acc={acc} onShowLots={setLotDetailsAccount} />

                  {/* Tax domicile */}
                  <span>
                    {acc.taxCountry ? (
                      <Badge variant={acc.taxCountry === 'FR' ? 'fr' : 'us'}>
                        {acc.taxCountry === 'FR' ? 'France' : 'US'}
                      </Badge>
                    ) : (
                      <span className="text-[11px] text-gray-400">Unset</span>
                    )}
                  </span>

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

                      <div className="h-4 w-px bg-gray-200 dark:bg-gray-700 shrink-0" />

                      <div className="flex items-center gap-1.5 text-[11px]">
                        <span className="text-gray-500">Tax domicile</span>
                        <select
                          className="h-[26px] text-[11px] border border-gray-300 dark:border-gray-600 rounded px-1.5 bg-white dark:bg-gray-800"
                          value={eAcc.taxCountry ?? ''}
                          onChange={e => setEditing({ ...eAcc, taxCountry: e.target.value ? e.target.value as Country : undefined })}
                        >
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
                    </div>

                    {/* Advanced configuration for Investment / Retirement */}
                    {(eAcc.type === 'investment' || eAcc.type === 'retirement') && (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {/* Position sync */}
                        <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 bg-gray-50/50 dark:bg-gray-800/40">
                          <div className="text-[10px] font-medium text-gray-400 dark:text-gray-500 uppercase tracking-[0.05em] mb-2 flex justify-between items-center">
                            <span>Position sync</span>
                          </div>
                          <div className="space-y-3 text-[11px]">
                            {snapTradeStatus && snapTradeStatusAccountId === eAcc.id && (
                              <div className="rounded-[6px] border border-blue-200 dark:border-blue-900 bg-blue-50 dark:bg-blue-950/30 px-2.5 py-2 text-blue-800 dark:text-blue-200">
                                {snapTradeStatus}
                              </div>
                            )}
                            <div className="rounded-[6px] border border-blue-100 dark:border-blue-900/60 bg-white dark:bg-gray-900/60 p-2.5">
                              <div className="flex items-center justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="flex items-center gap-1.5 font-medium text-gray-800 dark:text-gray-100">
                                    <ProviderBadge
                                      provider="snaptrade"
                                      health={isSnapTradeLinked(eAcc)
                                        ? providerHealth(eAcc, 'snaptrade', syncing && syncAccountId === eAcc.id, snapTradeStatusAccountId === eAcc.id ? snapTradeStatus : null)
                                        : { state: 'pending', tooltip: 'SnapTrade is preferred for investment accounts because it is built for positions, holdings, and tax-lot style data.' }}
                                    />
                                    Preferred
                                  </div>
                                  <div className="mt-1 text-gray-500 dark:text-gray-400">
                                    Better for analyzing positions, holdings, and tax lots when the brokerage is supported.
                                  </div>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                  {isSnapTradeLinked(eAcc) ? (
                                    <>
                                      <button
                                        type="button"
                                        className="text-[11px] px-2 py-1 rounded-[5px] border border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-900/20 disabled:opacity-50"
                                        disabled={syncing || !lmProxyUrl}
                                        onClick={() => refreshSnapTradeAccount(eAcc.id)}
                                      >
                                        Refresh
                                      </button>
                                      <button
                                        type="button"
                                        className="text-[11px] px-2 py-1 rounded-[5px] border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
                                        disabled={syncing || !lmProxyUrl}
                                        onClick={() => diagnoseSnapTradeAccount(eAcc.id)}
                                      >
                                        Diagnose
                                      </button>
                                      <button
                                        type="button"
                                        className="text-[11px] px-2 py-1 rounded-[5px] border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800"
                                        onClick={() => setEditing({ ...eAcc, snapTradeAccountId: undefined, snapTradeAuthorizationId: undefined, holdings: eAcc.plaidAccessToken ? eAcc.holdings : undefined, taxLots: eAcc.plaidAccessToken ? eAcc.taxLots : undefined })}
                                      >
                                        Unlink
                                      </button>
                                    </>
                                  ) : (
                                    <button
                                      type="button"
                                      className="text-[11px] px-2 py-1 rounded-[5px] border border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-900/20 disabled:opacity-50"
                                      disabled={syncing || !lmProxyUrl || !snapTradeClientId || !snapTradeConsumerKey}
                                      onClick={() => connectSnapTradeAccount(eAcc.id)}
                                    >
                                      Connect SnapTrade
                                    </button>
                                  )}
                                </div>
                              </div>
                            </div>
                            <div className="rounded-[6px] border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900/60 p-2.5">
                              <div className="flex items-center justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="flex items-center gap-1.5 font-medium text-gray-800 dark:text-gray-100">
                                    {eAcc.plaidAccessToken ? (
                                      <ProviderBadge
                                        provider="plaid"
                                        health={providerHealth(eAcc, 'plaid', syncing && syncAccountId === eAcc.id && !isSnapTradeLinked(eAcc), null)}
                                      />
                                    ) : (
                                      <span className="shrink-0 inline-flex items-center gap-1 text-[9.5px] font-medium px-1 py-0.5 rounded bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400">
                                        Plaid
                                      </span>
                                    )}
                                    Fallback
                                  </div>
                                  <div className="mt-1 text-gray-500 dark:text-gray-400">
                                    Useful when SnapTrade does not support or expose the brokerage yet; Plaid supports more institutions.
                                  </div>
                                </div>
                                <PlaidConnect
                                  accountId={eAcc.id}
                                  isLinked={!!eAcc.plaidAccessToken}
                                  holdingsCount={eAcc.holdings?.length}
                                  onLinked={async (token, itemId) => {
                                    setEditing({ ...eAcc, plaidAccessToken: token, plaidItemId: itemId })
                                  }}
                                  onUnlink={() => setEditing({ ...eAcc, plaidAccessToken: undefined, plaidItemId: undefined, holdings: isSnapTradeLinked(eAcc) ? eAcc.holdings : undefined, taxLots: isSnapTradeLinked(eAcc) ? eAcc.taxLots : undefined })}
                                  onRefresh={eAcc.plaidAccessToken ? () => syncSinglePlaid(eAcc.id, eAcc.plaidAccessToken!) : undefined}
                                />
                              </div>
                            </div>
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
                    {(eAcc.type === 'investment' || eAcc.type === 'retirement') && (
                      <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 bg-gray-50/50 dark:bg-gray-800/40">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <div className="text-[10px] font-medium text-gray-400 dark:text-gray-500 uppercase tracking-[0.05em]">Tax lots</div>
                            <div className="text-[11px] text-gray-500 dark:text-gray-400">
                              {(eAcc.taxLots?.length ?? 0) > 0
                                ? `${eAcc.taxLots!.length} synced lot${eAcc.taxLots!.length === 1 ? '' : 's'} from ${isSnapTradeLinked(eAcc) ? 'SnapTrade' : 'Plaid'} holdings`
                                : 'No synced lots'}
                            </div>
                          </div>
                          <button
                            type="button"
                            className="text-[11px] px-2.5 py-1 rounded-[5px] border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800"
                            onClick={() => setLotDetailsAccount(eAcc)}
                          >
                            View lots
                          </button>
                        </div>
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
      {lotDetailsAccount && (
        <TaxLotsModal account={lotDetailsAccount} onClose={() => setLotDetailsAccount(null)} />
      )}
    </div>
  )
}
