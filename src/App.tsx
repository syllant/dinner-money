import { HashRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { AppShell } from './components/layout/AppShell'
import { useAppStore } from './store/useAppStore'
import Dashboard from './pages/Dashboard'
import Investments from './pages/Investments'
import CashSavings from './pages/CashSavings'
import IncomeExpenses from './pages/IncomeExpenses'
import Tax from './pages/Tax'
import Profile from './pages/config/Profile'
import Accounts from './pages/config/Accounts'
import Pensions from './pages/config/Pensions'
import RealEstate from './pages/config/RealEstate'
import Expenses from './pages/config/Expenses'
import Windfalls from './pages/config/Windfalls'
import Settings from './pages/config/Settings'

/** Redirects to /settings when no API key is configured yet */
function OnboardingGate({ children }: { children: React.ReactNode }) {
  const lmApiKey = useAppStore((s) => s.lmApiKey)
  const { pathname } = useLocation()
  if (!lmApiKey && pathname !== '/settings') {
    return <Navigate to="/settings" replace />
  }
  return <>{children}</>
}

export default function App() {
  return (
    <HashRouter>
      <AppShell>
        <OnboardingGate>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/investments" element={<Investments />} />
          <Route path="/cash" element={<CashSavings />} />
          <Route path="/income-expenses" element={<IncomeExpenses />} />
          <Route path="/tax" element={<Tax />} />
          <Route path="/config/profile" element={<Profile />} />
          <Route path="/config/accounts" element={<Accounts />} />
          <Route path="/config/pensions" element={<Pensions />} />
          <Route path="/config/real-estate" element={<RealEstate />} />
          <Route path="/config/income" element={<Windfalls />} />
          <Route path="/config/windfalls" element={<Windfalls />} />
          <Route path="/config/expenses" element={<Expenses />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </OnboardingGate>
      </AppShell>
    </HashRouter>
  )
}
