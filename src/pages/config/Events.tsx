import { NavLink, Navigate, useParams } from 'react-router-dom'
import { clsx } from 'clsx'
import { PageHeader } from '../../components/ui/PageHeader'
import Pensions from './Pensions'
import RealEstate from './RealEstate'
import Expenses from './Expenses'
import Windfalls from './Windfalls'
import Transfers from './Transfers'

const tabs = [
  { id: 'income', label: 'Income' },
  { id: 'expenses', label: 'Expenses' },
  { id: 'pensions', label: 'Pensions' },
  { id: 'real-estate', label: 'Real estate' },
  { id: 'transfers', label: 'Transfers' },
] as const

type EventTab = typeof tabs[number]['id']

function isEventTab(value: string | undefined): value is EventTab {
  return tabs.some(tab => tab.id === value)
}

export default function Events() {
  const { tab } = useParams()

  if (!tab) return <Navigate to="/config/events/income" replace />
  if (!isEventTab(tab)) return <Navigate to="/config/events/income" replace />

  return (
    <div>
      <PageHeader title="Events" />

      <div className="border-b border-gray-200 dark:border-gray-700 px-4 pt-3">
        <div className="flex flex-wrap gap-1">
          {tabs.map(item => (
            <NavLink
              key={item.id}
              to={`/config/events/${item.id}`}
              className={({ isActive }) => clsx(
                'px-3 py-2 text-[12px] rounded-t-[6px] border border-b-0 transition-colors',
                isActive
                  ? 'bg-white dark:bg-gray-950 border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white font-medium'
                  : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-800/60'
              )}
            >
              {item.label}
            </NavLink>
          ))}
        </div>
      </div>

      {tab === 'income' && <Windfalls showHeader={false} />}
      {tab === 'expenses' && <Expenses showHeader={false} />}
      {tab === 'pensions' && <Pensions showHeader={false} />}
      {tab === 'real-estate' && <RealEstate showHeader={false} />}
      {tab === 'transfers' && <Transfers showHeader={false} />}
    </div>
  )
}
