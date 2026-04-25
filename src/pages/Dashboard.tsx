import { useEffect } from 'react'
import { useAppStore } from '../store/useAppStore'
import { MetricCard } from '../components/ui/MetricCard'
import { Card, CardTitle } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Banner } from '../components/ui/Banner'
import { PageHeader } from '../components/ui/PageHeader'
import { formatCompact, formatCurrency } from '../lib/format'
import { DEFAULT_EUR_USD_RATE, convertToBase } from '../lib/currency'
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  BarChart, Bar, Legend,
} from 'recharts'
import type { SimulationResult } from '../types'

// Event pin data — built from store data
function useLifeEvents() {
  const { realEstateEvents, windfalls, pensions, profile } = useAppStore()
  const events: { year: number; label: string; color: string; emoji: string }[] = []
  const now = new Date().getFullYear()

  for (const re of realEstateEvents) {
    const y = parseInt(re.date.split('-')[0])
    const emoji = re.eventType === 'sell' ? '🏠' : re.eventType === 'buy' ? '🏡' : '🔑'
    const label = re.eventType === 'sell' ? 'Sell home' : re.eventType === 'buy' ? 'Buy home (FR)' : 'Rent'
    events.push({ year: y, label, color: '#16a34a', emoji })
  }
  for (const w of windfalls) {
    events.push({ year: parseInt(w.date), label: w.name, color: '#854F0B', emoji: '★' })
  }
  for (const p of pensions) {
    const person = p.person === 'self' ? profile.birthYear : profile.spouseBirthYear
    const startYear = person + p.startAge
    if (startYear > now) {
      events.push({ year: startYear, label: p.label, color: '#0F6E56', emoji: p.currency === 'EUR' ? '€' : '$' })
    }
  }
  // RMDs at 73
  const rmdYear = profile.birthYear + 73
  events.push({ year: rmdYear, label: 'RMDs start', color: '#7F77DD', emoji: 'R' })
  return events
}

function NetWorthChart({ result }: { result: SimulationResult }) {
  const data = result.years.map((y, i) => ({
    year: y,
    age: `${y}`,
    median: Math.max(0, Math.round(result.medianNetWorth[i])),
    p10: Math.max(0, Math.round(result.p10NetWorth[i])),
    p90: Math.max(0, Math.round(result.p90NetWorth[i])),
    band: [Math.max(0, Math.round(result.p10NetWorth[i])), Math.max(0, Math.round(result.p90NetWorth[i]))] as [number, number],
  }))

  const events = useLifeEvents()

  const fmt = (v: number) => formatCompact(v, 'EUR')

  return (
    <div>
      <ResponsiveContainer width="100%" height={200}>
        <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="bandGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#378ADD" stopOpacity={0.25} />
              <stop offset="100%" stopColor="#378ADD" stopOpacity={0.05} />
            </linearGradient>
          </defs>
          <XAxis dataKey="age" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} interval={4} />
          <YAxis tickFormatter={fmt} tick={{ fontSize: 10 }} tickLine={false} axisLine={false} width={48} />
          <Tooltip formatter={(v: number) => formatCurrency(v, 'EUR')} labelFormatter={(l) => `Year ${l}`} />
          <Area type="monotone" dataKey="p90" stroke="none" fill="url(#bandGrad)" />
          <Area type="monotone" dataKey="p10" stroke="none" fill="white" fillOpacity={1} />
          <Area type="monotone" dataKey="median" stroke="#378ADD" strokeWidth={2} fill="none" dot={false} />
        </AreaChart>
      </ResponsiveContainer>
      {/* Event timeline */}
      <div className="flex gap-2 flex-wrap mt-2">
        {events.map((ev, i) => (
          <div key={i} className="flex items-center gap-1 text-[10px] text-gray-500 dark:text-gray-400">
            <span className="inline-flex items-center justify-center w-4 h-4 rounded-full text-white text-[9px]"
              style={{ background: ev.color }}>{ev.emoji}</span>
            {ev.year} {ev.label}
          </div>
        ))}
      </div>
    </div>
  )
}

function IncomeExpenseChart({ result }: { result: SimulationResult }) {
  const { expenses, pensions, profile } = useAppStore()

  const data = result.years.filter((_, i) => i % 3 === 0).map((year) => {
    const selfAge = year - profile.birthYear
    let income = 0
    for (const p of pensions) {
      const pAge = p.person === 'self' ? selfAge : year - profile.spouseBirthYear
      if (pAge >= p.startAge) income += p.monthlyAmount * 12 * (p.currency === 'EUR' ? 1 : 1 / DEFAULT_EUR_USD_RATE)
    }
    let expense = 0
    for (const exp of expenses) {
      const s = parseInt(exp.startDate.split('-')[0])
      const e = exp.endDate ? parseInt(exp.endDate.split('-')[0]) : 9999
      if (year >= s && year <= e) {
        const a = exp.frequency === 'monthly' ? exp.amount * 12 : exp.amount
        expense += exp.currency === 'EUR' ? a : a / DEFAULT_EUR_USD_RATE
      }
    }
    return { year, income: Math.round(income), expense: Math.round(expense) }
  })

  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <XAxis dataKey="year" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
        <YAxis tickFormatter={(v) => formatCompact(v, 'EUR')} tick={{ fontSize: 10 }} tickLine={false} axisLine={false} width={44} />
        <Tooltip formatter={(v: number) => formatCurrency(v, 'EUR')} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Bar dataKey="income" name="Income" fill="#22c55e" opacity={0.7} radius={[2, 2, 0, 0]} />
        <Bar dataKey="expense" name="Expenses" fill="#ef4444" opacity={0.5} radius={[2, 2, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}

export default function Dashboard() {
  const { accounts, simulationResult, simulationRunning, setSimulationRunning, setSimulationResult, profile, expenses, pensions, windfalls, realEstateEvents, monteCarloConfig } = useAppStore()

  // Compute current net worth
  const netWorth = accounts.reduce((sum, acc) => {
    return sum + convertToBase(acc.balance, acc.currency, profile.baseCurrency, DEFAULT_EUR_USD_RATE)
  }, 0)

  function runSimulation() {
    setSimulationRunning(true)
    const worker = new Worker(new URL('../workers/montecarlo.worker.ts', import.meta.url), { type: 'module' })
    worker.postMessage({
      config: monteCarloConfig,
      profile,
      accounts,
      expenses,
      pensions,
      windfalls,
      realEstateEvents,
      eurUsdSpot: DEFAULT_EUR_USD_RATE,
    })
    worker.onmessage = (e) => {
      if (e.data.ok) setSimulationResult(e.data.result as SimulationResult)
      setSimulationRunning(false)
      worker.terminate()
    }
  }

  // Auto-run on first load if we have accounts
  useEffect(() => {
    if (accounts.length > 0 && !simulationResult && !simulationRunning) {
      runSimulation()
    }
  }, [accounts.length]) // eslint-disable-line

  const result = simulationResult

  return (
    <div>
      <PageHeader title="Dashboard">
        <Button onClick={runSimulation} disabled={simulationRunning} variant="success">
          {simulationRunning ? 'Running…' : 'Run simulation'}
        </Button>
      </PageHeader>

      <div className="p-4 space-y-4">
        {/* Metric cards */}
        <div className="grid grid-cols-4 gap-[9px]">
          <MetricCard
            label="Success probability"
            value={result ? `${result.successRate.toFixed(0)}%` : '—'}
            sub="Monte Carlo, 10k runs"
            valueClass={result && result.successRate >= 85 ? 'text-green-600' : result ? 'text-amber-500' : undefined}
          />
          <MetricCard
            label="Net worth today"
            value={netWorth > 0 ? formatCompact(netWorth, profile.baseCurrency) : '—'}
            sub={`${accounts.length} accounts`}
          />
          <MetricCard
            label="Median net worth (age 80)"
            value={result ? formatCompact(result.medianNetWorth[Math.min(29, result.medianNetWorth.length - 1)] ?? 0, profile.baseCurrency) : '—'}
            sub="Inflation-adjusted"
          />
          <MetricCard
            label="Safe monthly spend"
            value={result ? formatCurrency(result.safeMonthlySpend, profile.baseCurrency) : '—'}
            sub={`at ${monteCarloConfig.successThreshold}% success rate`}
          />
        </div>

        {/* Net worth chart */}
        <Card>
          <CardTitle>Projected net worth ({profile.baseCurrency}) — with life events</CardTitle>
          {result ? (
            <NetWorthChart result={result} />
          ) : (
            <div className="h-[200px] flex items-center justify-center text-[13px] text-gray-400">
              {simulationRunning ? 'Running simulation…' : 'Add accounts and run simulation to see projections'}
            </div>
          )}
        </Card>

        {/* Income / Expense + Upcoming */}
        <div className="grid grid-cols-[3fr_2fr] gap-3">
          <Card>
            <CardTitle>Income vs expenses (annual, {profile.baseCurrency})</CardTitle>
            {result ? (
              <IncomeExpenseChart result={result} />
            ) : (
              <div className="h-[200px] flex items-center justify-center text-[13px] text-gray-400">
                Run simulation first
              </div>
            )}
          </Card>

          <Card>
            <CardTitle>Upcoming expenses</CardTitle>
            <div className="space-y-0 text-[12px]">
              {expenses.slice(0, 5).map((exp) => (
                <div key={exp.id} className="flex justify-between items-start py-[5px] border-b border-gray-100 dark:border-gray-700 last:border-0">
                  <div>
                    <div className="text-gray-900 dark:text-white">{exp.name}</div>
                    <div className="text-[10px] text-gray-400">{exp.frequency}</div>
                  </div>
                  <span className="text-red-500 font-medium">
                    −{formatCurrency(exp.amount, exp.currency)}
                  </span>
                </div>
              ))}
              {expenses.length === 0 && (
                <div className="text-gray-400 py-2">No expenses configured</div>
              )}
            </div>
          </Card>
        </div>

        {/* LM spending warning placeholder */}
        {accounts.length > 0 && (
          <Banner variant="warning">
            ⚠ Connect LunchMoney to compare actual spending against your plan.{' '}
            <a href="#/settings" className="underline font-medium">Configure in Settings</a>
          </Banner>
        )}
      </div>
    </div>
  )
}
