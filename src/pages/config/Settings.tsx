import { useState } from 'react'
import { useAppStore } from '../../store/useAppStore'
import { PageHeader } from '../../components/ui/PageHeader'
import { Button } from '../../components/ui/Button'
import { Banner } from '../../components/ui/Banner'
import { fetchCurrentUser, LunchMoneyError } from '../../lib/lunchmoney'
import { fetchFredMonthlySeries } from '../../lib/fred'
import { fetchMonthlyAdjustedReturns } from '../../lib/tiingo'
import { fetchSnapTradeStatus } from '../../lib/snaptrade'

type ApiService = 'lunchmoney' | 'tiingo' | 'fred' | 'snaptrade'

export default function Settings() {
  const {
    lmApiKey, setLmApiKey, lmProxyUrl, setLmProxyUrl,
    minTransactionEUR, setMinTransactionEUR,
    tiingoApiKey, setTiingoApiKey,
    fredApiKey, setFredApiKey,
    snapTradeClientId, setSnapTradeClientId,
    snapTradeConsumerKey, setSnapTradeConsumerKey,
    snapTradeUserId, snapTradeUserSecret,
  } = useAppStore()
  const [keyInput, setKeyInput] = useState(lmApiKey ?? '')
  const [proxyInput, setProxyInput] = useState(lmProxyUrl ?? '')
  const [tiingoKeyInput, setTiingoKeyInput] = useState(tiingoApiKey ?? '')
  const [fredKeyInput, setFredKeyInput] = useState(fredApiKey ?? '')
  const [snapTradeClientIdInput, setSnapTradeClientIdInput] = useState(snapTradeClientId ?? '')
  const [snapTradeConsumerKeyInput, setSnapTradeConsumerKeyInput] = useState(snapTradeConsumerKey ?? '')
  const [testingService, setTestingService] = useState<ApiService | null>(null)
  const [testResults, setTestResults] = useState<Partial<Record<ApiService, { ok: boolean; message: string }>>>({})
  const [savedService, setSavedService] = useState<ApiService | null>(null)

  function setApiResult(service: ApiService, result: { ok: boolean; message: string }) {
    setTestResults(current => ({ ...current, [service]: result }))
  }

  function saveApiKey(service: ApiService) {
    if (service === 'lunchmoney') setLmApiKey(keyInput.trim() || null)
    if (service === 'tiingo') setTiingoApiKey(tiingoKeyInput.trim() || null)
    if (service === 'fred') setFredApiKey(fredKeyInput.trim() || null)
    if (service === 'snaptrade') {
      setSnapTradeClientId(snapTradeClientIdInput.trim() || null)
      setSnapTradeConsumerKey(snapTradeConsumerKeyInput.trim() || null)
    }
    setSavedService(service)
    setApiResult(service, { ok: true, message: 'Key saved locally' })
  }

  async function testApiConnection(service: ApiService) {
    const key = service === 'lunchmoney'
      ? keyInput.trim()
      : service === 'tiingo'
        ? tiingoKeyInput.trim()
        : service === 'fred'
          ? fredKeyInput.trim()
          : snapTradeClientIdInput.trim()
    if (!key) return
    setTestingService(service)
    setSavedService(null)
    const proxy = proxyInput.trim() || null
    try {
      if (service === 'lunchmoney') {
        const user = await fetchCurrentUser(key, proxy)
        setLmApiKey(key)
        setLmProxyUrl(proxy)
        setApiResult(service, { ok: true, message: `Connected as ${user.user_name} (${user.user_email})` })
      } else if (service === 'tiingo') {
        const rows = await fetchMonthlyAdjustedReturns(key, 'VTI', '2026-01-01', proxy)
        setTiingoApiKey(key)
        setApiResult(service, { ok: true, message: `VTI returns reachable (${rows.length} monthly rows)` })
      } else if (service === 'fred') {
        const rows = await fetchFredMonthlySeries(key, 'DGS10', '2026-01-01', proxy)
        setFredApiKey(key)
        setApiResult(service, { ok: true, message: `DGS10 reachable (${rows.length} monthly rows)` })
      } else {
        if (!proxy) throw new Error('SnapTrade requires the Cloudflare Worker proxy so requests can be signed server-side.')
        const status = await fetchSnapTradeStatus(proxy, snapTradeClientIdInput, snapTradeConsumerKeyInput)
        setLmProxyUrl(proxy)
        setSnapTradeClientId(snapTradeClientIdInput.trim() || null)
        setSnapTradeConsumerKey(snapTradeConsumerKeyInput.trim() || null)
        const upstream = status.upstream?.online === true ? 'online' : 'reachable'
        setApiResult(service, { ok: true, message: `SnapTrade ${upstream}` })
      }
    } catch (err) {
      if (service === 'lunchmoney' && err instanceof LunchMoneyError) {
        const is401 = err.status === 401
        const msg = is401
          ? 'Invalid API key — double-check the token at my.lunchmoney.app/developers.'
          : `LunchMoney returned ${err.status}. ${proxy ? 'Check that your proxy URL is correct.' : 'Try adding a CORS proxy URL below.'}`
        setApiResult(service, { ok: false, message: msg })
      } else if (err instanceof TypeError) {
        const msg = proxy
          ? `Could not reach the proxy at ${proxy}. Make sure the Cloudflare Worker is deployed and the URL is correct.`
          : 'Blocked by CORS or network policy. Add the Cloudflare Worker proxy URL below and retry.'
        setApiResult(service, { ok: false, message: msg })
      } else {
        const detail = err instanceof Error ? err.message : 'Unknown error'
        setApiResult(service, { ok: false, message: detail })
      }
    } finally {
      setTestingService(null)
    }
  }

  function exportConfig() {
    const store = useAppStore.getState()
    const data = {
      profile: store.profile,
      accounts: store.accounts,
      pensions: store.pensions,
      realEstateEvents: store.realEstateEvents,
      expenses: store.expenses,
      windfalls: store.windfalls,
      monteCarloConfig: store.monteCarloConfig,
      taxConfig: store.taxConfig,
      dividendHistory: store.dividendHistory,
      tiingoApiKey: store.tiingoApiKey,
      fredApiKey: store.fredApiKey,
      snapTradeClientId: store.snapTradeClientId,
      snapTradeConsumerKey: store.snapTradeConsumerKey,
      snapTradeUserId: store.snapTradeUserId,
      snapTradeUserSecret: store.snapTradeUserSecret,
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'dinner-money-config.json'
    a.click()
    URL.revokeObjectURL(url)
  }

  function importConfig(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target?.result as string)
        const store = useAppStore.getState()
        if (data.profile) store.setProfile(data.profile)
        if (data.accounts) store.setAccounts(data.accounts)
        if (data.pensions) store.setPensions(data.pensions)
        if (data.realEstateEvents) store.setRealEstateEvents(data.realEstateEvents)
        if (data.expenses) store.setExpenses(data.expenses)
        if (data.windfalls) store.setWindfalls(data.windfalls)
        if (data.monteCarloConfig) store.setMonteCarloConfig(data.monteCarloConfig)
        if (data.taxConfig) store.setTaxConfig(data.taxConfig)
        if (data.tiingoApiKey || data.avApiKey) store.setTiingoApiKey(data.tiingoApiKey ?? data.avApiKey)
        if (data.fredApiKey) store.setFredApiKey(data.fredApiKey)
        if (data.snapTradeClientId) store.setSnapTradeClientId(data.snapTradeClientId)
        if (data.snapTradeConsumerKey) store.setSnapTradeConsumerKey(data.snapTradeConsumerKey)
        if (data.snapTradeUserId || data.snapTradeUserSecret) store.setSnapTradeUser(data.snapTradeUserId ?? null, data.snapTradeUserSecret ?? null)
        if (data.dividendHistory) {
          Object.entries(data.dividendHistory as Record<string, any[]>).forEach(([ticker, divs]) =>
            store.setTickerDividends(ticker, divs as any)
          )
        }
        alert('Config imported successfully')
      } catch {
        alert('Failed to import — invalid JSON')
      }
    }
    reader.readAsText(file)
  }

  return (
    <div>
      <PageHeader title="Settings" />
      <div className="p-4 max-w-5xl space-y-6">

        <section>
          <h2 className="text-[13px] font-medium mb-2">API keys</h2>
          <p className="text-[11.5px] text-gray-500 dark:text-gray-400 mb-3">
            Keys are stored locally in your browser only. Test requests use the proxy below when configured.
          </p>
          <div className="overflow-x-auto border border-gray-200 dark:border-gray-700 rounded-[8px]">
            <table className="w-full text-[11px]">
              <thead className="bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400">
                <tr>
                  <th className="text-left font-medium px-3 py-2">Service</th>
                  <th className="text-left font-medium px-3 py-2">Key</th>
                  <th className="text-left font-medium px-3 py-2">Used for</th>
                  <th className="text-left font-medium px-3 py-2">Status</th>
                  <th className="text-right font-medium px-3 py-2">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {([
                  {
                    service: 'lunchmoney' as const,
                    label: 'LunchMoney',
                    href: 'https://my.lunchmoney.app/developers',
                    value: keyInput,
                    saved: lmApiKey,
                    placeholder: 'lm_…',
                    onChange: setKeyInput,
                    use: 'Account sync',
                  },
                  {
                    service: 'tiingo' as const,
                    label: 'Tiingo',
                    href: 'https://www.tiingo.com/account/api/token',
                    value: tiingoKeyInput,
                    saved: tiingoApiKey,
                    placeholder: 'Tiingo API key',
                    onChange: setTiingoKeyInput,
                    use: 'ETF returns and dividends',
                  },
                  {
                    service: 'fred' as const,
                    label: 'FRED',
                    href: 'https://fred.stlouisfed.org/docs/api/api_key.html',
                    value: fredKeyInput,
                    saved: fredApiKey,
                    placeholder: 'FRED API key',
                    onChange: setFredKeyInput,
                    use: 'Treasury yields, FX, CPI',
                  },
                ]).map(row => {
                  const result = testResults[row.service]
                  const isTesting = testingService === row.service
                  return (
                    <tr key={row.service}>
                      <td className="px-3 py-2 align-top">
                        <a href={row.href} target="_blank" rel="noreferrer" className="font-medium text-blue-600 dark:text-blue-400 hover:underline">
                          {row.label}
                        </a>
                      </td>
                      <td className="px-3 py-2 align-top min-w-[220px]">
                        <input
                          type="password"
                          className="w-full h-[30px] border border-gray-300 dark:border-gray-600 rounded-[5px] px-2 text-[12px] bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                          value={row.value}
                          onChange={event => {
                            row.onChange(event.target.value)
                            setSavedService(null)
                          }}
                          placeholder={row.placeholder}
                        />
                      </td>
                      <td className="px-3 py-2 align-top text-gray-500 dark:text-gray-400">{row.use}</td>
                      <td className="px-3 py-2 align-top min-w-[180px]">
                        {result ? (
                          <span className={result.ok ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400'}>
                            {result.ok ? '✓ ' : '✗ '}{result.message}
                          </span>
                        ) : row.saved ? (
                          <span className="text-green-600 dark:text-green-400">✓ Saved</span>
                        ) : savedService === row.service ? (
                          <span className="text-green-600 dark:text-green-400">✓ Saved</span>
                        ) : (
                          <span className="text-gray-400">Not configured</span>
                        )}
                      </td>
                      <td className="px-3 py-2 align-top">
                        <div className="flex justify-end gap-2">
                          <Button onClick={() => saveApiKey(row.service)} disabled={!row.value.trim()}>Save</Button>
                          <Button variant="success" onClick={() => testApiConnection(row.service)} disabled={isTesting || !row.value.trim()}>
                            {isTesting ? 'Testing…' : 'Test'}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
                <tr>
                  <td className="px-3 py-2 align-top">
                    <a href="https://dashboard.snaptrade.com/" target="_blank" rel="noreferrer" className="font-medium text-blue-600 dark:text-blue-400 hover:underline">
                      SnapTrade
                    </a>
                  </td>
                  <td className="px-3 py-2 align-top min-w-[320px]">
                    <div className="grid gap-2 md:grid-cols-2">
                      <input
                        type="password"
                        className="w-full h-[30px] border border-gray-300 dark:border-gray-600 rounded-[5px] px-2 text-[12px] bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                        value={snapTradeClientIdInput}
                        onChange={event => {
                          setSnapTradeClientIdInput(event.target.value)
                          setSavedService(null)
                        }}
                        placeholder="Client ID"
                      />
                      <input
                        type="password"
                        className="w-full h-[30px] border border-gray-300 dark:border-gray-600 rounded-[5px] px-2 text-[12px] bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                        value={snapTradeConsumerKeyInput}
                        onChange={event => {
                          setSnapTradeConsumerKeyInput(event.target.value)
                          setSavedService(null)
                        }}
                        placeholder="Consumer key"
                      />
                    </div>
                  </td>
                  <td className="px-3 py-2 align-top text-gray-500 dark:text-gray-400">
                    Brokerage holdings, positions, and tax lots
                  </td>
                  <td className="px-3 py-2 align-top min-w-[180px]">
                    {testResults.snaptrade ? (
                      <span className={testResults.snaptrade.ok ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400'}>
                        {testResults.snaptrade.ok ? '✓ ' : '✗ '}{testResults.snaptrade.message}
                      </span>
                    ) : snapTradeClientId && snapTradeConsumerKey ? (
                      <span className="text-green-600 dark:text-green-400">
                        ✓ Saved{snapTradeUserId && snapTradeUserSecret ? ' + user ready' : ''}
                      </span>
                    ) : savedService === 'snaptrade' ? (
                      <span className="text-green-600 dark:text-green-400">✓ Saved</span>
                    ) : (
                      <span className="text-gray-400">Not configured</span>
                    )}
                  </td>
                  <td className="px-3 py-2 align-top">
                    <div className="flex justify-end gap-2">
                      <Button
                        onClick={() => saveApiKey('snaptrade')}
                        disabled={!snapTradeClientIdInput.trim() || !snapTradeConsumerKeyInput.trim()}
                      >
                        Save
                      </Button>
                      <Button
                        variant="success"
                        onClick={() => testApiConnection('snaptrade')}
                        disabled={testingService === 'snaptrade' || !snapTradeClientIdInput.trim() || !snapTradeConsumerKeyInput.trim()}
                      >
                        {testingService === 'snaptrade' ? 'Testing…' : 'Test'}
                      </Button>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <hr className="border-gray-200 dark:border-gray-700" />

        {/* CORS proxy */}
        <section>
          <h2 className="text-[13px] font-medium mb-2">CORS proxy (required for account sync)</h2>
          <p className="text-[11.5px] text-gray-500 dark:text-gray-400 mb-3">
            LunchMoney's API blocks direct browser requests (CORS). A small stateless proxy is required.
            The easiest option is a free Cloudflare Worker — it takes about 2 minutes to deploy and handles
            up to 100,000 requests per day.
          </p>
          <details className="mb-3 text-[11.5px] text-gray-500 dark:text-gray-400">
            <summary className="cursor-pointer font-medium text-gray-700 dark:text-gray-300 select-none">
              How to deploy the Cloudflare Worker proxy
            </summary>
            <ol className="mt-2 ml-4 space-y-1 list-decimal">
              <li>
                Install the Wrangler CLI:{' '}
                <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">npm install -g wrangler</code>
              </li>
              <li>
                Login:{' '}
                <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">wrangler login</code>
              </li>
              <li>
                From the repo root, deploy:{' '}
                <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">cd worker && wrangler deploy</code>
              </li>
              <li>
                Copy the worker URL (e.g.{' '}
                <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">https://dinner-money-lm-proxy.&lt;you&gt;.workers.dev</code>
                ) and paste it below.
              </li>
            </ol>
            <p className="mt-2">
              The worker source is in{' '}
              <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">worker/lm-proxy.js</code>{' '}
              in the repo. It is stateless and logs nothing. For SnapTrade, the worker signs requests server-side;
              set <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">SNAPTRADE_CLIENT_ID</code> and{' '}
              <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">SNAPTRADE_CONSUMER_KEY</code> as Worker secrets for the safest setup.
            </p>
          </details>
          <div className="flex gap-2">
            <input
              type="url"
              className="flex-1 h-[34px] border border-gray-300 dark:border-gray-600 rounded-[5px] px-3 text-[12.5px] bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
              value={proxyInput}
              onChange={(e) => setProxyInput(e.target.value)}
              placeholder="https://dinner-money-lm-proxy.<you>.workers.dev"
            />
            <Button
              onClick={() => {
                setLmProxyUrl(proxyInput.trim() || null)
              }}
            >
              Save
            </Button>
          </div>
          {lmProxyUrl && (
            <div className="mt-1 text-[11px] text-green-600">✓ Proxy set: {lmProxyUrl}</div>
          )}
        </section>

        <hr className="border-gray-200 dark:border-gray-700" />

        {/* Income & Expense display */}
        <section>
          <h2 className="text-[13px] font-medium mb-1">Income & expense display</h2>
          <p className="text-[11.5px] text-gray-500 dark:text-gray-400 mb-3">
            Hide line items below this amount in the Income & Expenses page. Useful to suppress low-value monthly interest or small dividends.
          </p>
          <div className="flex items-center gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-[11px] text-gray-500">Min. transaction (EUR)</label>
              <input
                type="number"
                min="0"
                step="10"
                className="h-[32px] w-32 border border-gray-300 dark:border-gray-600 rounded-[5px] px-3 text-[12.5px] bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                value={minTransactionEUR}
                onChange={e => setMinTransactionEUR(Math.max(0, parseFloat(e.target.value) || 0))}
              />
            </div>
            <div className="text-[11px] text-gray-400 mt-4">
              Items below this threshold are hidden in Income &amp; Expenses and the net totals.
            </div>
          </div>
        </section>

        <hr className="border-gray-200 dark:border-gray-700" />

        {/* Data */}
        <section>
          <h2 className="text-[13px] font-medium mb-3">Data</h2>
          <div className="flex gap-2 flex-wrap">
            <Button onClick={exportConfig}>Export config (JSON)</Button>
            <label className="cursor-pointer">
              <span className="inline-flex items-center rounded-[5px] border border-gray-300 dark:border-gray-600 px-[10px] py-[4px] text-[11.5px] text-gray-900 dark:text-white hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer">
                Import config
              </span>
              <input type="file" accept=".json" className="hidden" onChange={importConfig} />
            </label>
            <Button
              variant="danger"
              onClick={() => { if (confirm('Reset all data? This cannot be undone.')) localStorage.clear() }}
            >
              Reset all data
            </Button>
          </div>
        </section>

        <Banner variant="info">
          All data is stored locally in your browser (localStorage). Nothing is sent to any server.
        </Banner>
      </div>
    </div>
  )
}
