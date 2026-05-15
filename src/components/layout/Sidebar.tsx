import { useEffect, useMemo, useState, useCallback, useRef } from 'react'
import { NavLink, Link, useLocation } from 'react-router-dom'
import {
  LayoutDashboard, TrendingUp, PiggyBank,
  FileText, User, CreditCard, Clock, CalendarDays,
  Settings as SettingsIcon, CircleDollarSign,
  RefreshCw, Loader2, ChevronLeft, ChevronRight,
} from 'lucide-react'
import { clsx } from 'clsx'
import { useAppStore } from '../../store/useAppStore'
import { fetchEcbRatesCached, readEcbCache, isEcbMarketDay, ECB_CACHE_KEY, ECB_CACHE_TTL, type EcbDailyRatePoint, type EcbCache } from '../../lib/ecb'
import { fetchIntradayPrices, fetchIntradayFxRates, isUsMarketHours, type IntradayPricePoint } from '../../lib/tiingo'
import { fastSyncAccounts, syncAllAccounts } from '../../lib/lmSync'
import { InfoTooltip } from '../ui/InfoTooltip'

function relativeTime(date: Date): string {
  const diffMs = Date.now() - date.getTime()
  const diffSec = Math.floor(diffMs / 1000)
  if (diffSec < 60) return 'just now'
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin} min ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr} hr ago`
  const diffDay = Math.floor(diffHr / 24)
  if (diffDay < 7) return `${diffDay} day${diffDay === 1 ? '' : 's'} ago`
  return date.toLocaleString(undefined, { month: 'short', day: 'numeric' })
}

function useRelativeTime(date: Date | null): string {
  const compute = useCallback(() => (date ? relativeTime(date) : ''), [date])
  const [label, setLabel] = useState(compute)

  useEffect(() => {
    setLabel(compute())
    if (!date) return
    const id = setInterval(() => setLabel(compute()), 30_000)
    return () => clearInterval(id)
  }, [date, compute])

  return label
}

interface NavItem {
  to: string
  label: string
  icon: React.ReactNode
}

const insightItems: NavItem[] = [
  { to: '/', label: 'Overview', icon: <LayoutDashboard size={13} /> },
  { to: '/lifetime', label: 'Lifetime projection', icon: <Clock size={13} /> },
  { to: '/investments', label: 'Investments', icon: <TrendingUp size={13} /> },
  { to: '/cash', label: 'Cash flow', icon: <PiggyBank size={13} /> },
  { to: '/currencies', label: 'Currency', icon: <CircleDollarSign size={13} /> },
]

const configItems: NavItem[] = [
  { to: '/config/profile', label: 'Profile', icon: <User size={13} /> },
  { to: '/config/accounts', label: 'Accounts', icon: <CreditCard size={13} /> },
  { to: '/config/events', label: 'Events', icon: <CalendarDays size={13} /> },
  { to: '/config/tax', label: 'Tax', icon: <FileText size={13} /> },
  { to: '/config/settings', label: 'Settings', icon: <SettingsIcon size={13} /> },
]

function SidebarNavItem({ item, collapsed }: { item: NavItem; collapsed: boolean }) {
  const location = useLocation()
  const isActive = item.to === '/' ? location.pathname === '/' : location.pathname.startsWith(item.to)

  return (
    <NavLink
      to={item.to}
      title={collapsed ? item.label : undefined}
      className={clsx(
        'flex items-center py-[6px] text-[12.5px] rounded-[5px] mx-[5px] my-[1px] transition-colors',
        collapsed ? 'justify-center px-0' : 'gap-[7px] px-[9px]',
        isActive
          ? 'bg-white dark:bg-white/10 text-gray-900 dark:text-white font-medium'
          : 'text-gray-500 dark:text-gray-400 hover:bg-white/70 dark:hover:bg-white/5 hover:text-gray-900 dark:hover:text-gray-100'
      )}
    >
      <span className="opacity-65 flex-shrink-0">{item.icon}</span>
      {!collapsed && item.label}
    </NavLink>
  )
}

function SidebarCurrencyToggle({ collapsed }: { collapsed: boolean }) {
  const { profile, setProfile, setSimulationResult } = useAppStore()
  const currency = profile.baseCurrency
  const setCurrency = (next: 'EUR' | 'USD') => {
    setProfile({ baseCurrency: next })
    setSimulationResult(null)
  }

  if (collapsed) {
    return null
  }

  return (
    <div className="group relative flex h-[24px] rounded-full border border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-800 p-[2px] gap-[1px]">
      {(['EUR', 'USD'] as const).map(next => (
        <button
          key={next}
          type="button"
          onClick={() => setCurrency(next)}
          className={clsx(
            'h-[18px] w-[24px] flex items-center justify-center rounded-full text-[15px] leading-none transition-colors',
            currency === next
              ? 'bg-white dark:bg-gray-600 shadow-sm'
              : 'hover:bg-white/60 dark:hover:bg-gray-700'
          )}
        >
          {next === 'EUR' ? '🇪🇺' : '🇺🇸'}
        </button>
      ))}
      <span className="pointer-events-none absolute top-full right-0 mt-1.5 z-50 w-44 rounded-lg bg-gray-900 px-2.5 py-2 text-[10px] leading-[1.4] normal-case tracking-normal text-white opacity-0 shadow-xl transition-opacity duration-100 group-hover:opacity-100 dark:bg-gray-700">
        Base currency — switches all amounts and projections between EUR and USD.
      </span>
    </div>
  )
}

const AUTO_FAST_SYNC_TTL = 60 * 60 * 1000 // 1 hour
const AUTO_FULL_SYNC_TTL = 12 * 60 * 60 * 1000 // 12 hours

function SidebarSync({ collapsed, onSyncComplete }: { collapsed: boolean; onSyncComplete?: () => void }) {
  const { lmApiKey, fastSyncedAt, setFastSyncedAt, fullSyncedAt, setFullSyncedAt } = useAppStore()
  const [fastSyncing, setFastSyncing] = useState(false)
  const [fullSyncing, setFullSyncing] = useState(false)
  const [fastFailed, setFastFailed] = useState(false)
  const [fullFailed, setFullFailed] = useState(false)

  const lastFastSync = fastSyncedAt ? new Date(fastSyncedAt) : null
  const lastFullSync = fullSyncedAt ? new Date(fullSyncedAt) : null
  const fastRelTime = useRelativeTime(lastFastSync)
  const fullRelTime = useRelativeTime(lastFullSync)

  async function handleFastSync() {
    if (!lmApiKey || fastSyncing || fullSyncing) return
    setFastSyncing(true)
    setFastFailed(false)
    try {
      const state = useAppStore.getState()
      const merged = await fastSyncAccounts({
        lmApiKey: state.lmApiKey!,
        lmProxyUrl: state.lmProxyUrl,
        existingAccounts: state.accounts,
      })
      useAppStore.getState().setAccounts(merged)
      setFastSyncedAt(new Date().toISOString())
      onSyncComplete?.()
    } catch (err) {
      console.error('[Sidebar] Fast sync failed:', err)
      setFastFailed(true)
      setTimeout(() => setFastFailed(false), 4000)
    } finally {
      setFastSyncing(false)
    }
  }

  async function handleFullSync() {
    if (!lmApiKey || fastSyncing || fullSyncing) return
    setFullSyncing(true)
    setFullFailed(false)
    try {
      const state = useAppStore.getState()
      const merged = await syncAllAccounts({
        lmApiKey: state.lmApiKey!,
        lmProxyUrl: state.lmProxyUrl,
        ibkrFlexToken: state.ibkrFlexToken,
        ibkrFlexQueryId: state.ibkrFlexQueryId,
        existingAccounts: state.accounts,
      })
      useAppStore.getState().setAccounts(merged)
      setFullSyncedAt(new Date().toISOString())
      setFastSyncedAt(new Date().toISOString()) // full sync also refreshes balances
      onSyncComplete?.()
    } catch (err) {
      console.error('[Sidebar] Full sync failed:', err)
      setFullFailed(true)
      setTimeout(() => setFullFailed(false), 4000)
    } finally {
      setFullSyncing(false)
    }
  }

  // Auto-refresh when sync timestamps are stale, including when the app becomes visible again.
  const handleFastSyncRef = useRef(handleFastSync)
  const handleFullSyncRef = useRef(handleFullSync)
  handleFastSyncRef.current = handleFastSync
  handleFullSyncRef.current = handleFullSync
  useEffect(() => {
    function maybeSync() {
      if (document.visibilityState !== 'visible') return
      const state = useAppStore.getState()
      if (!state.lmApiKey) return
      const now = Date.now()
      const lastFull = state.fullSyncedAt ? new Date(state.fullSyncedAt).getTime() : 0
      const lastFast = state.fastSyncedAt ? new Date(state.fastSyncedAt).getTime() : 0
      if (!lastFull || now - lastFull > AUTO_FULL_SYNC_TTL) {
        handleFullSyncRef.current()
      } else if (!lastFast || now - lastFast > AUTO_FAST_SYNC_TTL) {
        handleFastSyncRef.current()
      }
    }
    maybeSync()
    document.addEventListener('visibilitychange', maybeSync)
    const id = setInterval(maybeSync, 5 * 60 * 1000)
    return () => { document.removeEventListener('visibilitychange', maybeSync); clearInterval(id) }
  }, [])

  const fastStatus = fastSyncing ? 'Syncing…' : fastFailed ? 'Failed' : fastRelTime || 'Never'
  const fullStatus = fullSyncing ? 'Syncing…' : fullFailed ? 'Failed' : fullRelTime || 'Never'
  const anySyncing = fastSyncing || fullSyncing

  if (collapsed) {
    return (
      <div className="mx-[5px] mb-[3px] flex justify-center">
        <button
          type="button"
          onClick={handleFastSync}
          disabled={anySyncing || !lmApiKey}
          title={`Fast sync: ${fastStatus}`}
          className="h-[24px] w-[24px] flex items-center justify-center rounded text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-40 transition-colors"
        >
          {fastSyncing ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
        </button>
      </div>
    )
  }

  return (
    <div className="mx-[10px] mb-[6px] rounded-[7px] border border-gray-200/80 dark:border-gray-700/80 bg-white/55 dark:bg-gray-800/45 px-[8px] py-[5px]">
      <div className="mb-[4px] text-[9px] font-medium uppercase tracking-[0.06em] text-gray-400 dark:text-gray-500">
        Sync
      </div>
      {/* Fast sync row — LM account balances */}
      <div className="flex items-center justify-between gap-2">
        <span className={clsx('text-[10px] leading-none min-w-0 truncate',
          fastFailed ? 'text-red-500 dark:text-red-400' : 'text-gray-400')}>
          <span className="text-gray-500 dark:text-gray-300">Fast</span> · {fastStatus}
        </span>
        <button
          type="button"
          onClick={handleFastSync}
          disabled={anySyncing || !lmApiKey}
          title="Fast sync: refresh LunchMoney account balances"
          className="h-[20px] w-[20px] flex-shrink-0 flex items-center justify-center rounded-full text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40 transition-colors"
        >
          {fastSyncing ? <Loader2 size={10} className="animate-spin" /> : <RefreshCw size={10} />}
        </button>
      </div>
      {/* Full sync row — Plaid holdings + IBKR Flex */}
      <div className="mt-[3px] flex items-center justify-between gap-2">
        <span className={clsx('text-[10px] leading-none min-w-0 truncate',
          fullFailed ? 'text-red-500 dark:text-red-400' : 'text-gray-400')}>
          <span className="text-gray-500 dark:text-gray-300">Full (positions)</span> · {fullStatus}
        </span>
        <button
          type="button"
          onClick={handleFullSync}
          disabled={anySyncing || !lmApiKey}
          title="Full sync: Plaid holdings + IBKR Flex NAV"
          className="h-[20px] w-[20px] flex-shrink-0 flex items-center justify-center rounded-full text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40 transition-colors"
        >
          {fullSyncing ? <Loader2 size={10} className="animate-spin" /> : <RefreshCw size={10} />}
        </button>
      </div>
    </div>
  )
}

type SidebarRange = '1d' | '1w' | '1m' | '1y'
const SIDEBAR_RANGES: SidebarRange[] = ['1d', '1w', '1m', '1y']
const SIDEBAR_RANGE_POINTS: Record<SidebarRange, number> = { '1d': 2, '1w': 7, '1m': 30, '1y': 252 }

// Sparkline helpers support nullable values (null = future/unknown slots).
// Null points are excluded from the polyline but included in x-axis scaling.
function makeSparkline(values: Array<number | null>): string {
  const nonNulls = values.filter((v): v is number => v !== null)
  if (nonNulls.length < 2) return ''
  const n = values.length
  const min = Math.min(...nonNulls)
  const max = Math.max(...nonNulls)
  const span = Math.max(max - min, 0.0001)
  return values
    .map((v, i) => {
      if (v === null) return null
      const x = 4 + i * (144 / (n - 1))
      const y = 22 - ((v - min) / span) * 18
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .filter((p): p is string => p !== null)
    .join(' ')
}

function sparklinePoint(values: Array<number | null>, idx: number): [number, number] {
  const n = values.length
  if (n < 2 || idx < 0 || idx >= n) return [4, 22]
  const v = values[idx]
  if (v === null) return [4, 22]
  const nonNulls = values.filter((val): val is number => val !== null)
  if (nonNulls.length === 0) return [4, 22]
  const min = Math.min(...nonNulls)
  const max = Math.max(...nonNulls)
  const span = Math.max(max - min, 0.0001)
  const x = 4 + idx * (144 / (n - 1))
  const y = 22 - ((v - min) / span) * 18
  return [x, y]
}

// Pad intraday points with nulls for remaining market hours so the x-axis
// spans the full trading day even before market close.
function padToMarketClose(
  points: Array<{ date: string; value: number }>,
): Array<{ date: string; value: number | null }> {
  if (points.length === 0) return []
  const last = new Date(points[points.length - 1].date)
  const month = last.getUTCMonth() // 0-indexed
  const isDST = month >= 2 && month <= 9 // Mar–Oct (EDT = UTC-4)
  const closeHourUTC = isDST ? 20 : 21   // 4 PM ET in UTC
  const nowUTC = new Date().getUTCHours()
  if (nowUTC >= closeHourUTC) return points.map(p => ({ ...p }))
  const intervalMs = points.length >= 2
    ? new Date(points[1].date).getTime() - new Date(points[0].date).getTime()
    : 3_600_000
  const result: Array<{ date: string; value: number | null }> = points.map(p => ({ ...p }))
  let next = new Date(last.getTime() + intervalMs)
  while (next.getUTCHours() < closeHourUTC) {
    result.push({ date: next.toISOString().replace('Z', '+00:00'), value: null })
    next = new Date(next.getTime() + intervalMs)
  }
  return result
}

function fmtAxisDate(dateStr: string): string {
  if (!dateStr) return ''
  if (dateStr.includes('T')) {
    const d = new Date(dateStr)
    if (isNaN(d.getTime())) return ''
    return d.toLocaleTimeString('en-US', { hour: 'numeric', hour12: true })
  }
  const d = new Date(`${dateStr}T12:00:00`)
  if (isNaN(d.getTime())) return dateStr.slice(5) ?? ''
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function RangeToggle({ range, onChange }: { range: SidebarRange; onChange: (r: SidebarRange) => void }) {
  return (
    <div className="flex rounded-[4px] overflow-hidden border border-gray-200 dark:border-gray-700">
      {SIDEBAR_RANGES.map(r => (
        <button
          key={r}
          type="button"
          onClick={e => { e.stopPropagation(); e.preventDefault(); onChange(r) }}
          className={clsx(
            'w-[20px] py-[1.5px] text-[8.5px] font-medium uppercase transition-colors',
            r === range
              ? 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200'
              : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'
          )}
        >
          {r}
        </button>
      ))}
    </div>
  )
}

function SidebarPortfolioFx({ refreshKey = 0 }: { refreshKey?: number }) {
  const snapshot = useAppStore(s => s.portfolioSnapshot)
  const profile = useAppStore(s => s.profile)
  const lmProxyUrl = useAppStore(s => s.lmProxyUrl)
  const tiingoApiKey = useAppStore(s => s.tiingoApiKey)
  const accounts = useAppStore(s => s.accounts)
  const setLiveEurUsdRate = useAppStore(s => s.setLiveEurUsdRate)

  const [fxRows, setFxRows] = useState<EcbDailyRatePoint[]>([])
  const [syncedAt, setSyncedAt] = useState<Date | null>(null)
  const [portfolioRange, setPortfolioRangeState] = useState<SidebarRange>(
    () => (localStorage.getItem('dinner-money:sidebar-portfolio-range') as SidebarRange | null) ?? '1w'
  )
  const [fxRange, setFxRangeState] = useState<SidebarRange>(
    () => (localStorage.getItem('dinner-money:sidebar-fx-range') as SidebarRange | null) ?? '1w'
  )
  const setPortfolioRange = (r: SidebarRange) => {
    setPortfolioRangeState(r)
    localStorage.setItem('dinner-money:sidebar-portfolio-range', r)
  }
  const setFxRange = (r: SidebarRange) => {
    setFxRangeState(r)
    localStorage.setItem('dinner-money:sidebar-fx-range', r)
  }
  const [portfolioHoverIdx, setPortfolioHoverIdx] = useState<number | null>(null)
  const [fxHoverIdx, setFxHoverIdx] = useState<number | null>(null)
  const [autoRefreshNonce, setAutoRefreshNonce] = useState(0)
  const [intradayPoints, setIntradayPoints] = useState<Array<{ date: string; value: number }>>([])
  const [intradayLoading, setIntradayLoading] = useState(false)
  const [intradayRefreshNonce, setIntradayRefreshNonce] = useState(0)
  const [fxIntradayPoints, setFxIntradayPoints] = useState<Array<{ date: string; value: number }>>([])
  const [fxIntradayLoading, setFxIntradayLoading] = useState(false)

  const fmtCompact = (v: number) => {
    const abs = Math.abs(v)
    if (abs >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`
    if (abs >= 1_000) return `${(v / 1_000).toFixed(0)}K`
    return v.toFixed(0)
  }
  const sym = profile.baseCurrency === 'EUR' ? '€' : '$'

  const rawPoints = snapshot?.points ?? []
  const portfolioPoints = useMemo((): Array<{ date: string; value: number | null }> => {
    if (portfolioRange === '1d' && intradayPoints.length >= 2) {
      return padToMarketClose(intradayPoints)
    }
    const maxPts = SIDEBAR_RANGE_POINTS[portfolioRange]
    return rawPoints.slice(-maxPts)
  }, [rawPoints, portfolioRange, intradayPoints])
  const portfolioValues = useMemo(() => portfolioPoints.map(p => p.value), [portfolioPoints])
  const portfolioSparkline = useMemo(() => makeSparkline(portfolioValues), [portfolioValues])
  // Index of last data point (non-null), for the dot at the current price
  const portfolioLastIdx = useMemo(
    () => portfolioValues.reduce<number>((last, v, i) => v !== null ? i : last, 0),
    [portfolioValues]
  )

  // Range gain/loss derives from the visible points, including 1d intraday, so color
  // and numeric return always agree with the sparkline.
  const rangeGainPct = useMemo(() => {
    const nonNull = portfolioPoints.filter((p): p is { date: string; value: number } => p.value != null)
    if (nonNull.length < 2 || nonNull[0].value <= 0) return null
    return (nonNull[nonNull.length - 1].value - nonNull[0].value) / nonNull[0].value
  }, [portfolioPoints])

  const rangeGainAmt = useMemo(() => {
    const nonNull = portfolioPoints.filter((p): p is { date: string; value: number } => p.value != null)
    if (nonNull.length < 2) return null
    return nonNull[nonNull.length - 1].value - nonNull[0].value
  }, [portfolioPoints])

  const isPortUp = rangeGainPct != null ? rangeGainPct >= 0 : null
  const portColor = isPortUp == null ? '#9ca3af' : isPortUp ? '#16a34a' : '#dc2626'

  useEffect(() => {
    let cancelled = false
    const force = refreshKey > 0 || autoRefreshNonce > 0
    async function load() {
      try {
        const { rows, fetchedAt } = await fetchEcbRatesCached(lmProxyUrl, force)
        if (!cancelled) {
          setFxRows(rows)
          setSyncedAt(fetchedAt)
          if (rows.length > 0) setLiveEurUsdRate(rows[rows.length - 1].value)
        }
      } catch {
        const cached = readEcbCache()
        if (cached && !cancelled) { setFxRows(cached.rows); setSyncedAt(new Date(cached.fetchedAt)) }
      }
    }
    load()
    return () => { cancelled = true }
  }, [lmProxyUrl, refreshKey, autoRefreshNonce])

  // Investable holdings (ticker → value in base currency) for 1D intraday weighting
  const fxRate = fxRows.length > 0 ? fxRows[fxRows.length - 1].value : 1.08
  const baseCurr = profile.baseCurrency.toLowerCase()
  const investableHoldings = useMemo(() => {
    const map = new Map<string, number>()
    for (const a of accounts) {
      if (a.type !== 'investment' && a.type !== 'retirement') continue
      for (const h of a.holdings ?? []) {
        if (!h.ticker || /^CUR:|^T-Bill/.test(h.ticker) || h.securityType === 'cash') continue
        const hCurr = h.currency.toLowerCase()
        const value = hCurr === baseCurr ? h.institutionValue
          : baseCurr === 'eur' ? h.institutionValue / fxRate
          : h.institutionValue * fxRate
        map.set(h.ticker.toUpperCase(), (map.get(h.ticker.toUpperCase()) ?? 0) + value)
      }
    }
    return [...map.entries()].map(([ticker, value]) => ({ ticker, value }))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts, baseCurr, Math.round(fxRate * 1000)])

  // Fetch intraday prices when 1d range is selected
  useEffect(() => {
    if (portfolioRange !== '1d' || !tiingoApiKey || investableHoldings.length === 0) {
      setIntradayPoints([])
      return
    }
    let cancelled = false
    setIntradayLoading(true)
    const tickers = [...new Set(investableHoldings.map(h => h.ticker)), 'SPY']
    Promise.allSettled(tickers.map(t => fetchIntradayPrices(tiingoApiKey, t, lmProxyUrl)))
      .then(results => {
        if (cancelled) return
        const imap = new Map<string, IntradayPricePoint[]>()
        results.forEach((r, i) => {
          if (r.status === 'fulfilled' && r.value.length > 0) imap.set(tickers[i], r.value)
        })
        const spyData = imap.get('SPY') ?? []
        if (spyData.length < 2) { setIntradayLoading(false); return }
        const latestDate = spyData[spyData.length - 1].date.slice(0, 10)
        const todaySpy = spyData.filter(p => p.date.startsWith(latestDate))
        if (todaySpy.length < 2) { setIntradayLoading(false); return }
        const baseByTicker = new Map<string, number>()
        const closeByTicker = new Map<string, Map<string, number>>()
        for (const [ticker, prices] of imap) {
          const todayPrices = prices.filter(p => p.date.startsWith(latestDate))
          if (todayPrices.length === 0) continue
          baseByTicker.set(ticker, todayPrices[0].close)
          const m = new Map<string, number>()
          for (const p of todayPrices) m.set(p.date, p.close)
          closeByTicker.set(ticker, m)
        }
        const baseInvested = snapshot?.invested ?? 0
        const points = todaySpy.map(spyPoint => {
          let totalValue = 0, weightedRet = 0
          for (const { ticker, value } of investableHoldings) {
            const close = closeByTicker.get(ticker)?.get(spyPoint.date)
            const base = baseByTicker.get(ticker)
            if (close == null || base == null || base <= 0) continue
            weightedRet += (close / base - 1) * value
            totalValue += value
          }
          const portRet = totalValue > 0 ? weightedRet / totalValue : 0
          return { date: spyPoint.date, value: Math.round(baseInvested * (1 + portRet)) }
        })
        if (!cancelled) { setIntradayPoints(points); setIntradayLoading(false) }
      })
      .catch(() => { if (!cancelled) setIntradayLoading(false) })
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [portfolioRange, tiingoApiKey, lmProxyUrl, snapshot?.invested, investableHoldings, intradayRefreshNonce])

  useEffect(() => {
    if (portfolioRange !== '1d' || !tiingoApiKey || investableHoldings.length === 0) return
    const refresh = () => {
      if (document.visibilityState === 'visible' && isUsMarketHours()) setIntradayRefreshNonce(n => n + 1)
    }
    const id = setInterval(refresh, 60_000)
    document.addEventListener('visibilitychange', refresh)
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', refresh) }
  }, [portfolioRange, tiingoApiKey, investableHoldings.length])

  // Background auto-refresh on weekdays when cache is stale
  useEffect(() => {
    function maybeRefresh() {
      if (document.visibilityState !== 'visible') return
      if (!isEcbMarketDay()) return
      try {
        const cached = JSON.parse(localStorage.getItem(ECB_CACHE_KEY) ?? 'null') as EcbCache | null
        if (cached && Date.now() - new Date(cached.fetchedAt).getTime() > ECB_CACHE_TTL) {
          setAutoRefreshNonce(n => n + 1)
        }
      } catch {}
    }
    document.addEventListener('visibilitychange', maybeRefresh)
    const id = setInterval(maybeRefresh, 10 * 60 * 1000)
    return () => { document.removeEventListener('visibilitychange', maybeRefresh); clearInterval(id) }
  }, [])

  // Fetch intraday EUR/USD from Tiingo when 1d range is selected.
  // IMPORTANT: use the latest date in the data (not new Date()) to filter today's session —
  // the same approach as the portfolio intraday above. Using new Date() causes timezone
  // mismatches (Tiingo FX timestamps may not align with local UTC date) and keeps
  // regressing. Both intraday implementations MUST stay in sync on this pattern.
  useEffect(() => {
    if (fxRange !== '1d' || !tiingoApiKey) {
      setFxIntradayPoints([])
      return
    }
    let cancelled = false
    setFxIntradayLoading(true)
    fetchIntradayFxRates(tiingoApiKey, 'eurusd', lmProxyUrl)
      .then(pts => {
        if (cancelled) return
        if (pts.length === 0) { setFxIntradayPoints([]); return }
        // Derive the reference date from the latest point in the data — avoids timezone
        // boundary mismatches with Tiingo's timestamps. Never use new Date() here.
        const latestDate = pts[pts.length - 1].date.slice(0, 10)
        // Filter to NYSE market hours so the x-axis matches the portfolio sparkline.
        // FX trades 24/5 but we only want the regular session window (~9 AM ET onward).
        // Both this and the portfolio intraday must stay in sync — see padToMarketClose.
        const isDST = (() => { const m = new Date(latestDate + 'T12:00:00Z').getUTCMonth(); return m >= 2 && m <= 9 })()
        const openHourUTC = isDST ? 14 : 15  // 10 AM ET hourly point, matching portfolio intraday
        const sessionPts = pts
          .filter(p => p.date.startsWith(latestDate) && new Date(p.date).getUTCHours() >= openHourUTC)
          .map(p => ({ date: p.date, value: p.close }))
        setFxIntradayPoints(sessionPts.length >= 2 ? sessionPts : [])
      })
      .catch(() => { if (!cancelled) setFxIntradayPoints([]) })
      .finally(() => { if (!cancelled) setFxIntradayLoading(false) })
    return () => { cancelled = true }
  }, [fxRange, tiingoApiKey, lmProxyUrl])

  const slicedFx = useMemo((): Array<{ date: string; value: number | null }> => {
    if (fxRange === '1d' && fxIntradayPoints.length >= 2) {
      const aligned = portfolioRange === '1d' && intradayPoints.length >= 2
        ? fxIntradayPoints.filter(p => p.date >= intradayPoints[0].date)
        : fxIntradayPoints
      return padToMarketClose(aligned.length >= 2 ? aligned : fxIntradayPoints)
    }
    return fxRows.slice(-SIDEBAR_RANGE_POINTS[fxRange])
  }, [fxRows, fxRange, fxIntradayPoints, portfolioRange, intradayPoints])
  const fxValues = useMemo(() => slicedFx.map(r => r.value), [slicedFx])
  const fxSparkline = useMemo(() => makeSparkline(fxValues), [fxValues])
  const fxLastIdx = useMemo(
    () => fxValues.reduce<number>((last, v, i) => v !== null ? i : last, 0),
    [fxValues]
  )

  const fxLatest = fxRows.length > 0 ? fxRows[fxRows.length - 1].value : undefined
  const fxLatestDate = fxRows.length > 0 ? fxRows[fxRows.length - 1].date : undefined
  const fxSeriesLatest = useMemo(
    () => [...slicedFx].reverse().find(r => r.value != null),
    [slicedFx]
  )
  const fxDisplayLatest = fxSeriesLatest?.value ?? fxLatest

  const fxRangeFirst = slicedFx.length > 0 ? (slicedFx[0].value ?? undefined) : undefined
  const fxColor = fxDisplayLatest == null || fxRangeFirst == null ? '#9ca3af'
    : fxDisplayLatest < fxRangeFirst ? '#16a34a'
    : '#dc2626'

  const portfolioSvgRef = useRef<SVGSVGElement>(null)
  const fxSvgRef = useRef<SVGSVGElement>(null)

  function handleSparklineMouseMove(
    e: React.MouseEvent<SVGSVGElement>,
    values: Array<number | null>,
    setIdx: (i: number | null) => void,
  ) {
    const count = values.length
    if (count < 2) return
    const rect = e.currentTarget.getBoundingClientRect()
    const svgX = ((e.clientX - rect.left) / rect.width) * 152
    const raw = (svgX - 4) * (count - 1) / 144
    let idx = Math.max(0, Math.min(count - 1, Math.round(raw)))
    // Clamp to last non-null index (don't hover over future placeholder slots)
    if (values[idx] === null) {
      idx = values.reduce<number>((last, v, i) => v !== null ? i : last, 0)
    }
    setIdx(idx)
  }

  const displayPortfolioValue = portfolioHoverIdx != null
    ? portfolioPoints[portfolioHoverIdx]?.value
    : snapshot?.invested
  const displayPortfolioLabel = portfolioHoverIdx != null
    ? fmtAxisDate(portfolioPoints[portfolioHoverIdx]?.date ?? '')
    : 'Portfolio'

  const displayFxValue = fxHoverIdx != null ? slicedFx[fxHoverIdx]?.value : fxDisplayLatest
  const displayFxLabel = fxHoverIdx != null ? fmtAxisDate(slicedFx[fxHoverIdx]?.date ?? '') : 'EUR/USD'

  const fxTooltipText = `ECB reference rate${syncedAt ? ` · fetched ${syncedAt.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}` : ''}${fxLatestDate ? ` (${fxLatestDate})` : ''}`

  return (
    <div className="mx-[10px] mb-2">
      <div className="rounded-[7px] border border-gray-200 dark:border-gray-700 bg-white/70 dark:bg-gray-800/60">

        {/* ── Portfolio section ── */}
        <div className="px-[9px] pt-[6px] pb-0">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-1 mb-[3px]">
            <div className="flex items-center gap-[4px] min-w-0">
              <div className="text-[9.5px] font-medium text-gray-400 uppercase tracking-[0.06em] whitespace-nowrap truncate">
                {displayPortfolioLabel}
              </div>
              {intradayLoading && <Loader2 size={8} className="animate-spin text-gray-400 flex-shrink-0" />}
            </div>
            <RangeToggle range={portfolioRange} onChange={setPortfolioRange} />
          </div>
        </div>
        <Link to="/investments" className="block px-[9px] pb-[8px] hover:bg-white/80 dark:hover:bg-gray-800/80 rounded-b-none transition-colors">
          <div className="flex items-baseline gap-[5px] min-w-0 overflow-hidden">
            <span className="text-[15px] font-medium tabular-nums text-gray-900 dark:text-white shrink-0">
              {displayPortfolioValue != null
                ? portfolioHoverIdx != null
                  ? `${sym}${displayPortfolioValue.toLocaleString()}`
                  : `${sym}${fmtCompact(displayPortfolioValue)}`
                : '—'}
            </span>
            {rangeGainPct != null && portfolioHoverIdx == null && (
              <span className="text-[11px] font-medium tabular-nums whitespace-nowrap shrink-0 truncate" style={{ color: portColor }}>
                {rangeGainPct >= 0 ? '+' : ''}{(rangeGainPct * 100).toFixed(2)}%
                {rangeGainAmt != null && ` (${rangeGainAmt >= 0 ? '+' : '−'}${sym}${fmtCompact(Math.abs(rangeGainAmt))})`}
              </span>
            )}
          </div>
          {portfolioSparkline && (
            <div className="mt-[5px]">
              <svg
                ref={portfolioSvgRef}
                viewBox="0 0 152 44"
                preserveAspectRatio="none"
                className="w-full"
                style={{ height: 44, display: 'block' }}
                aria-hidden="true"
                onMouseMove={e => handleSparklineMouseMove(e, portfolioValues, setPortfolioHoverIdx)}
                onMouseLeave={() => setPortfolioHoverIdx(null)}
              >
                <polyline points={portfolioSparkline} fill="none" stroke={portColor} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
                {portfolioHoverIdx == null && portfolioValues.filter(v => v !== null).length >= 2 && (() => {
                  const [lx, ly] = sparklinePoint(portfolioValues, portfolioLastIdx)
                  return <circle cx={lx} cy={ly} r="3.5" fill={portColor} vectorEffect="non-scaling-stroke" />
                })()}
                {portfolioHoverIdx != null && (() => {
                  const [hx, hy] = sparklinePoint(portfolioValues, portfolioHoverIdx)
                  return <>
                    <line x1={hx} y1={2} x2={hx} y2={25} stroke="#9ca3af" strokeWidth="0.8" strokeDasharray="2 2" vectorEffect="non-scaling-stroke" />
                    <circle cx={hx} cy={hy} r="3.5" fill={portColor} vectorEffect="non-scaling-stroke" />
                  </>
                })()}
                <line x1="4" y1="26" x2="148" y2="26" stroke="#e5e7eb" strokeWidth="0.7" vectorEffect="non-scaling-stroke" />
                {portfolioPoints.length > 0 && <>
                  <text x="4" y="39" textAnchor="start" fontSize="8" fill="#9ca3af">{fmtAxisDate(portfolioPoints[0].date)}</text>
                  <text x="148" y="39" textAnchor="end" fontSize="8" fill="#9ca3af">{fmtAxisDate(portfolioPoints[portfolioPoints.length - 1].date)}</text>
                </>}
              </svg>
            </div>
          )}
        </Link>

        <div className="mx-[9px] border-t border-gray-100 dark:border-gray-700" />

        {/* ── FX section ── */}
        <div className="px-[9px] pt-[6px] pb-0">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-1 mb-[3px]">
            <div className="flex items-center gap-[4px] min-w-0">
              <div className="text-[9.5px] font-medium text-gray-400 uppercase tracking-[0.06em] whitespace-nowrap truncate">
                {displayFxLabel}
              </div>
              {fxIntradayLoading && <Loader2 size={8} className="animate-spin text-gray-400 flex-shrink-0" />}
            </div>
            <RangeToggle range={fxRange} onChange={setFxRange} />
          </div>
        </div>
        <Link
          to="/currencies"
          aria-label={fxDisplayLatest == null ? 'EUR/USD unavailable.' : `EUR/USD ${fxDisplayLatest.toFixed(4)}`}
          className="block px-[9px] pb-[8px] hover:bg-white/80 dark:hover:bg-gray-800/80 transition-colors"
        >
          <div className="flex items-baseline gap-[6px] min-w-0" onClick={e => e.preventDefault()}>
            <InfoTooltip
              text={fxTooltipText}
              trigger={
                <span className="text-[15px] font-medium tabular-nums text-gray-900 dark:text-white shrink-0">
                  {displayFxValue == null ? '—' : displayFxValue.toFixed(4)}
                </span>
              }
            />
            {fxDisplayLatest != null && fxRangeFirst != null && fxHoverIdx == null && (
              <span className="text-[15px] font-medium tabular-nums whitespace-nowrap" style={{ color: fxColor }}>
                {(() => {
                  const pct = (fxDisplayLatest - fxRangeFirst) / fxRangeFirst * 100
                  return `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`
                })()}
              </span>
            )}
          </div>
          {fxSparkline && (
            <div className="mt-[5px]">
              <svg
                ref={fxSvgRef}
                viewBox="0 0 152 44"
                preserveAspectRatio="none"
                className="w-full"
                style={{ height: 44, display: 'block' }}
                aria-hidden="true"
                onMouseMove={e => handleSparklineMouseMove(e, fxValues, setFxHoverIdx)}
                onMouseLeave={() => setFxHoverIdx(null)}
              >
                <polyline points={fxSparkline} fill="none" stroke={fxColor} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
                {fxHoverIdx == null && fxValues.filter(v => v !== null).length >= 2 && (() => {
                  const [lx, ly] = sparklinePoint(fxValues, fxLastIdx)
                  return <circle cx={lx} cy={ly} r="3.5" fill={fxColor} vectorEffect="non-scaling-stroke" />
                })()}
                {fxHoverIdx != null && (() => {
                  const [hx, hy] = sparklinePoint(fxValues, fxHoverIdx)
                  return <>
                    <line x1={hx} y1={2} x2={hx} y2={25} stroke="#9ca3af" strokeWidth="0.8" strokeDasharray="2 2" vectorEffect="non-scaling-stroke" />
                    <circle cx={hx} cy={hy} r="3.5" fill={fxColor} vectorEffect="non-scaling-stroke" />
                  </>
                })()}
                <line x1="4" y1="26" x2="148" y2="26" stroke="#e5e7eb" strokeWidth="0.7" vectorEffect="non-scaling-stroke" />
                {slicedFx.length > 0 && <>
                  <text x="4" y="39" textAnchor="start" fontSize="8" fill="#9ca3af">{fmtAxisDate(slicedFx[0].date)}</text>
                  <text x="148" y="39" textAnchor="end" fontSize="8" fill="#9ca3af">{fmtAxisDate(slicedFx[slicedFx.length - 1].date)}</text>
                </>}
              </svg>
            </div>
          )}
        </Link>
      </div>
    </div>
  )
}

function AppLogo({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" className="flex-shrink-0">
      <rect width="32" height="32" rx="7" fill="#1e1b4b" />
      {/* Fork: 2 tines + bridge + handle */}
      <line x1="9" y1="6" x2="9" y2="13" stroke="#fbbf24" strokeWidth="2" strokeLinecap="round" />
      <line x1="13" y1="6" x2="13" y2="13" stroke="#fbbf24" strokeWidth="2" strokeLinecap="round" />
      <path d="M9 13 Q11 16.5 13 13" stroke="#fbbf24" strokeWidth="2" fill="none" strokeLinecap="round" />
      <line x1="11" y1="16.5" x2="11" y2="26" stroke="#fbbf24" strokeWidth="2" strokeLinecap="round" />
      {/* Ascending trend line */}
      <polyline points="19,25 23,18 28,11" stroke="#fbbf24" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="28" cy="11" r="2.2" fill="#fbbf24" />
    </svg>
  )
}

export function Sidebar() {
  const [fxRefreshKey, setFxRefreshKey] = useState(0)
  const [collapsed, setCollapsed] = useState(() =>
    localStorage.getItem('dinner-money:sidebar-collapsed') === 'true'
  )

  useEffect(() => {
    localStorage.setItem('dinner-money:sidebar-collapsed', String(collapsed))
  }, [collapsed])

  return (
    <div className={clsx(
      'border-r border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 flex flex-col overflow-y-auto transition-[width,min-width] duration-200',
      collapsed ? 'w-[48px] min-w-[48px]' : 'w-[196px] min-w-[196px]'
    )}>
      {/* Logo row */}
      <div className="border-b border-gray-200 dark:border-gray-700 flex items-center px-[10px] py-[11px] gap-[6px]">
        {collapsed ? (
          <button
            type="button"
            onClick={() => setCollapsed(false)}
            title="Expand sidebar"
            className="flex items-center justify-center w-full text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
          >
            <ChevronRight size={15} />
          </button>
        ) : (
          <>
            <Link to="/" className="flex items-center gap-[8px] hover:opacity-80 transition-opacity min-w-0 flex-1">
              <AppLogo size={22} />
              <div className="text-[15px] font-medium text-gray-900 dark:text-white truncate">DinnerMoney</div>
            </Link>
            <button
              type="button"
              onClick={() => setCollapsed(true)}
              title="Collapse sidebar"
              className="h-[22px] w-[22px] flex items-center justify-center rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors flex-shrink-0"
            >
              <ChevronLeft size={14} />
            </button>
          </>
        )}
      </div>

      {/* Insights nav */}
      {!collapsed && (
        <div className="flex items-center justify-between px-[10px] pt-[8px] pb-[3px]">
          <span className="text-[10px] font-medium text-gray-400 uppercase tracking-[0.06em]">Insights</span>
          <SidebarCurrencyToggle collapsed={collapsed} />
        </div>
      )}
      {collapsed && <div className="h-[6px]" />}
      {insightItems.map((item) => (
        <SidebarNavItem key={item.to} item={item} collapsed={collapsed} />
      ))}

      {/* Config nav */}
      {!collapsed && (
        <div className="px-[10px] pt-[10px] pb-[3px] text-[10px] font-medium text-gray-400 uppercase tracking-[0.06em]">
          Configuration
        </div>
      )}
      {collapsed && <div className="h-[4px]" />}
      {configItems.map((item) => (
        <SidebarNavItem key={item.to} item={item} collapsed={collapsed} />
      ))}

      <div className="flex-1" />

      {/* Portfolio / FX panel — hidden when collapsed */}
      {!collapsed && (
        <SidebarPortfolioFx refreshKey={fxRefreshKey} />
      )}

      <SidebarSync collapsed={collapsed} onSyncComplete={() => setFxRefreshKey(k => k + 1)} />

    </div>
  )
}
