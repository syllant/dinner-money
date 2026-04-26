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
  BarChart, Bar, Legend, Cell, ReferenceArea,
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
          <Area type="monotone" dataKey="bandBase" stackId="band" stroke="none" fill="transparent" legendType="none" />
          <Area type="monotone" dataKey="bandSize" stackId="band" stroke="none" fill="url(#bandGrad)" legendType="none" />
          <Area type="monotone" dataKey="median" stroke="#378ADD" strokeWidth={2} fill="none" dot={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

// ─── Expense helpers ──────────────────────────────────────────────────────────

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

// ─── Annual I/E chart ─────────────────────────────────────────────────────────

interface AnnualItem { label: string; amount: number; currency: string }

interface AnnualPoint {
  year: number
  income: number
  expense: number
  incomeItems: AnnualItem[]
  expenseItems: AnnualItem[]
}

function AnnualIETooltip({ active, payload }: {
  active?: boolean
  payload?: Array<{ dataKey: string; value: number; payload: AnnualPoint }>
}) {
  if (!active || !payload?.length) return null
  const pt = payload[0]?.payload
  if (!pt) return null
  return (
    <div className="bg-gray-900 text-white text-[11px] px-3 py-2 rounded-lg shadow-lg border border-gray-700 max-w-[210px]">
      <div className="font-semibold text-[12px] mb-2 pb-1 border-b border-gray-700">{pt.year}</div>
      {pt.incomeItems.length > 0 && (
        <div className="mb-2">
          <div className="text-green-400 text-[10px] font-medium mb-1">Income</div>
          {pt.incomeItems.slice(0, 4).map((it, i) => (
            <div key={i} className="flex items-start gap-1">
              <span className="text-gray-500 shrink-0">•</span>
              <span className="text-gray-300 flex-1 min-w-0 truncate">{it.label}</span>
              <span className="text-white shrink-0 ml-2">{formatCurrency(it.amount, it.currency)}</span>
            </div>
          ))}
          {pt.incomeItems.length > 4 && <div className="text-gray-500">+{pt.incomeItems.length - 4} more</div>}
        </div>
      )}
      {pt.expenseItems.length > 0 && (
        <div>
          <div className="text-red-400 text-[10px] font-medium mb-1">Expenses</div>
          {pt.expenseItems.slice(0, 4).map((it, i) => (
            <div key={i} className="flex items-start gap-1">
              <span className="text-gray-500 shrink-0">•</span>
              <span className="text-gray-300 flex-1 min-w-0 truncate">{it.label}</span>
              <span className="text-white shrink-0 ml-2">{formatCurrency(it.amount, it.currency)}</span>
            </div>
          ))}
          {pt.expenseItems.length > 4 && <div className="text-gray-500">+{pt.expenseItems.length - 4} more</div>}
        </div>
      )}
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

  const data: AnnualPoint[] = result.years.filter((_, i) => i % 3 === 0).map((year) => {
    const selfAge = year - profile.birthYear
    const incomeItems: AnnualItem[] = []
    const expenseItems: AnnualItem[] = []

    for (const p of pensions) {
      const pAge = p.person === 'self' ? selfAge : year - profile.spouseBirthYear
      if (pAge >= p.startAge) {
        incomeItems.push({ label: p.label, amount: p.monthlyAmount * 12, currency: p.currency })
      }
    }

    for (const exp of allExp) {
      const s = parseInt(exp.startDate.split('-')[0])
      const e = exp.endDate ? parseInt(exp.endDate.split('-')[0]) : 9999
      if (year >= s && year <= e) {
        const a = exp.frequency === 'monthly' ? exp.amount * 12 : exp.amount
        expenseItems.push({ label: exp.name, amount: a, currency: exp.currency })
      }
    }

    const income = Math.round(incomeItems.reduce((s, i) => s + (i.currency === 'EUR' ? i.amount : i.amount / DEFAULT_EUR_USD_RATE), 0))
    const expense = Math.round(expenseItems.reduce((s, i) => s + (i.currency === 'EUR' ? i.amount : i.amount / DEFAULT_EUR_USD_RATE), 0))
    return { year, income, expense, incomeItems, expenseItems }
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

// Correct modulo that handles negative numbers
function safeMonth(totalM: number): number {
  return (((totalM - 1) % 12) + 12) % 12 + 1
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
    const month = safeMonth(totalM)
    const ym = `${year}-${String(month).padStart(2, '0')}`

    const incomeItems: MonthItem[] = []
    const expenseItems: MonthItem[] = []

    for (const p of pensions) {
      const personBY = p.person === 'self' ? profile.birthYear : profile.spouseBirthYear
      const startYear = personBY + p.startAge
      if (startYear > year) continue
      incomeItems.push({ label: p.label, amount: p.monthlyAmount, currency: p.currency, amountEUR: toEUR(p.monthlyAmount, p.currency) })
    }

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

function MonthlyTooltip({ active, payload }: {
  active?: boolean
  payload?: Array<{ dataKey: string; value: number; payload: MonthlyPoint }>
}) {
  if (!active || !payload?.length) return null
  const pt = payload[0]?.payload
  if (!pt) return null
  return (
    <div className="bg-gray-900 text-white text-[11px] px-3 py-2 rounded-lg shadow-lg border border-gray-700 max-w-[220px]">
      <div className="font-semibold text-[12px] mb-2 pb-1 border-b border-gray-700">{pt.monthLabel}</div>
      {pt.incomeItems.length > 0 && (
        <div className="mb-2">
          <div className="text-green-400 text-[10px] font-medium mb-1">Income</div>
          {pt.incomeItems.slice(0, 4).map((it, i) => (
            <div key={i} className="flex items-start gap-1">
              <span className="text-gray-500 shrink-0">•</span>
              <span className="text-gray-300 flex-1 min-w-0 truncate">{it.label}</span>
              <span className="text-white shrink-0 ml-2">{formatCurrency(it.amount, it.currency)}</span>
            </div>
          ))}
          {pt.incomeItems.length > 4 && <div className="text-gray-500">+{pt.incomeItems.length - 4} more</div>}
        </div>
      )}
      {pt.expenseItems.length > 0 && (
        <div>
          <div className="text-red-400 text-[10px] font-medium mb-1">Expenses</div>
          {pt.expenseItems.slice(0, 4).map((it, i) => (
            <div key={i} className="flex items-start gap-1">
              <span className="text-gray-500 shrink-0">•</span>
              <span className="text-gray-300 flex-1 min-w-0 truncate">{it.label}</span>
              <span className="text-white shrink-0 ml-2">{formatCurrency(it.amount, it.currency)}</span>
            </div>
          ))}
          {pt.expenseItems.length > 4 && <div className="text-gray-500 mt-1">+{pt.expenseItems.length - 4} more</div>}
        </div>
      )}
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
    </div>
  )
}

function MonthlyIEChart({ monthlyData }: { monthlyData: MonthlyPoint[] }) {
  const today = new Date()
  const currentYM = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`
  const [selected, setSelected] = useState(currentYM)

  const activePt = monthlyData.find(p => p.month === selected) ?? monthlyData[Math.floor(monthlyData.length / 2)]
  const currentMonthLabel = monthlyData.find(p => p.month === currentYM)?.monthLabel ?? ''

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
            {/* Highlight current month */}
            <ReferenceArea x1={currentMonthLabel} x2={currentMonthLabel} fill="#3b82f6" fillOpacity={0.07} />
            <Bar dataKey="income" name="Income" radius={[2, 2, 0, 0]}
              onClick={(d) => setSelected((d as MonthlyPoint).month)}>
              {monthlyData.map((entry, index) => (
                <Cell key={index} fill="#22c55e" opacity={entry.month === currentYM ? 1.0 : 0.55} />
              ))}
            </Bar>
            <Bar dataKey="expense" name="Expenses" radius={[2, 2, 0, 0]}
              onClick={(d) => setSelected((d as MonthlyPoint).month)}>
              {monthlyData.map((entry, index) => (
                <Cell key={index} fill="#ef4444" opacity={entry.month === currentYM ? 0.85 : 0.4} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
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
  pastMonths = 6,
  futureMonths = 6,
  maxItems = 20,
): UpcomingItem[] {
  const allExp = allExpensesOf(expenses, medicalCoverages, medicalExpenses)
  const items: UpcomingItem[] = []
  const cy = today.getFullYear()
  const cm = today.getMonth() + 1

  for (let offset = -pastMonths; offset <= futureMonths; offset++) {
    const totalM = cm + offset
    const year = cy + Math.floor((totalM - 1) / 12)
    const month = safeMonth(totalM)

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
  pastMonths = 6,
  futureMonths = 6,
  maxItems = 20,
): UpcomingItem[] {
  const items: UpcomingItem[] = []
  const cy = today.getFullYear()
  const cm = today.getMonth() + 1

  for (let offset = -pastMonths; offset <= futureMonths; offset++) {
    const totalM = cm + offset
    const year = cy + Math.floor((totalM - 1) / 12)
    const month = safeMonth(totalM)
    for (const p of pensions) {
      const personBY = p.person === 'self' ? profile.birthYear : profile.spouseBirthYear
      if (personBY + p.startAge > year) continue
      const ym = `${year}-${String(month).padStart(2, '0')}`
      items.push({ key: `pension-${p.id}-${ym}`, date: ym, label: p.label, amount: p.monthlyAmount, currency: p.currency, badge: 'projected' })
    }
  }

  // Windfalls within window
  const startTotalM = cm - pastMonths
  const endTotalM = cm + futureMonths
  const startYear = cy + Math.floor((startTotalM - 1) / 12)
  const endYear = cy + Math.floor((endTotalM - 1) / 12)
  for (const w of windfalls) {
    const wYear = parseInt(w.date)
    if (wYear >= startYear && wYear <= endYear) {
      items.push({ key: `windfall-${w.id}`, date: `${wYear}-01`, label: w.name, amount: w.amount, currency: w.currency, badge: 'windfall' })
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
  const upcomingExpenses = buildUpcomingExpenses(expenses, medicalCoverages ?? [], medicalExpenses ?? [], today, 6, 6, 20)
  const upcomingIncome = buildUpcomingIncome(pensions, windfalls, profile, today, 6, 6, 20)
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

        {/* Annual income vs expenses */}
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

        {/* Monthly ±6m chart + upcoming panels */}
        <div className="grid grid-cols-[3fr_1fr_1fr] gap-3">
          <Card>
            <CardTitle>Income vs expenses — last 6m / next 6m ({profile.baseCurrency})</CardTitle>
            <MonthlyIEChart monthlyData={monthlyData} />
          </Card>

          <Card>
            <UpcomingPanel
              title="Expenses — ±6 months"
              items={upcomingExpenses}
              colorClass="text-red-500"
              sign="−"
              emptyMsg="No expenses in window"
            />
          </Card>

          <Card>
            <UpcomingPanel
              title="Income — ±6 months"
              items={upcomingIncome}
              colorClass="text-green-600"
              sign="+"
              emptyMsg="No income in window"
            />
          </Card>
        </div>
      </div>
    </div>
  )
}
