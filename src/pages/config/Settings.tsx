import { useState } from 'react'
import { useAppStore } from '../../store/useAppStore'
import { PageHeader } from '../../components/ui/PageHeader'
import { Button } from '../../components/ui/Button'
import { Banner } from '../../components/ui/Banner'
import { fetchCurrentUser, LunchMoneyError } from '../../lib/lunchmoney'

export default function Settings() {
  const { lmApiKey, setLmApiKey, taxConfig, setTaxConfig } = useAppStore()
  const [keyInput, setKeyInput] = useState(lmApiKey ?? '')
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)

  async function testConnection() {
    if (!keyInput.trim()) return
    setTesting(true)
    setTestResult(null)
    try {
      const user = await fetchCurrentUser(keyInput.trim())
      setTestResult({ ok: true, message: `Connected as ${user.user_name} (${user.user_email})` })
      setLmApiKey(keyInput.trim())
    } catch (err) {
      const msg = err instanceof LunchMoneyError ? err.message : 'Connection failed — check your API key'
      setTestResult({ ok: false, message: msg })
    } finally {
      setTesting(false)
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
      <div className="p-4 max-w-xl space-y-6">

        {/* LM API Key */}
        <section>
          <h2 className="text-[13px] font-medium mb-2">LunchMoney connection</h2>
          <p className="text-[11.5px] text-gray-500 dark:text-gray-400 mb-3">
            Your API key is stored locally in your browser only — it is never sent to any server.
            Get yours at{' '}
            <a href="https://my.lunchmoney.app/developers" target="_blank" rel="noreferrer" className="text-blue-600 underline">
              my.lunchmoney.app/developers
            </a>.
          </p>
          <div className="flex gap-2">
            <input
              type="password"
              className="flex-1 h-[34px] border border-gray-300 dark:border-gray-600 rounded-[5px] px-3 text-[12.5px] bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              placeholder="lm_…"
            />
            <Button onClick={() => setLmApiKey(keyInput.trim())}>Save</Button>
            <Button variant="success" onClick={testConnection} disabled={testing || !keyInput.trim()}>
              {testing ? 'Testing…' : 'Test connection'}
            </Button>
          </div>
          {testResult && (
            <div className={`mt-2 text-[11.5px] ${testResult.ok ? 'text-green-600' : 'text-red-500'}`}>
              {testResult.ok ? '✓ ' : '✗ '}{testResult.message}
            </div>
          )}
        </section>

        <hr className="border-gray-200 dark:border-gray-700" />

        {/* Tax rate assumptions */}
        <section>
          <h2 className="text-[13px] font-medium mb-1">Tax rate assumptions</h2>
          <p className="text-[11.5px] text-gray-500 dark:text-gray-400 mb-3">
            Effective rates used for the Tax page estimates.
          </p>
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: '🇺🇸 US federal effective rate (%)', key: 'usFederalEffectiveRate' as const },
              { label: '🇺🇸 California effective rate (%)', key: 'usCaliforniaEffectiveRate' as const },
              { label: '🇫🇷 France combined rate — IR + PS (%)', key: 'frCombinedEffectiveRate' as const },
            ].map(({ label, key }) => (
              <div key={key} className="flex flex-col gap-1">
                <label className="text-[11px] text-gray-500 dark:text-gray-400">{label}</label>
                <input
                  type="number"
                  step="0.1"
                  className="h-[32px] border border-gray-300 dark:border-gray-600 rounded-[5px] px-3 text-[12.5px] bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                  value={taxConfig[key]}
                  onChange={(e) => setTaxConfig({ [key]: parseFloat(e.target.value) })}
                />
              </div>
            ))}
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
