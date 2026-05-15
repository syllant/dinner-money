import { useEffect, useMemo, useRef, useState } from 'react'
import { useAppStore } from '../store/useAppStore'
import { projectedAccountsBy } from '../lib/accountLifecycle'
import { fetchFredMonthlySeries } from '../lib/fred'
import { fetchMonthlyAdjustedReturns, TiingoRateLimitError } from '../lib/tiingo'
import type { Account, HistoricalMarketData, MonteCarloConfig, SimulationResult } from '../types'

const SIMULATION_CACHE_VERSION = 8
const SIMULATION_CACHE_TTL_MS = 24 * 60 * 60 * 1000
const SIMULATION_LATEST_CACHE_KEY = 'dinner-money:historical-simulation:latest'

const simulationMemoryCache = new Map<string, SimulationCacheEntry>()

export interface SimulationProgress {
  phase: string
  completed: number
  total: number
}

interface SimulationCacheEntry {
  savedAt: number
  result: SimulationResult
}

export type SimulationFreshness = 'fresh' | 'missing' | 'ttl-stale' | 'input-stale'

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, val]) => `${JSON.stringify(key)}:${stableStringify(val)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

function simulationCacheKey(input: unknown): string {
  let hash = 2166136261
  const text = stableStringify({ version: SIMULATION_CACHE_VERSION, input })
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return `dinner-money:historical-simulation:${(hash >>> 0).toString(16)}`
}

function accountSignature(account: Account) {
  return {
    id: account.id,
    name: account.name,
    balance: account.balance,
    currency: account.currency,
    type: account.type,
    allocation: account.allocation,
    interestRate: account.interestRate ?? null,
    includedInPlanning: account.includedInPlanning !== false,
    fxSplitEUR: account.fxSplitEUR ?? null,
    holdings: (account.holdings ?? []).map(holding => ({
      ticker: holding.ticker,
      value: holding.institutionValue,
      currency: holding.currency,
      quantity: holding.quantity,
    })).sort((a, b) => `${a.ticker ?? ''}:${a.currency}`.localeCompare(`${b.ticker ?? ''}:${b.currency}`)),
  }
}

function simulationTickers(accounts: Account[]): string[] {
  const tickers = new Set<string>()
  for (const account of accounts) {
    for (const holding of account.holdings ?? []) {
      const ticker = holding.ticker?.toUpperCase()
      if (!ticker || ticker.startsWith('CUR:')) continue
      tickers.add(ticker)
    }
  }
  return [...tickers].slice(0, 20)
}

function normalizeCacheEntry(raw: string | null): SimulationCacheEntry | null {
  if (!raw) return null
  const parsed = JSON.parse(raw) as SimulationResult | SimulationCacheEntry
  if ('result' in parsed && parsed.result) {
    return {
      savedAt: Number.isFinite(parsed.savedAt) ? parsed.savedAt : 0,
      result: parsed.result,
    }
  }
  return { savedAt: 0, result: parsed as SimulationResult }
}

function readCacheEntry(key: string): SimulationCacheEntry | null {
  const memoryCached = simulationMemoryCache.get(key)
  if (memoryCached) return memoryCached
  try {
    const entry = normalizeCacheEntry(localStorage.getItem(key))
    if (entry) simulationMemoryCache.set(key, entry)
    return entry
  } catch {
    return null
  }
}

function writeCacheEntry(key: string, result: SimulationResult) {
  const entry = { savedAt: Date.now(), result }
  simulationMemoryCache.set(key, entry)
  try {
    localStorage.setItem(key, JSON.stringify(entry))
    localStorage.setItem(SIMULATION_LATEST_CACHE_KEY, JSON.stringify({ key, savedAt: entry.savedAt }))
  } catch {}
}

function readLatestCacheEntry(currentKey: string): { key: string; entry: SimulationCacheEntry } | null {
  try {
    const latest = JSON.parse(localStorage.getItem(SIMULATION_LATEST_CACHE_KEY) ?? '{}') as { key?: string }
    if (!latest.key || latest.key === currentKey) return null
    const entry = readCacheEntry(latest.key)
    return entry ? { key: latest.key, entry } : null
  } catch {
    return null
  }
}

async function loadHistoricalMarketData(
  accounts: Account[],
  tiingoApiKey: string | null,
  fredApiKey: string | null,
  proxyUrl: string | null,
): Promise<HistoricalMarketData> {
  const monthly = new Map<string, HistoricalMarketData['monthly'][number]>()
  const dataSources: string[] = []
  const warnings: string[] = []

  const ensureMonth = (month: string) => {
    const existing = monthly.get(month)
    if (existing) return existing
    const point: HistoricalMarketData['monthly'][number] = { month }
    monthly.set(month, point)
    return point
  }

  const tickers = simulationTickers(accounts)
  if (tiingoApiKey && tickers.length > 0) {
    const settled: Array<PromiseSettledResult<Awaited<ReturnType<typeof fetchMonthlyAdjustedReturns>>>> = []
    for (let i = 0; i < tickers.length; i += 3) {
      const batch = tickers.slice(i, i + 3)
      settled.push(...await Promise.allSettled(batch.map(ticker => fetchMonthlyAdjustedReturns(tiingoApiKey, ticker, '1990-01-01', proxyUrl))))
    }
    let fetched = 0
    const failedTickers: string[] = []
    const rateLimitedTickers: string[] = []
    settled.forEach((result, index) => {
      const ticker = tickers[index]
      if (result.status === 'fulfilled') {
        fetched++
        for (const point of result.value) {
          const row = ensureMonth(point.month)
          row.etfReturns = { ...(row.etfReturns ?? {}), [ticker]: point.return }
        }
      } else {
        if (result.reason instanceof TiingoRateLimitError) rateLimitedTickers.push(ticker)
        else failedTickers.push(ticker)
      }
    })
    if (fetched > 0) dataSources.push(`Tiingo adjusted returns for ${fetched}/${tickers.length} holding tickers`)
    if (rateLimitedTickers.length > 0) {
      warnings.push(`Tiingo rate limit reached for ${rateLimitedTickers.length} ticker${rateLimitedTickers.length === 1 ? '' : 's'}; those tickers fall back to Shiller equity returns until the cache refreshes.`)
    }
    if (failedTickers.length > 0 && fetched > 0) {
      warnings.push(`Tiingo covered ${fetched}/${tickers.length} holding tickers; uncovered tickers fall back to Shiller equity returns.`)
    } else if (failedTickers.length > 0 || (rateLimitedTickers.length > 0 && fetched === 0)) {
      warnings.push('Tiingo holding returns could not be loaded; equity returns use Shiller S&P total-return proxy.')
    }
  } else if (!tiingoApiKey) {
    warnings.push('No Tiingo API key saved; equity returns use Shiller S&P total-return proxy.')
  } else {
    warnings.push('No Plaid holding tickers found; equity returns use Shiller S&P total-return proxy.')
  }

  if (fredApiKey) {
    const [dgs10, dexuseu, usCpi, frCpi] = await Promise.allSettled([
      fetchFredMonthlySeries(fredApiKey, 'DGS10', '1990-01-01', proxyUrl),
      fetchFredMonthlySeries(fredApiKey, 'EXUSEU', '1999-01-01', proxyUrl),
      fetchFredMonthlySeries(fredApiKey, 'CPIAUCSL', '1947-01-01', proxyUrl),
      fetchFredMonthlySeries(fredApiKey, 'FRACPALTT01IXOBSAM', '1990-01-01', proxyUrl),
    ])
    if (dgs10.status === 'fulfilled') {
      for (const point of dgs10.value) ensureMonth(point.month).treasuryYieldAnnual = point.value
      dataSources.push('FRED DGS10')
    } else {
      warnings.push('FRED DGS10 could not be loaded; Treasury yields use Shiller GS10.')
    }
    if (dexuseu.status === 'fulfilled') {
      for (const point of dexuseu.value) ensureMonth(point.month).usdPerEur = point.value
      dataSources.push('FRED EXUSEU')
    } else {
      warnings.push('FRED EXUSEU could not be loaded; FX uses fallback USD/EUR spot plus configured drift.')
    }
    if (usCpi.status === 'fulfilled') {
      for (const point of usCpi.value) {
        const row = ensureMonth(point.month)
        row.cpiByCountry = { ...(row.cpiByCountry ?? {}), US: point.value }
      }
      dataSources.push('FRED CPIAUCSL')
    } else {
      warnings.push('FRED US CPI could not be loaded; US-residency inflation uses Shiller CPI.')
    }
    if (frCpi.status === 'fulfilled') {
      for (const point of frCpi.value) {
        const row = ensureMonth(point.month)
        row.cpiByCountry = { ...(row.cpiByCountry ?? {}), FR: point.value }
      }
      dataSources.push('FRED FRACPALTT01IXOBSAM')
    } else {
      warnings.push('FRED France CPI could not be loaded; France-residency inflation uses Shiller CPI.')
    }
  } else {
    warnings.push('No FRED API key saved; Treasury yields use Shiller GS10 and FX uses fallback settings.')
  }

  return {
    monthly: [...monthly.values()].sort((a, b) => a.month.localeCompare(b.month)),
    dataSources,
    warnings,
  }
}

export function useHistoricalSimulation() {
  const {
    accounts, simulationResult, simulationRunning, setSimulationRunning, setSimulationResult,
    profile, expenses, medicalCoverages, medicalExpenses, pensions, windfalls, realEstateEvents,
    monteCarloConfig, taxConfig, setMonteCarloConfig, tiingoApiKey, fredApiKey, lmProxyUrl, transfers,
    liveEurUsdRate,
  } = useAppStore()
  const [simulationError, setSimulationError] = useState<string | null>(null)
  const [simulationProgress, setSimulationProgress] = useState<SimulationProgress | null>(null)
  const [displayProgressPct, setDisplayProgressPct] = useState<number | null>(null)
  const [simulationPending, setSimulationPending] = useState(false)
  const [freshness, setFreshness] = useState<SimulationFreshness>('missing')
  const runStartedAtRef = useRef<number | null>(null)
  const appliedCacheKeyRef = useRef<string | null>(null)

  const today = new Date()
  const currentMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`
  const includedAccounts = useMemo(() => projectedAccountsBy(currentMonth, {
    accounts,
    realEstateEvents,
    transfers,
    expenses,
    medicalCoverages: medicalCoverages ?? [],
    medicalExpenses: medicalExpenses ?? [],
    pensions,
    windfalls,
    taxSettlements: taxConfig.settlements ?? [],
  }), [accounts, currentMonth, expenses, medicalCoverages, medicalExpenses, pensions, realEstateEvents, taxConfig.settlements, transfers, windfalls])
  const simulationCacheInput = useMemo(() => ({
    config: monteCarloConfig,
    taxConfig,
    profile,
    accounts: includedAccounts.map(accountSignature).sort((a, b) => a.id - b.id),
    expenses,
    medicalCoverages,
    medicalExpenses,
    pensions,
    windfalls,
    realEstateEvents,
    transfers,
    currentMonth,
  }), [
    currentMonth,
    expenses,
    includedAccounts,
    medicalCoverages,
    medicalExpenses,
    monteCarloConfig,
    taxConfig,
    pensions,
    profile,
    realEstateEvents,
    transfers,
    windfalls,
  ])
  const currentSimulationCacheKey = useMemo(() => simulationCacheKey(simulationCacheInput), [simulationCacheInput])

  async function runSimulation(overrideConfig?: MonteCarloConfig) {
    const configToUse = overrideConfig || monteCarloConfig
    if (overrideConfig) {
      setMonteCarloConfig(overrideConfig)
    }
    const cacheInput = overrideConfig
      ? { ...simulationCacheInput, config: configToUse }
      : simulationCacheInput
    const cacheKey = simulationCacheKey(cacheInput)
    const cached = readCacheEntry(cacheKey)
    if (cached && Date.now() - cached.savedAt < SIMULATION_CACHE_TTL_MS) {
      appliedCacheKeyRef.current = cacheKey
      setFreshness('fresh')
      setSimulationResult(cached.result)
      setSimulationRunning(false)
      runStartedAtRef.current = null
      setSimulationPending(false)
      setSimulationProgress(null)
      setDisplayProgressPct(null)
      return
    }
    setSimulationRunning(true)
    runStartedAtRef.current = Date.now()
    setSimulationError(null)
    setSimulationPending(false)
    setDisplayProgressPct(0)
    setSimulationProgress({ phase: 'loading historical data', completed: 0, total: 100 })
    let worker: Worker | null = null
    try {
      const historicalMarketData = await loadHistoricalMarketData(includedAccounts, tiingoApiKey, fredApiKey, lmProxyUrl)
      worker = new Worker(new URL('../workers/montecarlo.worker.ts', import.meta.url), { type: 'module' })
      worker.postMessage({
        config: configToUse,
        taxConfig,
        profile,
        accounts: includedAccounts,
        expenses: [...expenses, ...(medicalCoverages ?? []), ...(medicalExpenses ?? [])],
        pensions,
        windfalls,
        realEstateEvents,
        transfers,
        eurUsdSpot: liveEurUsdRate,
        historicalMarketData,
      })
      worker.onmessage = (e) => {
        if (e.data.progress) {
          const progress = e.data.progress as SimulationProgress
          setSimulationProgress(progress)
          setDisplayProgressPct(current => Math.max(current ?? 0, Math.round(progress.completed / Math.max(1, progress.total) * 100)))
          return
        }
        if (e.data.ok) {
          const result = e.data.result as SimulationResult
          writeCacheEntry(cacheKey, result)
          appliedCacheKeyRef.current = cacheKey
          setFreshness('fresh')
          setSimulationResult(result)
          setSimulationPending(false)
          setSimulationProgress(null)
          setDisplayProgressPct(null)
        } else {
          console.warn('[Overview] Historical simulation failed:', e.data.error)
          setSimulationError(String(e.data.error ?? 'Historical simulation failed.'))
          setSimulationPending(false)
          setSimulationProgress(null)
          setDisplayProgressPct(null)
        }
        setSimulationRunning(false)
        runStartedAtRef.current = null
        worker?.terminate()
      }
      worker.onerror = (err) => {
        console.warn('[Overview] Historical simulation worker error:', err.message)
        setSimulationError(err.message || 'Historical simulation worker failed.')
        setSimulationPending(false)
        setSimulationProgress(null)
        setDisplayProgressPct(null)
        setSimulationRunning(false)
        runStartedAtRef.current = null
        worker?.terminate()
      }
    } catch (err) {
      console.warn('[Overview] Historical data load failed:', err)
      setSimulationError(err instanceof Error ? err.message : String(err))
      setSimulationPending(false)
      setSimulationProgress(null)
      setDisplayProgressPct(null)
      setSimulationRunning(false)
      runStartedAtRef.current = null
      worker?.terminate()
    }
  }

  useEffect(() => {
    if (accounts.length === 0) {
      setFreshness('missing')
      setSimulationPending(false)
      setSimulationRunning(false)
      setSimulationResult(null)
      setSimulationProgress(null)
      setDisplayProgressPct(null)
      return
    }
    const currentCached = readCacheEntry(currentSimulationCacheKey)
    if (currentCached) {
      appliedCacheKeyRef.current = currentSimulationCacheKey
      setSimulationResult(currentCached.result)
      const isFresh = Date.now() - currentCached.savedAt < SIMULATION_CACHE_TTL_MS
      setFreshness(isFresh ? 'fresh' : 'ttl-stale')
      if (isFresh) {
        setSimulationRunning(false)
        runStartedAtRef.current = null
        setSimulationPending(false)
        setSimulationProgress(null)
        setDisplayProgressPct(null)
        return
      }
    } else {
      const latest = readLatestCacheEntry(currentSimulationCacheKey)
      if (latest) {
        appliedCacheKeyRef.current = latest.key
        setSimulationResult(latest.entry.result)
        setFreshness('input-stale')
      } else {
        setFreshness('missing')
      }
    }
    const staleRunning = simulationRunning && runStartedAtRef.current == null
    if (!simulationRunning || simulationPending || staleRunning) {
      if (staleRunning) setSimulationRunning(false)
      void runSimulation()
    }
  }, [accounts.length, currentSimulationCacheKey]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (accounts.length === 0) {
      setFreshness('missing')
      setSimulationPending(false)
      setSimulationResult(null)
      return
    }
    if (appliedCacheKeyRef.current === currentSimulationCacheKey) return
    setSimulationPending(true)
    setSimulationError(null)
    setDisplayProgressPct(null)
    const latest = readLatestCacheEntry(currentSimulationCacheKey)
    if (latest) {
      appliedCacheKeyRef.current = latest.key
      setSimulationResult(latest.entry.result)
      setFreshness('input-stale')
    } else {
      setFreshness('missing')
      setSimulationResult(null)
    }
  }, [accounts.length, currentSimulationCacheKey, setSimulationResult, setSimulationRunning])

  return {
    result: simulationResult,
    includedAccounts,
    simulationError,
    simulationProgress,
    displayProgressPct,
    simulationPending,
    simulationRunning,
    freshness,
    runSimulation,
  }
}
