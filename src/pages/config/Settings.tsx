import { useState } from 'react'
import { useAppStore } from '../../store/useAppStore'
import { PageHeader } from '../../components/ui/PageHeader'
import { Button } from '../../components/ui/Button'
import { Banner } from '../../components/ui/Banner'
import { DriveSync } from '../../components/ui/DriveSync'
import { fetchCurrentUser, LunchMoneyError } from '../../lib/lunchmoney'
import { fetchFredMonthlySeries } from '../../lib/fred'
import { fetchMonthlyAdjustedReturns } from '../../lib/tiingo'
import { fetchIbkrFlexXml } from '../../lib/ibkrFlex'

type ApiService = 'lunchmoney' | 'tiingo' | 'fred' | 'ibkr-flex'

export default function Settings() {
  const {
    lmApiKey, setLmApiKey, lmProxyUrl, setLmProxyUrl,
    minTransactionEUR, setMinTransactionEUR,
    tiingoApiKey, setTiingoApiKey,
    fredApiKey, setFredApiKey,
    ibkrFlexToken, setIbkrFlexToken,
    ibkrFlexQueryId, setIbkrFlexQueryId,
  } = useAppStore()
  const [keyInput, setKeyInput] = useState(lmApiKey ?? '')
  const [proxyInput, setProxyInput] = useState(lmProxyUrl ?? '')
  const [tiingoKeyInput, setTiingoKeyInput] = useState(tiingoApiKey ?? '')
  const [fredKeyInput, setFredKeyInput] = useState(fredApiKey ?? '')
  const [ibkrFlexTokenInput, setIbkrFlexTokenInput] = useState(ibkrFlexToken ?? '')
  const [ibkrFlexQueryIdInput, setIbkrFlexQueryIdInput] = useState(ibkrFlexQueryId ?? '')
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
    if (service === 'ibkr-flex') {
      setIbkrFlexToken(ibkrFlexTokenInput.trim() || null)
      setIbkrFlexQueryId(ibkrFlexQueryIdInput.trim() || null)
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
          : ibkrFlexTokenInput.trim()
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
        if (!proxy) throw new Error('IBKR Flex requires the Cloudflare Worker proxy to avoid CORS.')
        const xml = await fetchIbkrFlexXml(proxy, ibkrFlexTokenInput.trim(), ibkrFlexQueryIdInput.trim())
        setLmProxyUrl(proxy)
        setIbkrFlexToken(ibkrFlexTokenInput.trim() || null)
        setIbkrFlexQueryId(ibkrFlexQueryIdInput.trim() || null)
        const lotRows = (xml.match(/<OpenPosition\b/g) ?? []).length
        setApiResult(service, { ok: true, message: `Flex query returned ${lotRows} open position row${lotRows === 1 ? '' : 's'}` })
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
                    <a href="https://www.interactivebrokers.com/en/software/am/am/reports/flex_queries.htm" target="_blank" rel="noreferrer" className="font-medium text-blue-600 dark:text-blue-400 hover:underline">
                      IBKR
                    </a>
                  </td>
                  <td className="px-3 py-2 align-top min-w-[320px]">
                    <div className="grid gap-2 md:grid-cols-2">
                      <input
                        type="password"
                        className="w-full h-[30px] border border-gray-300 dark:border-gray-600 rounded-[5px] px-2 text-[12px] bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                        value={ibkrFlexTokenInput}
                        onChange={event => {
                          setIbkrFlexTokenInput(event.target.value)
                          setSavedService(null)
                        }}
                        placeholder="Flex token"
                      />
                      <input
                        type="text"
                        className="w-full h-[30px] border border-gray-300 dark:border-gray-600 rounded-[5px] px-2 text-[12px] bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                        value={ibkrFlexQueryIdInput}
                        onChange={event => {
                          setIbkrFlexQueryIdInput(event.target.value)
                          setSavedService(null)
                        }}
                        placeholder="Query ID"
                      />
                    </div>
                  </td>
                  <td className="px-3 py-2 align-top text-gray-500 dark:text-gray-400">
                    Lot-level positions and cost basis
                  </td>
                  <td className="px-3 py-2 align-top min-w-[180px]">
                    {testResults['ibkr-flex'] ? (
                      <span className={testResults['ibkr-flex'].ok ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400'}>
                        {testResults['ibkr-flex'].ok ? '✓ ' : '✗ '}{testResults['ibkr-flex'].message}
                      </span>
                    ) : ibkrFlexToken && ibkrFlexQueryId ? (
                      <span className="text-green-600 dark:text-green-400">✓ Saved</span>
                    ) : savedService === 'ibkr-flex' ? (
                      <span className="text-green-600 dark:text-green-400">✓ Saved</span>
                    ) : (
                      <span className="text-gray-400">Not configured</span>
                    )}
                  </td>
                  <td className="px-3 py-2 align-top">
                    <div className="flex justify-end gap-2">
                      <Button
                        onClick={() => saveApiKey('ibkr-flex')}
                        disabled={!ibkrFlexTokenInput.trim() || !ibkrFlexQueryIdInput.trim()}
                      >
                        Save
                      </Button>
                      <Button
                        variant="success"
                        onClick={() => testApiConnection('ibkr-flex')}
                        disabled={testingService === 'ibkr-flex' || !ibkrFlexTokenInput.trim() || !ibkrFlexQueryIdInput.trim()}
                      >
                        {testingService === 'ibkr-flex' ? 'Testing…' : 'Test'}
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
              in the repo. It is stateless and logs nothing; IBKR Flex requests are proxied only to avoid browser CORS.
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

        {/* Cloud sync */}
        <section>
          <h2 className="text-[13px] font-medium mb-1">Cloud sync (Google Drive)</h2>
          <p className="text-[11.5px] text-gray-500 dark:text-gray-400 mb-3">
            Data is encrypted with AES-256-GCM in your browser before upload. Google never sees plaintext.
            The passphrase is never transmitted — only you can decrypt the backup.
          </p>
          <DriveSync />
        </section>

        <Banner variant="info">
          All data is stored locally in your browser (localStorage). Cloud sync and local export/import are in the section above.
        </Banner>
      </div>
    </div>
  )
}
