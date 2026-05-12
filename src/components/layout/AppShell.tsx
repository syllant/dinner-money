import { useEffect } from 'react'
import { useAppStore } from '../../store/useAppStore'
import { syncPlaidInvestmentAccounts } from '../../lib/investmentSync'
import { syncIbkrFlexAccounts } from '../../lib/ibkrFlex'
import { syncAllAccounts, LM_FULL_SYNC_TTL } from '../../lib/lmSync'
import { useDriveAutoSave } from '../../hooks/useDriveAutoSave'
import { Sidebar } from './Sidebar'

const AUTO_SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000
const PLAID_AUTO_SYNC_KEY = 'dinner-money:plaid-investment-auto-sync'
const IBKR_FLEX_AUTO_SYNC_KEY = 'dinner-money:ibkr-flex-auto-sync'

export function AppShell({ children }: { children: React.ReactNode }) {
  useDriveAutoSave()

  useEffect(() => {
    const onFocus = (e: FocusEvent) => {
      const t = e.target as HTMLInputElement
      if (t.tagName === 'INPUT' && t.type === 'number') t.select()
    }
    document.addEventListener('focusin', onFocus)
    return () => document.removeEventListener('focusin', onFocus)
  }, [])

  // Snapshot today's balance for Plaid accounts on load (once per day per account)
  useEffect(() => {
    useAppStore.getState().snapshotPlaidNavToday()
  }, [])

  // Auto-sync all accounts from LunchMoney on startup if not synced in the last 24h
  useEffect(() => {
    const { lmApiKey, lmProxyUrl, ibkrFlexToken, ibkrFlexQueryId, accounts } = useAppStore.getState()
    if (!lmApiKey) return
    const lastSync = accounts.length > 0 && accounts[0].syncedAt
      ? new Date(accounts[0].syncedAt).getTime()
      : 0
    if (Date.now() - lastSync < LM_FULL_SYNC_TTL) return
    syncAllAccounts({ lmApiKey, lmProxyUrl, ibkrFlexToken, ibkrFlexQueryId, existingAccounts: accounts })
      .then(merged => useAppStore.getState().setAccounts(merged))
      .catch(err => console.warn('[LM] Auto-sync on startup failed:', err))
  }, [])

  // Auto-sync Plaid investment accounts every 6h — runs once on mount, not on every accounts change
  useEffect(() => {
    const { lmProxyUrl, accounts, setAccounts, snapshotPlaidNavToday } = useAppStore.getState()
    if (!lmProxyUrl) return
    const syncable = accounts.some(a =>
      a.includedInPlanning !== false && a.plaidAccessToken &&
      (a.type === 'investment' || a.type === 'retirement')
    )
    if (!syncable) return
    const raw = localStorage.getItem(PLAID_AUTO_SYNC_KEY)
    if (raw && Date.now() - Number(raw) < AUTO_SYNC_INTERVAL_MS) return
    localStorage.setItem(PLAID_AUTO_SYNC_KEY, String(Date.now()))
    syncPlaidInvestmentAccounts(accounts, lmProxyUrl)
      .then(next => { setAccounts(next); snapshotPlaidNavToday() })
      .catch(err => console.warn('[Plaid] Auto investment sync failed:', err))
  }, [])

  // Auto-sync IBKR Flex accounts every 6h — runs once on mount, not on every accounts change
  useEffect(() => {
    const { lmProxyUrl, ibkrFlexToken, ibkrFlexQueryId, accounts, setAccounts } = useAppStore.getState()
    if (!lmProxyUrl || !ibkrFlexToken || !ibkrFlexQueryId) return
    if (!accounts.some(a => a.ibkrAccountId?.trim())) return
    const raw = localStorage.getItem(IBKR_FLEX_AUTO_SYNC_KEY)
    if (raw && Date.now() - Number(raw) < AUTO_SYNC_INTERVAL_MS) return
    localStorage.setItem(IBKR_FLEX_AUTO_SYNC_KEY, String(Date.now()))
    syncIbkrFlexAccounts(accounts, lmProxyUrl, ibkrFlexToken, ibkrFlexQueryId)
      .then(next => setAccounts(next))
      .catch(err => console.warn('[IBKR Flex] Auto investment sync failed:', err))
  }, [])

  return (
    <div className="flex h-screen overflow-hidden bg-white dark:bg-gray-950 text-gray-900 dark:text-white">
      <Sidebar />
      <div className="flex-1 overflow-y-auto min-w-0">
        {children}
      </div>
    </div>
  )
}
