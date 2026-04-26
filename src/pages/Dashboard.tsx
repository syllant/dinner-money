import { useEffect } from 'react'
import { useAppStore } from '../store/useAppStore'
import { MetricCard } from '../components/ui/MetricCard'
import { Card, CardTitle } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { PageHeader } from '../components/ui/PageHeader'
import { Badge } from '../components/ui/Badge'
import { formatCompact, formatCurrency } from '../lib/format'
import { DEFAULT_EUR_USD_RATE, convertToBase } from '../lib/currency'
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  BarChart, Bar, Legend,
} from 'recharts'
import type { SimulationResult, Expense, PensionEstimate, Windfall, UserProfile } from '../types'

// ─── Life event pins ──────────────────────────────────────────────────────────

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
  const rmdYear = profile.birthYear + 73
  events.push({ year: rmdYear, label: 'RMDs start', color: '#7F77DD', emoji: 'R' })
  return events
}

// ─── Net worth chart ──────────────────────────────────────────────────────────

function NetWorthChart({ result }: { result: SimulationResult }) {
  const data = result.years.map((y, i) => {
    const p10 = Math.max(0, Math.round(result.p10NetWorth[i]))
    const p90 = Math.max(0, Math.round(result.p90NetWorth[i]))
    return {
      year: y,
      age: `${y}`,
      median: Math.max(0, Math.round(result.medianNetWorth[i])),
      bandBase: p10,
      bandSize: Math.max(0, p90 - p10),
    }
  })

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
          {/* Stacked band: transparent base (p10) + colored size (p90-p10) */}
          <Area type="monotone" dataKey="bandBase" stackId="band" stroke="none" fill="transparent" legendType="none" />
          <Area type="monotone" dataKey="bandSize" stackId="band" stroke="none" fill="url(#bandGrad)" legendType="none" />
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

// ─── Income vs expenses bar chart ─────────────────────────────────────────────

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

// ─── Upcoming item helpers ────────────────────────────────────────────────────

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function toMonthLabel(year: number, month: number) {
  return `${MONTH_NAMES[month - 1]} ${year}`
}

function toEUR(amount: number, currency: string): number {
  return currency.toUpperCase() === 'USD' ? amount / DEFAULT_EUR_USD_RATE : amount
}

interface UpcomingItem {
  key: string
  date: string       // YYYY-MM for sorting
  label: string
  amount: number
  currency: string
  badge: 'recurring' | 'one_time' | 'projected' | 'windfall'
}

function buildUpcomingExpenses(
  expenses: Expense[],
  today: Date,
  maxMonths = 3,
  maxItems = 10,
): UpcomingItem[] {
  const items: UpcomingItem[] = []
  const cy = today.getFullYear()
  const cm = today.getMonth() + 1

  for (let i = 0; i < maxMonths; i++) {
    const totalM = cm + i
    const year = cy + Math.floor((totalM - 1) / 12)
    const month = ((totalM - 1) % 12) + 1

    for (const exp of expenses) {
      const startY = parseInt(exp.startDate.split('-')[0])
      const startM = parseInt(exp.startDate.split('-')[1] ?? '1')
      const endY = exp.endDate ? parseInt(exp.endDate.split('-')[0]) : null
      const endM = exp.endDate ? parseInt(exp.endDate.split('-')[1] ?? '12') : null

      const afterStart = year > startY || (year === startY && month >= startM)
      const beforeEnd = endY === null || year < endY || (year === endY && month <= (endM ?? 12))
      if (!afterStart || !beforeEnd) continue

      const ym = `${year}-${String(month).padStart(2, '0')}`

      if (exp.frequency === 'monthly') {
        items.push({ key: `exp-${exp.id}-${ym}`, date: ym, label: exp.name, amount: exp.amount, currency: exp.currency, badge: 'recurring' })
      } else if (exp.frequency === 'yearly' && month === startM) {
        items.push({ key: `exp-${exp.id}-${year}`, date: ym, label: exp.name, amount: exp.amount, currency: exp.currency, badge: 'recurring' })
      } else if (exp.frequency === 'one_time' && year === startY && month === startM) {
        items.push({ key: `exp-${exp.id}-ot`, date: ym, label: exp.name, amount: exp.amount, currency: exp.currency, badge: 'one_time' })
      }
    }
  }

  return items.sort((a, b) => a.date.localeCompare(b.date)).slice(0, maxItems)
}

function buildUpcomingIncome(
  pensions: PensionEstimate[],
  windfalls: Windfall[],
  profile: UserProfile,
  today: Date,
  maxMonths = 3,
  maxItems = 10,
): UpcomingItem[] {
  const items: UpcomingItem[] = []
  const cy = today.getFullYear()
  const cm = today.getMonth() + 1

  for (let i = 0; i < maxMonths; i++) {
    const totalM = cm + i
    const year = cy + Math.floor((totalM - 1) / 12)
    const month = ((totalM - 1) % 12) + 1

    for (const p of pensions) {
      const personBY = p.person === 'self' ? profile.birthYear : profile.spouseBirthYear
      const startYear = personBY + p.startAge
      if (startYear > year) continue
      const ym = `${year}-${String(month).padStart(2, '0')}`
      items.push({ key: `pension-${p.id}-${ym}`, date: ym, label: p.label, amount: p.monthlyAmount, currency: p.currency, badge: 'projected' })
    }
  }

  for (const w of windfalls) {
    if (parseInt(w.date) === cy) {
      items.push({ key: `windfall-${w.id}`, date: `${cy}-01`, label: w.name, amount: w.amount, currency: w.currency, badge: 'windfall' })
    }
  }

  return items.sort((a, b) => a.date.localeCompare(b.date)).slice(0, maxItems)
}

// ─── Upcoming panel ───────────────────────────────────────────────────────────

function UpcomingPanel({
  title,
  items,
  colorClass,
  sign,
  emptyMsg,
}: {
  title: string
  items: UpcomingItem[]
  colorClass: string
  sign: '+' | '−'
  emptyMsg: string
}) {
  return (
    <div>
      <div className="text-[11px] font-medium text-gray-500 dark:text-gray-400 mb-2">{title}</div>
      <div className="space-y-0">
        {items.length === 0 && (
          <div className="text-[11px] text-gray-400 py-1">{emptyMsg}</div>
        )}
        {items.map(item => {
          const [y, m] = item.date.split('-').map(Number)
          const monthLabel = toMonthLabel(y, m)
          return (
            <div key={item.key} className="flex justify-between items-start py-[5px] border-b border-gray-100 dark:border-gray-700 last:border-0">
              <div className="min-w-0">
                <div className="text-[11.5px] text-gray-900 dark:text-white truncate">{item.label}</div>
                <div className="flex items-center gap-1.5 mt-[1px]">
                  <span className="text-[10px] text-gray-400">{monthLabel}</span>
                  {item.badge === 'recurring' && <Badge variant="warning">Recurring</Badge>}
                  {item.badge === 'one_time' && <Badge variant="neutral">One-time</Badge>}
                  {item.badge === 'projected' && <Badge variant="purple">Projected</Badge>}
                  {item.badge === 'windfall' && <Badge variant="purple">Windfall</Badge>}
                </div>
              </div>
              <span className={`text-[11.5px] font-medium shrink-0 ml-2 ${colorClass}`}>
                {sign}{formatCurrency(item.amount, item.currency)}
              </span>
            </div>
          )
        })}
      </div>
      {items.length > 0 && (
        <div className="text-[10px] text-gray-400 mt-2">
          Total: {sign}{formatCurrency(items.reduce((s, i) => s + toEUR(i.amount, i.currency), 0), 'EUR')} EUR
        </div>
      )}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const { accounts, simulationResult, simulationRunning, setSimulationRunning, setSimulationResult, profile, expenses, pensions, windfalls, realEstateEvents, monteCarloConfig } = useAppStore()

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

  useEffect(() => {
    if (accounts.length > 0 && !simulationResult && !simulationRunning) {
      runSimulation()
    }
  }, [accounts.length]) // eslint-disable-line

  const result = simulationResult
  const today = new Date()
  const upcomingExpenses = buildUpcomingExpenses(expenses, today, 3, 10)
  const upcomingIncome = buildUpcomingIncome(pensions, windfalls, profile, today, 3, 10)

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

        {/* Income / Expense chart + upcoming panels */}
        <div className="grid grid-cols-[3fr_1fr_1fr] gap-3">
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
            <UpcomingPanel
              title="Upcoming expenses (3 months)"
              items={upcomingExpenses}
              colorClass="text-red-500"
              sign="−"
              emptyMsg="No upcoming expenses"
            />
          </Card>

          <Card>
            <UpcomingPanel
              title="Upcoming income (3 months)"
              items={upcomingIncome}
              colorClass="text-green-600"
              sign="+"
              emptyMsg="No upcoming income"
            />
          </Card>
        </div>
      </div>
    </div>
  )
}
