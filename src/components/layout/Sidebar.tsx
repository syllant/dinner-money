import { NavLink, Link, useLocation } from 'react-router-dom'
import {
  LayoutDashboard, TrendingUp, PiggyBank, ArrowLeftRight,
  FileText, User, CreditCard, Clock, Home, Receipt,
  Star, Activity, Settings,
} from 'lucide-react'
import { clsx } from 'clsx'

interface NavItem {
  to: string
  label: string
  icon: React.ReactNode
}

const insightItems: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: <LayoutDashboard size={13} /> },
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
  { to: '/config/expenses', label: 'Expenses', icon: <Receipt size={13} /> },
  { to: '/config/windfalls', label: 'Windfalls', icon: <Star size={13} /> },
  { to: '/config/simulation', label: 'Simulation', icon: <Activity size={13} /> },
]

function NavItem({ item }: { item: NavItem }) {
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
        <NavItem key={item.to} item={item} />
      ))}

      {/* Config nav */}
      <div className="px-[10px] pt-[10px] pb-[3px] text-[10px] font-medium text-gray-400 uppercase tracking-[0.06em]">
        Configuration
      </div>
      {configItems.map((item) => (
        <NavItem key={item.to} item={item} />
      ))}

      <div className="flex-1" />

      {/* Settings */}
      <NavItem item={{ to: '/settings', label: 'Settings', icon: <Settings size={13} /> }} />
      <div className="h-[8px]" />
    </div>
  )
}
