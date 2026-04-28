import { useState } from 'react'
import { NavLink, Link, useLocation } from 'react-router-dom'
import {
  LayoutDashboard, TrendingUp, PiggyBank, ArrowLeftRight,
  FileText, User, CreditCard, Clock, Home, Receipt,
  Banknote, Settings, RefreshCw,
} from 'lucide-react'
import { clsx } from 'clsx'
import { useAppStore } from '../../store/useAppStore'
import { fetchAllAccounts, mapLMType } from '../../lib/lunchmoney'
import type { Account } from '../../types'

interface NavItem {
  to: string
  label: string
  icon: React.ReactNode
}

const insightItems: NavItem[] = [
  { to: '/', label: 'Overview', icon: <LayoutDashboard size={13} /> },
  { to: '/investments', label: 'Investments', icon: <TrendingUp size={13} /> },
  { to: '/cash', label: 'Cash & savings', icon: <PiggyBank size={13} /> },
  { to: '/income-expenses', label: 'Income & expenses', icon: <ArrowLeftRight size={13} /> },
  { to: '/tax', label: 'Tax', icon: <FileText size={13} /> },
]

const configItems: NavItem[] = [
  { to: '/config/profile', label: 'Profile', icon: <User size={13} /> },
  { to: '/config/accounts', label: 'Accounts', icon: <CreditCard size={13} /> },
  { to: '/config/pensions', label: 'Pensions', icon: <Clock size={13} /> },
  { to: '/config/real-estate', label: 'Real estate', icon: <Home size={13} /> },
  { to: '/config/income', label: 'Income', icon: <Banknote size={13} /> },
  { to: '/config/expenses', label: 'Expenses', icon: <Receipt size={13} /> },
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

function SyncStatus() {
  const { lmApiKey, lmProxyUrl, accounts, setAccounts } = useAppStore()
  const [syncing, setSyncing] = useState(false)

  const syncedAt = accounts[0]?.syncedAt

  async function sync() {
    if (!lmApiKey || syncing) return
    setSyncing(true)
    try {
      const { manual, synced } = await fetchAllAccounts(lmApiKey, lmProxyUrl)
      const now = new Date().toISOString()
      const mapped: Account[] = [
        ...manual.filter(a => !a.closed_on).map(a => {
          const type = mapLMType(a.type_name)
          const rawBalance = parseFloat(a.balance)
          return { id: a.id, lmId: a.id, name: a.display_name ?? a.name, balance: (type === 'loan' || type === 'credit') ? -rawBalance : rawBalance, currency: a.currency, type, allocation: { equity: 0, bonds: 0, cash: 100 }, syncedAt: now, isManual: true }
        }),
        ...synced.map(a => {
          const type = mapLMType(a.subtype || a.type)
          const rawBalance = parseFloat(a.balance)
          return { id: a.id, lmId: a.id, name: a.display_name ?? a.name, balance: (type === 'loan' || type === 'credit') ? -rawBalance : rawBalance, currency: a.currency, type, allocation: { equity: 0, bonds: 0, cash: 100 }, syncedAt: now, isManual: false }
        }),
      ]
      const existing = new Map(useAppStore.getState().accounts.map(a => [a.id, a]))
      const merged = mapped.map(a => {
        const ex = existing.get(a.id)
        if (!ex) return a
        return {
          ...a,
          allocation: ex.allocation,
          includedInPlanning: ex.includedInPlanning,
          interestRate: ex.interestRate,
          dueDate: ex.dueDate,
          fxSplitEUR: ex.fxSplitEUR,
        fxSplitEURRef: ex.fxSplitEURRef,
          ...(ex.typeOverridden ? { type: ex.type, typeOverridden: true } : {}),
        }
      })
      setAccounts(merged)
    } catch (_) {
      // silently fail — user can see details in Accounts page
    } finally {
      setSyncing(false)
    }
  }

  if (!lmApiKey) return null

  const timeStr = syncedAt
    ? new Date(syncedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : null
  const dateStr = syncedAt
    ? new Date(syncedAt).toLocaleDateString([], { month: 'short', day: 'numeric' })
    : null

  return (
    <div className="mx-[14px] mb-2 flex items-center justify-between gap-1">
      <div className="text-[10px] text-gray-400 leading-tight">
        {syncedAt ? (
          <><span className="block">{dateStr} {timeStr}</span><span className="block">{accounts.length} accounts</span></>
        ) : (
          <span>Not synced</span>
        )}
      </div>
      <button
        onClick={sync}
        disabled={syncing}
        title="Refresh accounts from LunchMoney"
        className="p-[5px] rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors disabled:opacity-40"
      >
        <RefreshCw size={11} className={syncing ? 'animate-spin' : ''} />
      </button>
    </div>
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

      {/* Sync status */}
      <SyncStatus />

      {/* Settings */}
      <SidebarNavItem item={{ to: '/settings', label: 'Settings', icon: <Settings size={13} /> }} />
      <div className="h-[8px]" />
    </div>
  )
}
