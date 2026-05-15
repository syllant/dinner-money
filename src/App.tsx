import { HashRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { AppShell } from './components/layout/AppShell'
import { useAppStore } from './store/useAppStore'
import Overview from './pages/Overview'
import Lifetime from './pages/Lifetime'
import Investments from './pages/Investments'
import CashFlow from './pages/CashFlow'
import Currencies from './pages/Currencies'
import Tax from './pages/Tax'
import Profile from './pages/config/Profile'
import Accounts from './pages/config/Accounts'
import Events from './pages/config/Events'
import Settings from './pages/config/Settings'

/** Redirects to Settings when no API key is configured yet */
function OnboardingGate({ children }: { children: React.ReactNode }) {
  const lmApiKey = useAppStore((s) => s.lmApiKey)
  const { pathname } = useLocation()
  if (!lmApiKey && pathname !== '/config/settings') {
    return <Navigate to="/config/settings" replace />
  }
  return <>{children}</>
}

export default function App() {
  return (
    <HashRouter>
      <AppShell>
        <OnboardingGate>
        <Routes>
          <Route path="/" element={<Overview />} />
          <Route path="/lifetime" element={<Lifetime />} />
          <Route path="/investments" element={<Investments />} />
          <Route path="/cash" element={<CashFlow />} />
          <Route path="/currencies" element={<Currencies />} />
          <Route path="/tax" element={<Navigate to="/config/tax" replace />} />
          <Route path="/config/profile" element={<Profile />} />
          <Route path="/config/accounts" element={<Accounts />} />
          <Route path="/config/tax" element={<Tax />} />
          <Route path="/config/events" element={<Events />} />
          <Route path="/config/events/:tab" element={<Events />} />
          <Route path="/config/pensions" element={<Navigate to="/config/events/pensions" replace />} />
          <Route path="/config/real-estate" element={<Navigate to="/config/events/real-estate" replace />} />
          <Route path="/config/income" element={<Navigate to="/config/events/income" replace />} />
          <Route path="/config/windfalls" element={<Navigate to="/config/events/income" replace />} />
          <Route path="/config/expenses" element={<Navigate to="/config/events/expenses" replace />} />
          <Route path="/config/transfers" element={<Navigate to="/config/events/transfers" replace />} />
          <Route path="/config/settings" element={<Settings />} />
          <Route path="/config/preferences" element={<Navigate to="/config/settings" replace />} />
          <Route path="/settings" element={<Navigate to="/config/settings" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </OnboardingGate>
      </AppShell>
    </HashRouter>
  )
}
