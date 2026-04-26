import { useState, useEffect, useCallback } from 'react'
import { usePlaidLink } from 'react-plaid-link'
import { useAppStore } from '../store/useAppStore'

export function PlaidConnect({
  isLinked,
  onLinked,
  onUnlink,
  onRefresh,
}: {
  accountId: number
  isLinked: boolean
  onLinked: (accessToken: string, itemId: string) => void
  onUnlink: () => void
  onRefresh?: () => void
}) {
  const { lmProxyUrl } = useAppStore()
  const [linkToken, setLinkToken] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Fetch link_token from our proxy
  const generateToken = useCallback(async () => {
    if (!lmProxyUrl) {
      setError("No proxy URL configured")
      return
    }
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
          products: ['transactions'],
          additional_consented_products: ['auth']
        })
      })
      if (!res.ok) {
        const errData = await res.json().catch(() => null)
        throw new Error(errData?.error_message || `Proxy returned ${res.status}`)
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
    token: linkToken!,
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
          throw new Error(errData?.error_message || `Exchange returned ${res.status}`)
        }
        const data = await res.json()
        onLinked(data.access_token, data.item_id)
      } catch (err: any) {
        setError(err.message || 'Exchange failed')
      } finally {
        setLoading(false)
      }
    },
    onExit: () => {
      // User closed the widget without connecting
      if (linkToken) setLinkToken(null)
    }
  })

  // When linkToken is ready, immediately open Plaid Link
  useEffect(() => {
    if (ready && linkToken) {
      open()
    }
  }, [ready, linkToken, open])

  if (isLinked) {
    return (
      <div className="flex items-center gap-2 mt-2 bg-gray-50 dark:bg-gray-800 p-2 rounded border border-gray-200 dark:border-gray-700">
        <span className="text-[12px] text-green-600 dark:text-green-400 font-medium flex items-center gap-1">
          ✓ Plaid Synced
        </span>
        <div className="flex gap-2 ml-auto">
          {onRefresh && (
            <button 
              onClick={onRefresh}
              className="text-[11px] text-gray-500 hover:text-gray-800 dark:hover:text-gray-200 hover:underline"
            >
              Refresh
            </button>
          )}
          <button 
            onClick={onUnlink}
            className="text-[11px] text-red-500 hover:underline"
          >
            Disconnect
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-1 mt-2 bg-gray-50 dark:bg-gray-800 p-2 rounded border border-gray-200 dark:border-gray-700">
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-gray-600 dark:text-gray-300">
          Sync holdings via Plaid
        </span>
        <label className="relative inline-flex items-center cursor-pointer">
          <input 
            type="checkbox" 
            className="sr-only peer" 
            checked={false}
            onChange={(e) => {
              if (e.target.checked) generateToken()
            }}
            disabled={loading}
          />
          <div className="w-7 h-4 bg-gray-200 peer-focus:outline-none rounded-full peer dark:bg-gray-600 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all dark:border-gray-600 peer-checked:bg-blue-600"></div>
        </label>
      </div>
      {loading && <div className="text-[10px] text-gray-500">Initializing Plaid...</div>}
      {error && <div className="text-[10px] text-red-500">{error}</div>}
    </div>
  )
}
