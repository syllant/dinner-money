import { useEffect, useMemo, useState } from 'react'
import { NavLink, Link, useLocation } from 'react-router-dom'
import {
  LayoutDashboard, TrendingUp, PiggyBank,
  FileText, User, CreditCard, Clock, Home, Receipt,
  Banknote, Settings, ArrowLeftRight, CircleDollarSign,
} from 'lucide-react'
import { clsx } from 'clsx'
import { useAppStore } from '../../store/useAppStore'
import { fetchEcbDailyExchangeRates, type EcbDailyRatePoint } from '../../lib/ecb'

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

function MainCurrencyControl() {
  const { profile, setProfile, setSimulationResult } = useAppStore()
  const currency = profile.baseCurrency
  const setCurrency = (next: 'EUR' | 'USD') => {
    setProfile({ baseCurrency: next })
    setSimulationResult(null)
  }

  return (
    <div className="mx-[10px] mb-2 px-[4px] flex items-center justify-between gap-2">
      <div className="text-[10px] font-medium text-gray-400 uppercase tracking-[0.06em]">
        Main currency
      </div>
      <div className="flex h-[26px] rounded-full border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-[2px]">
        {(['EUR', 'USD'] as const).map(next => (
          <button
            key={next}
            type="button"
            onClick={() => setCurrency(next)}
            className={clsx(
              'h-[20px] px-1.5 rounded-full text-[11px] leading-none transition-colors flex items-center gap-1',
              currency === next
                ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100'
            )}
          >
            <span>{next === 'EUR' ? '🇪🇺' : '🇺🇸'}</span>
            <span>{next}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

function SidebarFxRate() {
  const lmProxyUrl = useAppStore(s => s.lmProxyUrl)
  const [rows, setRows] = useState<EcbDailyRatePoint[]>([])

  useEffect(() => {
    let cancelled = false
    async function loadFx() {
      const start = new Date()
      start.setDate(start.getDate() - 10)
      try {
        const nextRows = await fetchEcbDailyExchangeRates(start.toISOString().slice(0, 10), lmProxyUrl)
        if (!cancelled) setRows(nextRows.slice(-7))
      } catch {
        if (!cancelled) setRows([])
      }
    }
    loadFx()
    return () => { cancelled = true }
  }, [lmProxyUrl])

  const latest = rows.length > 0 ? rows[rows.length - 1].value : undefined
  const first = rows.length > 0 ? rows[0].value : undefined
  const lowerThanWeek = latest != null && first != null ? latest < first : null
  const color = lowerThanWeek == null ? '#9ca3af' : lowerThanWeek ? '#16a34a' : '#dc2626'
  const points = useMemo(() => {
    if (rows.length === 0) return ''
    const values = rows.map(row => row.value)
    const min = Math.min(...values)
    const max = Math.max(...values)
    const span = Math.max(max - min, 0.0001)
    return rows.map((row, index) => {
      const x = rows.length === 1 ? 76 : 4 + index * (144 / (rows.length - 1))
      const y = 24 - ((row.value - min) / span) * 18
      return `${x.toFixed(1)},${y.toFixed(1)}`
    }).join(' ')
  }, [rows])
  const lastPoint = points ? points.split(' ')[points.split(' ').length - 1]?.split(',') : null

  return (
    <Link
      to="/currencies"
      aria-label={first == null ? 'EUR/USD. Last 7d rate unavailable.' : `EUR/USD. Was ${first.toFixed(4)} 7d ago.`}
      className="group mx-[10px] mb-2 px-[9px] py-[8px] rounded-[7px] border border-gray-200 dark:border-gray-700 bg-white/70 dark:bg-gray-800/60 hover:bg-white dark:hover:bg-gray-800 transition-colors block"
    >
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-[10px] font-medium text-gray-400 uppercase tracking-[0.06em] flex items-center">
            EUR/USD
          </div>
          <div className="text-[15px] font-medium tabular-nums text-gray-900 dark:text-white">
            {latest == null ? '—' : latest.toFixed(4)}
          </div>
        </div>
        <svg width="76" height="30" viewBox="0 0 152 30" className="shrink-0 overflow-visible" aria-hidden="true">
          <polyline points={points} fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          {lastPoint && <circle cx={lastPoint[0]} cy={lastPoint[1]} r="4" fill={color} />}
        </svg>
      </div>
      <span className="pointer-events-none fixed left-[10px] bottom-[74px] z-50 w-44 rounded-lg bg-gray-900 px-2.5 py-2 text-[10px] leading-[1.4] text-white opacity-0 shadow-xl transition-opacity duration-100 group-hover:opacity-100 dark:bg-gray-700">
        {first == null ? 'Last 7d rate unavailable.' : `Was ${first.toFixed(4)} 7d ago.`}
      </span>
    </Link>
  )
}

export function Sidebar() {
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

      <MainCurrencyControl />
      <SidebarFxRate />

      {/* Settings */}
      <SidebarNavItem item={{ to: '/settings', label: 'Settings', icon: <Settings size={13} /> }} />
      <div className="h-[8px]" />
    </div>
  )
}
