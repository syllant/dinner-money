import { useEffect, useMemo, useState, useCallback } from 'react'
import { NavLink, Link, useLocation } from 'react-router-dom'
import {
  LayoutDashboard, TrendingUp, PiggyBank,
  FileText, User, CreditCard, Clock, Home, Receipt,
  Banknote, Settings, ArrowLeftRight, CircleDollarSign,
  RefreshCw, Loader2,
} from 'lucide-react'
import { clsx } from 'clsx'
import { useAppStore } from '../../store/useAppStore'
import { fetchEcbDailyExchangeRates, type EcbDailyRatePoint } from '../../lib/ecb'
import { syncAllAccounts } from '../../lib/lmSync'
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
  { to: '/', label: 'Lifetime projection', icon: <LayoutDashboard size={13} /> },
  { to: '/investments', label: 'Investments', icon: <TrendingUp size={13} /> },
  { to: '/cash', label: 'Cash flow', icon: <PiggyBank size={13} /> },
  { to: '/currencies', label: 'Currency', icon: <CircleDollarSign size={13} /> },
]

const configItems: NavItem[] = [
  { to: '/config/profile', label: 'Profile', icon: <User size={13} /> },
  { to: '/config/accounts', label: 'Accounts', icon: <CreditCard size={13} /> },
  { to: '/config/pensions', label: 'Pensions', icon: <Clock size={13} /> },
  { to: '/config/real-estate', label: 'Real estate', icon: <Home size={13} /> },
  { to: '/config/income', label: 'Income', icon: <Banknote size={13} /> },
  { to: '/config/expenses', label: 'Expenses', icon: <Receipt size={13} /> },
  { to: '/config/transfers', label: 'Transfers', icon: <ArrowLeftRight size={13} /> },
  { to: '/config/tax', label: 'Tax', icon: <FileText size={13} /> },
]

function SidebarNavItem({ item }: { item: NavItem }) {
  const location = useLocation()
  const isActive = item.to === '/' ? location.pathname === '/' : location.pathname.startsWith(item.to)

  return (
    <NavLink
      to={item.to}
      className={clsx(
        'flex items-center gap-[7px] px-[9px] py-[6px] text-[12.5px] rounded-[5px] mx-[5px] my-[1px] transition-colors',
        isActive
          ? 'bg-white dark:bg-white/10 text-gray-900 dark:text-white font-medium'
          : 'text-gray-500 dark:text-gray-400 hover:bg-white/70 dark:hover:bg-white/5 hover:text-gray-900 dark:hover:text-gray-100'
      )}
    >
      <span className="opacity-65 flex-shrink-0">{item.icon}</span>
      {item.label}
    </NavLink>
  )
}

// Settings link + currency flag toggles in one row
function SidebarSettingsRow() {
  const location = useLocation()
  const isActive = location.pathname === '/settings' || location.pathname.startsWith('/settings/')
  const { profile, setProfile, setSimulationResult } = useAppStore()
  const currency = profile.baseCurrency
  const setCurrency = (next: 'EUR' | 'USD') => {
    setProfile({ baseCurrency: next })
    setSimulationResult(null)
  }

  return (
    <div className="flex items-center mx-[5px] my-[1px] gap-1">
      <NavLink
        to="/settings"
        className={clsx(
          'flex flex-1 items-center gap-[7px] px-[9px] py-[6px] text-[12.5px] rounded-[5px] transition-colors',
          isActive
            ? 'bg-white dark:bg-white/10 text-gray-900 dark:text-white font-medium'
            : 'text-gray-500 dark:text-gray-400 hover:bg-white/70 dark:hover:bg-white/5 hover:text-gray-900 dark:hover:text-gray-100'
        )}
      >
        <span className="opacity-65 flex-shrink-0"><Settings size={13} /></span>
        Settings
      </NavLink>
      {/* Currency pill toggle */}
      <div className="group relative flex h-[28px] shrink-0 rounded-full border border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-800 p-[2px] gap-[1px]">
        {(['EUR', 'USD'] as const).map(next => (
          <button
            key={next}
            type="button"
            onClick={() => setCurrency(next)}
            className={clsx(
              'h-[22px] w-[24px] flex items-center justify-center rounded-full text-[16px] transition-colors',
              currency === next
                ? 'bg-white dark:bg-gray-600 shadow-sm'
                : 'hover:bg-white/60 dark:hover:bg-gray-700'
            )}
          >
            {next === 'EUR' ? '🇪🇺' : '🇺🇸'}
          </button>
        ))}
        <span className="pointer-events-none absolute bottom-full right-0 mb-1.5 z-50 w-44 rounded-lg bg-gray-900 px-2.5 py-2 text-[10px] leading-[1.4] text-white opacity-0 shadow-xl transition-opacity duration-100 group-hover:opacity-100 dark:bg-gray-700">
          Base currency — switches all amounts and projections between EUR and USD.
        </span>
      </div>
    </div>
  )
}

// Sync status row with resync button
function SidebarSync({ onSyncComplete }: { onSyncComplete?: () => void }) {
  const { lmApiKey, accounts } = useAppStore()
  const [syncing, setSyncing] = useState(false)
  const [failed, setFailed] = useState(false)

  const lastSyncedAt = accounts.length > 0 && accounts[0]?.syncedAt
    ? new Date(accounts[0].syncedAt)
    : null

  const relTime = useRelativeTime(lastSyncedAt)

  async function handleSync() {
    if (!lmApiKey || syncing) return
    setSyncing(true)
    setFailed(false)
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
      onSyncComplete?.()
    } catch (err) {
      console.error('[Sidebar] Sync failed:', err)
      setFailed(true)
      setTimeout(() => setFailed(false), 4000)
    } finally {
      setSyncing(false)
    }
  }

  const statusText = syncing
    ? 'Syncing…'
    : failed
      ? 'Sync failed'
      : relTime
        ? `Last sync: ${relTime}`
        : 'Not synced'

  return (
    <div className="mx-[10px] mb-[3px] px-[9px] py-[5px] flex items-center justify-between gap-2 rounded-[5px]">
      <span className={clsx('text-[10px] leading-none', failed ? 'text-red-500 dark:text-red-400' : 'text-gray-400')}>
        {statusText}
      </span>
      <button
        type="button"
        onClick={handleSync}
        disabled={syncing || !lmApiKey}
        title="Resync all data"
        className="h-[18px] w-[18px] flex items-center justify-center rounded text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-40 transition-colors"
      >
        {syncing
          ? <Loader2 size={11} className="animate-spin" />
          : <RefreshCw size={11} />
        }
      </button>
    </div>
  )
}

type SidebarRange = '1d' | '1w' | '1m' | '1y'
const SIDEBAR_RANGE_DAYS: Record<SidebarRange, number> = { '1d': 3, '1w': 10, '1m': 35, '1y': 400 }
const SIDEBAR_RANGE_POINTS: Record<SidebarRange, number> = { '1d': 2, '1w': 7, '1m': 30, '1y': 252 }

const ECB_CACHE_KEY = 'dinner-money:ecb-fx-cache'
const ECB_CACHE_TTL = 60 * 60 * 1000 // 1 hour

interface EcbCache { rows: EcbDailyRatePoint[]; fetchedAt: string }

function makeSparkline(values: number[]): string {
  if (values.length < 2) return ''
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = Math.max(max - min, 0.0001)
  return values.map((v, i) => {
    const x = 4 + i * (144 / (values.length - 1))
    const y = 24 - ((v - min) / span) * 18
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
}

function SidebarPortfolioFx({ refreshKey = 0 }: { refreshKey?: number }) {
  const snapshot = useAppStore(s => s.portfolioSnapshot)
  const profile = useAppStore(s => s.profile)
  const lmProxyUrl = useAppStore(s => s.lmProxyUrl)
  const [fxRows, setFxRows] = useState<EcbDailyRatePoint[]>([])
  const [syncedAt, setSyncedAt] = useState<Date | null>(null)
  const [range, setRange] = useState<SidebarRange>('1w')

  const fmtCompact = (v: number) => {
    const abs = Math.abs(v)
    if (abs >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`
    if (abs >= 1_000) return `${(v / 1_000).toFixed(0)}K`
    return v.toFixed(0)
  }
  const sym = profile.baseCurrency === 'EUR' ? '€' : '$'

  // Portfolio sparkline — slice snapshot points to match range
  const rawPoints = snapshot?.points ?? []
  const portfolioPoints = useMemo(() => {
    const maxPts = SIDEBAR_RANGE_POINTS[range]
    return rawPoints.slice(-maxPts)
  }, [rawPoints, range])
  const portfolioSparkline = useMemo(() => makeSparkline(portfolioPoints.map(p => p.value)), [portfolioPoints])
  const portLastPoint = portfolioSparkline ? (() => { const p = portfolioSparkline.split(' '); return p.length ? p[p.length - 1].split(',') : null })() : null

  const todayPct = snapshot?.todayPct ?? null
  const todayAmt = snapshot?.todayAmt ?? null
  const isPortUp = todayPct != null ? todayPct >= 0 : null
  const portColor = isPortUp == null ? '#9ca3af' : isPortUp ? '#16a34a' : '#dc2626'

  // FX sparkline — fetch ECB data for the selected range
  useEffect(() => {
    let cancelled = false
    const forceRefresh = refreshKey > 0

    if (!forceRefresh) {
      try {
        const cached = JSON.parse(localStorage.getItem(ECB_CACHE_KEY) ?? 'null') as EcbCache | null
        if (cached && Date.now() - new Date(cached.fetchedAt).getTime() < ECB_CACHE_TTL) {
          setFxRows(cached.rows)
          setSyncedAt(new Date(cached.fetchedAt))
          return
        }
      } catch {}
    }

    async function loadFx() {
      const start = new Date()
      start.setDate(start.getDate() - SIDEBAR_RANGE_DAYS['1y']) // always fetch 1y to allow all ranges
      try {
        const nextRows = await fetchEcbDailyExchangeRates(start.toISOString().slice(0, 10), lmProxyUrl)
        if (!cancelled) {
          const now = new Date()
          setFxRows(nextRows)
          setSyncedAt(now)
          try { localStorage.setItem(ECB_CACHE_KEY, JSON.stringify({ rows: nextRows, fetchedAt: now.toISOString() })) } catch {}
        }
      } catch {
        try {
          const cached = JSON.parse(localStorage.getItem(ECB_CACHE_KEY) ?? 'null') as EcbCache | null
          if (cached && !cancelled) { setFxRows(cached.rows); setSyncedAt(new Date(cached.fetchedAt)) }
        } catch {}
      }
    }
    loadFx()
    return () => { cancelled = true }
  }, [lmProxyUrl, refreshKey])

  const slicedFx = useMemo(() => fxRows.slice(-SIDEBAR_RANGE_POINTS[range]), [fxRows, range])
  // Always show the most recent ECB rate regardless of selected range
  const fxLatest = fxRows.length > 0 ? fxRows[fxRows.length - 1].value : undefined
  const fxLatestDate = fxRows.length > 0 ? fxRows[fxRows.length - 1].date : undefined
  const fxFirst = slicedFx.length > 0 ? slicedFx[0].value : undefined
  // Color is always based on 7d comparison: higher than 7d ago = red (EUR strengthened), lower = green
  const fx7dAgo = useMemo(() => {
    if (fxRows.length === 0) return undefined
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 7)
    const cutoffStr = cutoff.toISOString().slice(0, 10)
    const before = fxRows.filter(r => r.date <= cutoffStr)
    return before.length > 0 ? before[before.length - 1].value : fxRows[0].value
  }, [fxRows])
  const isFxHigherThan7d = fxLatest != null && fx7dAgo != null ? fxLatest > fx7dAgo : null
  const fxColor = isFxHigherThan7d == null ? '#9ca3af' : isFxHigherThan7d ? '#dc2626' : '#16a34a'
  const fxSparkline = useMemo(() => makeSparkline(slicedFx.map(r => r.value)), [slicedFx])
  const fxLastPoint = fxSparkline ? (() => { const p = fxSparkline.split(' '); return p.length ? p[p.length - 1].split(',') : null })() : null

  return (
    <div className="mx-[10px] mb-2">
      <div className="rounded-[7px] border border-gray-200 dark:border-gray-700 bg-white/70 dark:bg-gray-800/60 overflow-hidden">
        {/* Range toggle — top right inside card */}
        <div className="flex justify-end px-[9px] pt-[6px]">
          <div className="flex rounded-[4px] overflow-hidden border border-gray-200 dark:border-gray-700">
            {(['1d', '1w', '1m', '1y'] as SidebarRange[]).map(r => (
              <button key={r} onClick={() => setRange(r)}
                className={clsx(
                  'px-[7px] py-[1.5px] text-[9px] font-medium uppercase tracking-[0.05em] transition-colors',
                  r === range
                    ? 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200'
                    : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'
                )}>
                {r}
              </button>
            ))}
          </div>
        </div>

        {/* Portfolio section */}
        <Link to="/investments" className="block px-[9px] py-[7px] hover:bg-white dark:hover:bg-gray-800 transition-colors">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[9.5px] font-medium text-gray-400 uppercase tracking-[0.06em]">Portfolio</div>
              <div className="text-[15px] font-medium tabular-nums text-gray-900 dark:text-white">
                {snapshot ? `${sym}${fmtCompact(snapshot.invested)}` : '—'}
              </div>
              {todayPct != null && (
                <div className="text-[10px] tabular-nums whitespace-nowrap" style={{ color: portColor }}>
                  {todayPct >= 0 ? '+' : ''}{(todayPct * 100).toFixed(2)}%{todayAmt != null && ` (${todayAmt >= 0 ? '+' : '−'}${sym}${fmtCompact(Math.abs(todayAmt))})`}
                </div>
              )}
            </div>
            {portfolioSparkline && (
              <svg width="76" height="30" viewBox="0 0 152 30" className="shrink-0 overflow-visible" aria-hidden="true">
                <polyline points={portfolioSparkline} fill="none" stroke={portColor} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                {portLastPoint && <circle cx={portLastPoint[0]} cy={portLastPoint[1]} r="4" fill={portColor} />}
              </svg>
            )}
          </div>
        </Link>

        {/* FX section */}
        <Link
          to="/currencies"
          aria-label={fxFirst == null ? 'EUR/USD unavailable.' : `EUR/USD. Was ${fxFirst.toFixed(4)} ${range} ago.`}
          className="block px-[9px] py-[7px] hover:bg-white dark:hover:bg-gray-800 transition-colors"
        >
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-[9.5px] font-medium text-gray-400 uppercase tracking-[0.06em]">
                EUR/USD
              </div>
              <div className="text-[15px] font-medium tabular-nums text-gray-900 dark:text-white">
                {fxLatest == null ? '—' : fxLatest.toFixed(4)}
              </div>
            </div>
            <InfoTooltip
              text={
                `ECB reference rate${syncedAt ? ` fetched ${syncedAt.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}` : ''}${fxLatestDate ? ` (${fxLatestDate})` : ''}` +
                (fxFirst != null ? `. Was ${fxFirst.toFixed(4)} ${range} ago` : '')
              }
              trigger={
                <svg width="76" height="30" viewBox="0 0 152 30" className="shrink-0 overflow-visible" aria-hidden="true">
                  <polyline points={fxSparkline} fill="none" stroke={fxColor} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                  {fxLastPoint && <circle cx={fxLastPoint[0]} cy={fxLastPoint[1]} r="4" fill={fxColor} />}
                </svg>
              }
            />
          </div>
        </Link>
      </div>
    </div>
  )
}

export function Sidebar() {
  const [fxRefreshKey, setFxRefreshKey] = useState(0)

  return (
    <div className="w-[196px] min-w-[196px] border-r border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 flex flex-col overflow-y-auto">
      {/* Logo */}
      <Link
        to="/"
        className="px-[14px] py-[13px] pb-[10px] border-b border-gray-200 dark:border-gray-700 block hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
      >
        <div className="text-[15px] font-medium text-gray-900 dark:text-white">DinnerMoney</div>
        <div className="text-[10px] text-gray-400 mt-[1px]">Retirement planner</div>
      </Link>

      {/* Insights nav */}
      <div className="px-[10px] pt-[10px] pb-[3px] text-[10px] font-medium text-gray-400 uppercase tracking-[0.06em]">
        Insights
      </div>
      {insightItems.map((item) => (
        <SidebarNavItem key={item.to} item={item} />
      ))}

      {/* Config nav */}
      <div className="px-[10px] pt-[10px] pb-[3px] text-[10px] font-medium text-gray-400 uppercase tracking-[0.06em]">
        Configuration
      </div>
      {configItems.map((item) => (
        <SidebarNavItem key={item.to} item={item} />
      ))}

      <div className="flex-1" />

      <SidebarPortfolioFx refreshKey={fxRefreshKey} />
      <SidebarSync onSyncComplete={() => setFxRefreshKey(k => k + 1)} />
      <SidebarSettingsRow />
      <div className="h-[8px]" />
    </div>
  )
}
