import { useEffect, useState } from 'react'
import { useAppStore } from '../store/useAppStore'
import { MetricCard } from '../components/ui/MetricCard'
import { Card, CardTitle } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { PageHeader } from '../components/ui/PageHeader'
import { Badge } from '../components/ui/Badge'
import { formatCompact, formatCurrency } from '../lib/format'
import { DEFAULT_EUR_USD_RATE, convertToBase } from '../lib/currency'
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine,
  BarChart, Bar, Legend,
} from 'recharts'
import type { SimulationResult, Expense, PensionEstimate, Windfall, UserProfile, MedicalCoverage, MedicalExpense } from '../types'

// ─── Life event data ──────────────────────────────────────────────────────────

function useLifeEvents() {
  const { realEstateEvents, windfalls, pensions, profile } = useAppStore()
  const events: { year: number; label: string; color: string; emoji: string }[] = []
  const now = new Date().getFullYear()

  for (const re of realEstateEvents) {
    const y = parseInt(re.date.split('-')[0])
    const emoji = re.eventType === 'sell' ? '🏠' : re.eventType === 'buy' ? '🏡' : '🔑'
    const label = re.eventType === 'sell' ? 'Sell home' : re.eventType === 'buy' ? 'Buy home' : 'Rent'
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
  events.push({ year: profile.birthYear + 73, label: 'RMDs start', color: '#7F77DD', emoji: 'R' })
  return events
}

// ─── Net worth chart ──────────────────────────────────────────────────────────

function NetWorthTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ dataKey: string; value: number }>; label?: string }) {
  if (!active || !payload?.length) return null
  const median = payload.find(p => p.dataKey === 'median')
  if (!median) return null
  return (
    <div className="bg-gray-900 text-white text-[11px] px-3 py-2 rounded-lg shadow-lg border border-gray-700">
      <div className="text-gray-400 mb-1">Year {label}</div>
      <div className="font-medium">{formatCurrency(median.value, 'EUR')}</div>
    </div>
  )
}

function NetWorthChart({ result }: { result: SimulationResult }) {
  const data = result.years.map((y, i) => {
    const p10 = Math.max(0, Math.round(result.p10NetWorth[i]))
    const p90 = Math.max(0, Math.round(result.p90NetWorth[i]))
    return {
      year: y,
      age: String(y),
      median: Math.max(0, Math.round(result.medianNetWorth[i])),
      bandBase: p10,
      bandSize: Math.max(0, p90 - p10),
    }
  })

  const events = useLifeEvents()
  const fmt = (v: number) => formatCompact(v, 'EUR')

  return (
    <div>
      <ResponsiveContainer width="100%" height={220}>
        <AreaChart data={data} margin={{ top: 20, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="bandGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#378ADD" stopOpacity={0.25} />
              <stop offset="100%" stopColor="#378ADD" stopOpacity={0.05} />
            </linearGradient>
          </defs>
          <XAxis dataKey="age" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} interval={4} />
          <YAxis tickFormatter={fmt} tick={{ fontSize: 10 }} tickLine={false} axisLine={false} width={48} />
          <Tooltip content={<NetWorthTooltip />} />
          {/* Life event reference lines */}
          {events.map(ev => (
            <ReferenceLine
              key={`${ev.year}-${ev.label}`}
              x={String(ev.year)}
              stroke={ev.color}
              strokeDasharray="3 3"
              strokeWidth={1.5}
              label={{ value: ev.emoji, position: 'top', fontSize: 10, fill: ev.color }}
            />
          ))}
          {/* Stacked p10-p90 band */}
          <Area type="monotone" dataKey="bandBase" stackId="band" stroke="none" fill="transparent" legendType="none" />
          <Area type="monotone" dataKey="bandSize" stackId="band" stroke="none" fill="url(#bandGrad)" legendType="none" />
          <Area type="monotone" dataKey="median" stroke="#378ADD" strokeWidth={2} fill="none" dot={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

// ─── Expense helpers (shared with both charts) ────────────────────────────────

function toEUR(amount: number, currency: string): number {
  return currency.toUpperCase() === 'USD' ? amount / DEFAULT_EUR_USD_RATE : amount
}

type ExpLike = { id: string; name: string; amount: number; frequency: string; currency: string; startDate: string; endDate: string | null }

function allExpensesOf(
  expenses: Expense[],
  medicalCoverages: MedicalCoverage[],
  medicalExpenses: MedicalExpense[],
): ExpLike[] {
  return [...expenses, ...(medicalCoverages ?? []), ...(medicalExpenses ?? [])]
}

// ─── Annual I/E chart (full retirement horizon) ───────────────────────────────

function AnnualIETooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ dataKey: string; value: number; name: string }>; label?: string }) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-gray-900 text-white text-[11px] px-3 py-2 rounded-lg shadow-lg border border-gray-700">
      <div className="text-gray-400 mb-1">{label}</div>
      {payload.map(p => (
        <div key={p.dataKey} className={p.dataKey === 'income' ? 'text-green-400' : 'text-red-400'}>
          {p.name}: {formatCurrency(p.value, 'EUR')}
        </div>
      ))}
    </div>
  )
}

function AnnualIncomeExpenseChart({ result, expenses, medicalCoverages, medicalExpenses, pensions, profile }: {
  result: SimulationResult
  expenses: Expense[]
  medicalCoverages: MedicalCoverage[]
  medicalExpenses: MedicalExpense[]
  pensions: PensionEstimate[]
  profile: UserProfile
}) {
  const allExp = allExpensesOf(expenses, medicalCoverages, medicalExpenses)

  const data = result.years.filter((_, i) => i % 3 === 0).map((year) => {
    const selfAge = year - profile.birthYear
    let income = 0
    for (const p of pensions) {
      const pAge = p.person === 'self' ? selfAge : year - profile.spouseBirthYear
      if (pAge >= p.startAge) income += p.monthlyAmount * 12 * (p.currency === 'EUR' ? 1 : 1 / DEFAULT_EUR_USD_RATE)
    }
    let expense = 0
    for (const exp of allExp) {
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
        <Tooltip content={<AnnualIETooltip />} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Bar dataKey="income" name="Income" fill="#22c55e" opacity={0.7} radius={[2, 2, 0, 0]} />
        <Bar dataKey="expense" name="Expenses" fill="#ef4444" opacity={0.5} radius={[2, 2, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}

// ─── Monthly I/E chart (−6m / +6m) ───────────────────────────────────────────

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function toMonthLabel(year: number, month: number) {
  return `${MONTH_NAMES[month - 1]} ${year}`
}

interface MonthItem {
  label: string
  amount: number
  currency: string
  amountEUR: number
}

interface MonthlyPoint {
  month: string       // 'YYYY-MM'
  monthLabel: string
  income: number
  expense: number
  incomeItems: MonthItem[]
  expenseItems: MonthItem[]
}

function buildMonthlyData(
  expenses: Expense[],
  medicalCoverages: MedicalCoverage[],
  medicalExpenses: MedicalExpense[],
  pensions: PensionEstimate[],
  profile: UserProfile,
  today: Date,
  pastMonths = 6,
  futureMonths = 6,
): MonthlyPoint[] {
  const allExp = allExpensesOf(expenses, medicalCoverages, medicalExpenses)
  const points: MonthlyPoint[] = []
  const cy = today.getFullYear()
  const cm = today.getMonth() + 1

  for (let offset = -pastMonths; offset <= futureMonths; offset++) {
    const totalM = cm + offset
    const year = cy + Math.floor((totalM - 1) / 12)
    const month = ((totalM - 1) % 12) + 1
    const ym = `${year}-${String(month).padStart(2, '0')}`

    const incomeItems: MonthItem[] = []
    const expenseItems: MonthItem[] = []

    // Pensions
    for (const p of pensions) {
      const personBY = p.person === 'self' ? profile.birthYear : profile.spouseBirthYear
      const startYear = personBY + p.startAge
      if (startYear > year) continue
      incomeItems.push({ label: p.label, amount: p.monthlyAmount, currency: p.currency, amountEUR: toEUR(p.monthlyAmount, p.currency) })
    }

    // Expenses
    for (const exp of allExp) {
      const startY = parseInt(exp.startDate.split('-')[0])
      const startM = parseInt(exp.startDate.split('-')[1] ?? '1')
      const endY = exp.endDate ? parseInt(exp.endDate.split('-')[0]) : null
      const endM = exp.endDate ? parseInt(exp.endDate.split('-')[1] ?? '12') : null

      const afterStart = year > startY || (year === startY && month >= startM)
      const beforeEnd = endY === null || year < endY || (year === endY && month <= (endM ?? 12))
      if (!afterStart || !beforeEnd) continue

      if (exp.frequency === 'monthly') {
        expenseItems.push({ label: exp.name, amount: exp.amount, currency: exp.currency, amountEUR: toEUR(exp.amount, exp.currency) })
      } else if (exp.frequency === 'yearly' && month === startM) {
        expenseItems.push({ label: exp.name, amount: exp.amount, currency: exp.currency, amountEUR: toEUR(exp.amount, exp.currency) })
      } else if (exp.frequency === 'one_time' && year === startY && month === startM) {
        expenseItems.push({ label: exp.name, amount: exp.amount, currency: exp.currency, amountEUR: toEUR(exp.amount, exp.currency) })
      }
    }

    points.push({
      month: ym,
      monthLabel: toMonthLabel(year, month),
      income: Math.round(incomeItems.reduce((s, i) => s + i.amountEUR, 0)),
      expense: Math.round(expenseItems.reduce((s, i) => s + i.amountEUR, 0)),
      incomeItems,
      expenseItems,
    })
  }
  return points
}

function MonthlyTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ dataKey: string; value: number; payload: MonthlyPoint }>; label?: string }) {
  if (!active || !payload?.length) return null
  const pt = payload[0]?.payload
  if (!pt) return null
  const isIncome = payload.some(p => p.dataKey === 'income' && p.value > 0)
  const items = isIncome ? pt.incomeItems : pt.expenseItems
  return (
    <div className="bg-gray-900 text-white text-[11px] px-3 py-2 rounded-lg shadow-lg border border-gray-700 max-w-[220px]">
      <div className="text-gray-400 mb-1 font-medium">{label}</div>
      {items.slice(0, 8).map((it, i) => (
        <div key={i} className="flex justify-between gap-3">
          <span className="text-gray-300 truncate">{it.label}</span>
          <span className="text-white shrink-0">{formatCurrency(it.amount, it.currency)}</span>
        </div>
      ))}
      {items.length > 8 && <div className="text-gray-500 mt-1">+{items.length - 8} more</div>}
    </div>
  )
}

function MonthlyItemList({ items, sign, colorClass }: { items: MonthItem[]; sign: '+' | '−'; colorClass: string }) {
  if (items.length === 0) return <div className="text-[11px] text-gray-400 py-2">None</div>
  return (
    <div className="space-y-0">
      {items.map((item, i) => (
        <div key={i} className="flex justify-between items-center py-[4px] border-b border-gray-100 dark:border-gray-700 last:border-0 gap-2">
          <span className="text-[11.5px] text-gray-700 dark:text-gray-300 truncate">{item.label}</span>
          <span className={`text-[11.5px] font-medium shrink-0 ${colorClass}`}>
            {sign}{formatCurrency(item.amount, item.currency)}
          </span>
        </div>
      ))}
      <div className="text-[10px] text-gray-400 mt-1 pt-1 border-t border-gray-100 dark:border-gray-700">
        Total {sign}{formatCurrency(items.reduce((s, i) => s + i.amountEUR, 0), 'EUR')} EUR
      </div>
    </div>
  )
}

function MonthlyIEChart({ monthlyData }: { monthlyData: MonthlyPoint[] }) {
  const today = new Date()
  const currentYM = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`
  const [selected, setSelected] = useState(currentYM)

  const activePt = monthlyData.find(p => p.month === selected) ?? monthlyData[Math.floor(monthlyData.length / 2)]

  return (
    <div className="grid grid-cols-[1fr_240px] gap-4">
      <div>
        <ResponsiveContainer width="100%" height={180}>
          <BarChart
            data={monthlyData}
            margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
            onClick={d => { if (d?.activePayload?.[0]) setSelected((d.activePayload[0].payload as MonthlyPoint).month) }}
          >
            <XAxis dataKey="monthLabel" tick={{ fontSize: 9 }} tickLine={false} axisLine={false}
              tickFormatter={l => l.split(' ')[0]} />
            <YAxis tickFormatter={(v) => formatCompact(v, 'EUR')} tick={{ fontSize: 9 }} tickLine={false} axisLine={false} width={40} />
            <Tooltip content={<MonthlyTooltip />} />
            <ReferenceLine x={monthlyData.find(p => p.month === currentYM)?.monthLabel} stroke="#94a3b8" strokeDasharray="3 3" strokeWidth={1} />
            <Bar dataKey="income" name="Income" fill="#22c55e" opacity={0.7} radius={[2, 2, 0, 0]}
              onClick={(d) => setSelected((d as MonthlyPoint).month)} />
            <Bar dataKey="expense" name="Expenses" fill="#ef4444" opacity={0.5} radius={[2, 2, 0, 0]}
              onClick={(d) => setSelected((d as MonthlyPoint).month)} />
          </BarChart>
        </ResponsiveContainer>
        <p className="text-[10px] text-gray-400 mt-1">Click a bar to see details · dashed line = today</p>
      </div>

      {activePt && (
        <div className="text-[12px] space-y-3 min-w-0">
          <div className="font-medium text-[12.5px]">{activePt.monthLabel}</div>
          <div>
            <div className="text-[11px] text-green-600 font-medium mb-1">Income</div>
            <MonthlyItemList items={activePt.incomeItems} sign="+" colorClass="text-green-600" />
          </div>
          <div>
            <div className="text-[11px] text-red-500 font-medium mb-1">Expenses</div>
            <MonthlyItemList items={activePt.expenseItems} sign="−" colorClass="text-red-500" />
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Upcoming item helpers ────────────────────────────────────────────────────

interface UpcomingItem {
  key: string
  date: string
  label: string
  amount: number
  currency: string
  badge: 'recurring' | 'one_time' | 'projected' | 'windfall'
}

function buildUpcomingExpenses(
  expenses: Expense[],
  medicalCoverages: MedicalCoverage[],
  medicalExpenses: MedicalExpense[],
  today: Date,
  maxMonths = 3,
  maxItems = 10,
): UpcomingItem[] {
  const allExp = allExpensesOf(expenses, medicalCoverages, medicalExpenses)
  const items: UpcomingItem[] = []
  const cy = today.getFullYear()
  const cm = today.getMonth() + 1

  for (let i = 0; i < maxMonths; i++) {
    const totalM = cm + i
    const year = cy + Math.floor((totalM - 1) / 12)
    const month = ((totalM - 1) % 12) + 1

    for (const exp of allExp) {
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
      if (personBY + p.startAge > year) continue
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

function UpcomingPanel({ title, items, colorClass, sign, emptyMsg }: {
  title: string; items: UpcomingItem[]; colorClass: string; sign: '+' | '−'; emptyMsg: string
}) {
  return (
    <div>
      <div className="text-[11px] font-medium text-gray-500 dark:text-gray-400 mb-2">{title}</div>
      <div className="space-y-0">
        {items.length === 0 && <div className="text-[11px] text-gray-400 py-1">{emptyMsg}</div>}
        {items.map(item => {
          const [y, m] = item.date.split('-').map(Number)
          return (
            <div key={item.key} className="flex justify-between items-start py-[5px] border-b border-gray-100 dark:border-gray-700 last:border-0">
              <div className="min-w-0">
                <div className="text-[11.5px] text-gray-900 dark:text-white truncate">{item.label}</div>
                <div className="flex items-center gap-1.5 mt-[1px]">
                  <span className="text-[10px] text-gray-400">{toMonthLabel(y, m)}</span>
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
  const {
    accounts, simulationResult, simulationRunning, setSimulationRunning, setSimulationResult,
    profile, expenses, medicalCoverages, medicalExpenses, pensions, windfalls, realEstateEvents, monteCarloConfig,
  } = useAppStore()

  const includedAccounts = accounts.filter(a => a.includedInPlanning !== false)

  const netWorth = includedAccounts.reduce((sum, acc) => {
    return sum + convertToBase(acc.balance, acc.currency, profile.baseCurrency, DEFAULT_EUR_USD_RATE)
  }, 0)

  function runSimulation() {
    setSimulationRunning(true)
    const worker = new Worker(new URL('../workers/montecarlo.worker.ts', import.meta.url), { type: 'module' })
    worker.postMessage({
      config: monteCarloConfig,
      profile,
      accounts: includedAccounts,
      expenses: [...expenses, ...(medicalCoverages ?? []), ...(medicalExpenses ?? [])],
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
  const upcomingExpenses = buildUpcomingExpenses(expenses, medicalCoverages ?? [], medicalExpenses ?? [], today, 3, 10)
  const upcomingIncome = buildUpcomingIncome(pensions, windfalls, profile, today, 3, 10)
  const monthlyData = buildMonthlyData(expenses, medicalCoverages ?? [], medicalExpenses ?? [], pensions, profile, today, 6, 6)

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
            sub={`${includedAccounts.length} of ${accounts.length} accounts`}
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
            <div className="h-[220px] flex items-center justify-center text-[13px] text-gray-400">
              {simulationRunning ? 'Running simulation…' : 'Add accounts and run simulation to see projections'}
            </div>
          )}
        </Card>

        {/* Annual income vs expenses — full retirement horizon */}
        <Card>
          <CardTitle>Income vs expenses — full retirement ({profile.baseCurrency})</CardTitle>
          {result ? (
            <AnnualIncomeExpenseChart
              result={result}
              expenses={expenses}
              medicalCoverages={medicalCoverages ?? []}
              medicalExpenses={medicalExpenses ?? []}
              pensions={pensions}
              profile={profile}
            />
          ) : (
            <div className="h-[200px] flex items-center justify-center text-[13px] text-gray-400">
              Run simulation first
            </div>
          )}
        </Card>

        {/* Monthly ±6 month chart + upcoming panels */}
        <div className="grid grid-cols-[3fr_1fr_1fr] gap-3">
          <Card>
            <CardTitle>Income vs expenses — last 6m / next 6m ({profile.baseCurrency})</CardTitle>
            <MonthlyIEChart monthlyData={monthlyData} />
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
