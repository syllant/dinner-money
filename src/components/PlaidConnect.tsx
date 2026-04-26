import { useState, useEffect, useCallback } from 'react'
import { usePlaidLink } from 'react-plaid-link'
import { useAppStore } from '../store/useAppStore'

export function PlaidConnect({
  isLinked,
  holdingsCount,
  onLinked,
  onUnlink,
  onRefresh,
}: {
  accountId: number
  isLinked: boolean
  holdingsCount?: number
  onLinked: (accessToken: string, itemId: string) => void
  onUnlink: () => void
  onRefresh?: () => void
}) {
  const { lmProxyUrl } = useAppStore()
  const [linkToken, setLinkToken] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const generateToken = useCallback(async () => {
    if (!lmProxyUrl) { setError('No proxy URL configured in Settings'); return }
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`${lmProxyUrl.replace(/\/$/, '')}/plaid/link/token/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_name: 'DinnerMoney',
          language: 'en',
          country_codes: ['US'],
          user: { client_user_id: 'dinnermoney-user' },
          products: ['investments'],
        }),
      })
      if (!res.ok) {
        const errData = await res.json().catch(() => null)
        const code = errData?.error_code ? `[${errData.error_code}] ` : ''
        throw new Error(code + (errData?.error_message || `Proxy returned ${res.status}`))
      }
      const data = await res.json()
      setLinkToken(data.link_token)
    } catch (err: any) {
      setError(err.message || 'Could not reach Plaid proxy')
    } finally {
      setLoading(false)
    }
  }, [lmProxyUrl])

  const { open, ready } = usePlaidLink({
    token: linkToken ?? '',
    onSuccess: async (public_token, _metadata) => {
      setLoading(true)
      try {
        const res = await fetch(`${lmProxyUrl!.replace(/\/$/, '')}/plaid/item/public_token/exchange`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ public_token }),
        })
        if (!res.ok) {
          const errData = await res.json().catch(() => null)
          const code = errData?.error_code ? `[${errData.error_code}] ` : ''
          throw new Error(code + (errData?.error_message || `Exchange returned ${res.status}`))
        }
        const data = await res.json()
        onLinked(data.access_token, data.item_id)
      } catch (err: any) {
        setError(err.message || 'Token exchange failed')
      } finally {
        setLoading(false)
        setLinkToken(null)
      }
    },
    onExit: () => setLinkToken(null),
  })

  useEffect(() => {
    if (ready && linkToken) open()
  }, [ready, linkToken, open])

  if (isLinked) {
    return (
      <div className="flex items-center gap-3">
        <span className="flex items-center gap-1.5 text-[11.5px] text-green-600 dark:text-green-400 font-medium">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <circle cx="6" cy="6" r="6" fill="currentColor" opacity="0.15"/>
            <path d="M3.5 6l1.8 1.8 3.2-3.6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Plaid linked
          {holdingsCount != null && holdingsCount > 0 && (
            <span className="text-[10.5px] text-gray-400 dark:text-gray-500 font-normal">
              · {holdingsCount} holding{holdingsCount !== 1 ? 's' : ''}
            </span>
          )}
        </span>
        <div className="flex items-center gap-2 ml-auto">
          {onRefresh && (
            <button
              onClick={onRefresh}
              disabled={loading}
              className="text-[11px] text-gray-500 hover:text-gray-800 dark:hover:text-gray-200 disabled:opacity-40 transition-colors"
            >
              {loading ? 'Syncing…' : 'Refresh'}
            </button>
          )}
          <span className="text-gray-200 dark:text-gray-700">|</span>
          <button
            onClick={onUnlink}
            className="text-[11px] text-red-400 hover:text-red-600 dark:hover:text-red-400 transition-colors"
          >
            Disconnect
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[11px] text-gray-400 dark:text-gray-500">
        Holdings &amp; cost basis via Plaid
      </span>
      <div className="flex flex-col items-end gap-1">
        <button
          onClick={generateToken}
          disabled={loading || !lmProxyUrl}
          className="flex items-center gap-1.5 text-[11.5px] px-2.5 py-1 rounded-[5px] border border-blue-300 dark:border-blue-700 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 disabled:opacity-40 transition-colors"
        >
          {loading ? (
            <>
              <svg className="animate-spin" width="10" height="10" viewBox="0 0 10 10" fill="none">
                <circle cx="5" cy="5" r="4" stroke="currentColor" strokeWidth="1.5" strokeDasharray="6 6"/>
              </svg>
              Connecting…
            </>
          ) : (
            'Connect Plaid'
          )}
        </button>
        {error && (
          <span className="text-[10px] text-red-500 max-w-[200px] text-right leading-tight">{error}</span>
        )}
      </div>
    </div>
  )
}
