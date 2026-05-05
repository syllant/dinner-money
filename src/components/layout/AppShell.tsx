import { useEffect } from 'react'
import { Sidebar } from './Sidebar'
import { useAppStore } from '../../store/useAppStore'
import { syncPlaidInvestmentAccounts } from '../../lib/investmentSync'
import { syncSnapTradeAccounts } from '../../lib/snaptrade'

const AUTO_SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000
const PLAID_AUTO_SYNC_KEY = 'dinner-money:plaid-investment-auto-sync'
const SNAPTRADE_AUTO_SYNC_KEY = 'dinner-money:snaptrade-investment-auto-sync'

export function AppShell({ children }: { children: React.ReactNode }) {
  const accounts = useAppStore(s => s.accounts)
  const lmProxyUrl = useAppStore(s => s.lmProxyUrl)
  const snapTradeClientId = useAppStore(s => s.snapTradeClientId)
  const snapTradeConsumerKey = useAppStore(s => s.snapTradeConsumerKey)
  const snapTradeUserId = useAppStore(s => s.snapTradeUserId)
  const snapTradeUserSecret = useAppStore(s => s.snapTradeUserSecret)
  const setAccounts = useAppStore(s => s.setAccounts)

  useEffect(() => {
    const onFocus = (e: FocusEvent) => {
      const t = e.target as HTMLInputElement
      if (t.tagName === 'INPUT' && t.type === 'number') t.select()
    }
    document.addEventListener('focusin', onFocus)
    return () => document.removeEventListener('focusin', onFocus)
  }, [])

  useEffect(() => {
    if (!lmProxyUrl) return
    const syncable = accounts.some(account =>
      account.includedInPlanning !== false &&
      account.plaidAccessToken &&
      (account.type === 'investment' || account.type === 'retirement')
    )
    if (!syncable) return
    try {
      const raw = localStorage.getItem(PLAID_AUTO_SYNC_KEY)
      if (raw && Date.now() - Number(raw) < AUTO_SYNC_INTERVAL_MS) return
      localStorage.setItem(PLAID_AUTO_SYNC_KEY, String(Date.now()))
    } catch {}

    let cancelled = false
    syncPlaidInvestmentAccounts(accounts, lmProxyUrl)
      .then(next => {
        if (!cancelled) setAccounts(next)
      })
      .catch(error => {
        console.warn('[Plaid] Automatic investment sync failed:', error)
      })
    return () => { cancelled = true }
  }, [accounts, lmProxyUrl, setAccounts])

  useEffect(() => {
    if (!lmProxyUrl || !snapTradeUserId || !snapTradeUserSecret) return
    try {
      const raw = localStorage.getItem(SNAPTRADE_AUTO_SYNC_KEY)
      if (raw && Date.now() - Number(raw) < AUTO_SYNC_INTERVAL_MS) return
      localStorage.setItem(SNAPTRADE_AUTO_SYNC_KEY, String(Date.now()))
    } catch {}

    let cancelled = false
    syncSnapTradeAccounts(lmProxyUrl, snapTradeUserId, snapTradeUserSecret, accounts, {
      clientId: snapTradeClientId,
      consumerKey: snapTradeConsumerKey,
    })
      .then(next => {
        if (!cancelled) setAccounts(next)
      })
      .catch(error => {
        console.warn('[SnapTrade] Automatic investment sync failed:', error)
      })
    return () => { cancelled = true }
  }, [accounts, lmProxyUrl, setAccounts, snapTradeClientId, snapTradeConsumerKey, snapTradeUserId, snapTradeUserSecret])

  return (
    <div className="flex h-screen overflow-hidden bg-white dark:bg-gray-950 text-gray-900 dark:text-white">
      <Sidebar />
      <div className="flex-1 overflow-y-auto min-w-0">
        {children}
      </div>
    </div>
  )
}
