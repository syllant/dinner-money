import { useEffect, useRef, useState } from 'react'
import { Settings2 } from 'lucide-react'
import { useAppStore } from '../store/useAppStore'
import { MetricCard } from '../components/ui/MetricCard'
import { Card, CardTitle } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { PageHeader } from '../components/ui/PageHeader'
import { FlowRow, monthLabel as flowMonthLabel, recurrenceNote } from '../components/ui/FlowRow'
import { formatCompact, formatCurrency } from '../lib/format'
import { DEFAULT_EUR_USD_RATE, convertToBase } from '../lib/currency'
import { projectedAnnualDividendsEUR, DIVIDEND_MONTHS } from '../lib/dividends'
import {
  ComposedChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine,
  BarChart, Bar, Cell, ReferenceArea,
} from 'recharts'
import type { SimulationResult, Expense, PensionEstimate, Windfall, UserProfile, MedicalCoverage, MedicalExpense, Account, MonteCarloConfig } from '../types'

// ─── Life event data ──────────────────────────────────────────────────────────

interface LifeEvent { year: number; label: string; color: string; emoji: string }

function useLifeEvents(): LifeEvent[] {
  const { realEstateEvents, windfalls, pensions, profile } = useAppStore()
  const events: LifeEvent[] = []
  const now = new Date().getFullYear()

  for (const re of realEstateEvents) {
    const y = parseInt(re.date.split('-')[0])
    const emoji = re.eventType === 'sell' ? '🏠' : re.eventType === 'buy' ? '🏡' : '🔑'
    const label = re.eventType === 'sell' ? 'Sell home' : re.eventType === 'buy' ? 'Buy home' : 'Rent'
    events.push({ year: y, label, color: '#16a34a', emoji })
  }
  for (const w of windfalls) {
    events.push({ year: parseInt(w.date.split('-')[0]), label: w.name, color: '#854F0B', emoji: '★' })
  }
  for (const p of pensions) {
    const personBY = p.person === 'self' ? profile.birthYear : profile.spouseBirthYear
    const startYear = personBY + p.startAge
    if (startYear > now) {
      const personLabel = p.person === 'self' ? 'You' : 'Spouse'
      events.push({ year: startYear, label: `${p.label} (${personLabel})`, color: '#0F6E56', emoji: p.currency === 'EUR' ? '€' : '$' })
    }
  }
  events.push({ year: profile.birthYear + 73, label: 'RMDs start', color: '#7F77DD', emoji: 'R' })
  return events
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

// ─── Simulation settings panel ────────────────────────────────────────────────

const SIM_SLIDERS: Array<{ label: string; key: keyof MonteCarloConfig; min: number; max: number; step: number; unit?: string }> = [
  { label: 'Equity return (mean)', key: 'equityMeanReturn', min: 0, max: 12, step: 0.5 },
  { label: 'Equity volatility', key: 'equityStdDev', min: 5, max: 25, step: 0.5 },
  { label: 'Bond return (mean)', key: 'bondMeanReturn', min: -2, max: 6, step: 0.25 },
  { label: 'Bond volatility', key: 'bondStdDev', min: 1, max: 12, step: 0.25 },
  { label: 'EUR inflation', key: 'inflationEUR', min: 0, max: 6, step: 0.25 },
  { label: 'EUR/USD drift', key: 'eurUsdDrift', min: -3, max: 3, step: 0.25 },
  { label: 'EUR/USD volatility', key: 'eurUsdVolatility', min: 2, max: 15, step: 0.5 },
  { label: 'Simulations', key: 'numSimulations', min: 1000, max: 50000, step: 1000, unit: '' },
]

function SimulationSettingsPanel({ config, onChange }: {
  config: MonteCarloConfig
  onChange: (patch: Partial<MonteCarloConfig>) => void
}) {
  return (
    <div className="mb-3 pb-3 border-b border-gray-100 dark:border-gray-700">
      <div className="grid grid-cols-2 gap-x-8 gap-y-[7px]">
        {SIM_SLIDERS.map(({ label, key, min, max, step, unit = '%' }) => (
          <div key={key} className="flex items-center gap-2 text-[11px]">
            <span className="text-gray-500 dark:text-gray-400 min-w-[140px]">{label}</span>
            <input type="range" min={min} max={max} step={step}
              value={config[key] as number}
              onChange={e => onChange({ [key]: parseFloat(e.target.value) })}
              className="flex-1 h-[3px] accent-blue-500" />
            <span className="text-gray-700 dark:text-gray-300 min-w-[44px] text-right font-medium">
              {(config[key] as number).toFixed(step < 1 ? (step < 0.1 ? 2 : 2) : 0)}{unit}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Lifetime chart (NW area + annual I/E bars, dual Y-axis) ──────────────────

interface AnnualItem { label: string; amount: number; currency: string }

interface LifetimePoint {
  label: string
  median: number
  bandBase: number
  bandSize: number
  events: LifeEvent[]
  income: number | null
  expense: number | null
  incomeItems: AnnualItem[]
  expenseItems: AnnualItem[]
}

function LifetimeTooltip({ active, payload, label }: {
  active?: boolean
  payload?: Array<{ payload: LifetimePoint }>
  label?: string
}) {
  if (!active || !payload?.length) return null
  const pt = payload[0]?.payload
  if (!pt) return null
  const evts = pt.events ?? []
  const hasIE = pt.income != null || pt.expense != null
  return (
    <div className="bg-gray-900 text-white text-[11px] px-3 py-2 rounded-lg shadow-lg border border-gray-700 max-w-[210px]">
      <div className="font-semibold mb-1 pb-1 border-b border-gray-700">{label}</div>
      <div className="font-medium">{formatCurrency(pt.median, 'EUR')} NW</div>
      {evts.length > 0 && (
        <div className="mt-1 pt-1 border-t border-gray-700 space-y-0.5">
          {evts.map((ev, i) => (
            <div key={i} className="flex items-center gap-1 text-gray-300">
              <span className="inline-flex items-center justify-center w-3 h-3 rounded-full text-white text-[8px] shrink-0"
                style={{ background: ev.color }}>{ev.emoji}</span>
              <span>{ev.label}</span>
            </div>
          ))}
        </div>
      )}
      {hasIE && (
        <div className="mt-1 pt-1 border-t border-gray-700 space-y-1">
          {pt.incomeItems.length > 0 && (
            <div>
              <div className="text-green-400 text-[10px] font-medium mb-0.5">Annual income</div>
              {pt.incomeItems.map((it, i) => (
                <div key={i} className="flex items-start gap-1">
                  <span className="text-gray-300 flex-1 min-w-0 truncate">{it.label}</span>
                  <span className="text-white shrink-0 ml-2">{formatCurrency(it.amount, it.currency)}</span>
                </div>
              ))}
            </div>
          )}
          {pt.expenseItems.length > 0 && (
            <div>
              <div className="text-red-400 text-[10px] font-medium mb-0.5">Annual expenses</div>
              {pt.expenseItems.map((it, i) => (
                <div key={i} className="flex items-start gap-1">
                  <span className="text-gray-300 flex-1 min-w-0 truncate">{it.label}</span>
                  <span className="text-white shrink-0 ml-2">{formatCurrency(it.amount, it.currency)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function LifetimeChart({ result, initialNW, expenses, medicalCoverages, medicalExpenses, pensions, windfalls, accounts, profile }: {
  result: SimulationResult
  initialNW: number
  expenses: Expense[]
  medicalCoverages: MedicalCoverage[]
  medicalExpenses: MedicalExpense[]
  pensions: PensionEstimate[]
  windfalls: Windfall[]
  accounts: Account[]
  profile: UserProfile
}) {
  const events = useLifeEvents()
  const allExp = allExpensesOf(expenses, medicalCoverages, medicalExpenses)
  const currentYear = new Date().getFullYear()
  const annualProjectedDiv = Math.round(projectedAnnualDividendsEUR(accounts, DEFAULT_EUR_USD_RATE))

  const eventsByYear = events.reduce<Record<number, LifeEvent[]>>((acc, ev) => {
    if (!acc[ev.year]) acc[ev.year] = []
    acc[ev.year].push(ev)
    return acc
  }, {})

  const nowPoint: LifetimePoint = {
    label: 'Today',
    median: Math.round(initialNW),
    bandBase: Math.round(initialNW),
    bandSize: 0,
    events: [],
    income: null, expense: null, incomeItems: [], expenseItems: [],
  }

  const data: LifetimePoint[] = [
    nowPoint,
    ...result.years.map((y, i) => {
      const p10 = Math.max(0, Math.round(result.p10NetWorth[i]))
      const p90 = Math.max(0, Math.round(result.p90NetWorth[i]))
      const selfAge = y - profile.birthYear
      const incomeItems: AnnualItem[] = []
      const expenseItems: AnnualItem[] = []

      for (const p of pensions) {
        const pAge = p.person === 'self' ? selfAge : y - profile.spouseBirthYear
        if (pAge >= p.startAge) incomeItems.push({ label: p.label, amount: p.monthlyAmount * 12, currency: p.currency })
      }
      for (const w of windfalls) {
        if (parseInt(w.date.split('-')[0]) === y) incomeItems.push({ label: w.name, amount: w.amount, currency: w.currency })
      }
      if (y > currentYear && annualProjectedDiv > 0) {
        incomeItems.push({ label: 'Dividends (est.)', amount: annualProjectedDiv, currency: 'EUR' })
      }
      for (const acc of accounts) {
        if (acc.interestRate && acc.interestRate > 0 && acc.balance > 0) {
          incomeItems.push({ label: `${acc.name} interest`, amount: acc.balance * acc.interestRate / 100, currency: acc.currency })
        }
        if (acc.dividends) {
          const annual = acc.dividends.filter(d => parseInt(d.date.split('-')[0]) === y).reduce((s, d) => s + d.amount, 0)
          if (annual > 0) incomeItems.push({ label: `${acc.name} dividends`, amount: annual, currency: acc.dividends[0]?.currency ?? acc.currency })
        }
      }
      for (const exp of allExp) {
        const s = parseInt(exp.startDate.split('-')[0])
        const e = exp.endDate ? parseInt(exp.endDate.split('-')[0]) : 9999
        if (exp.frequency === 'one_time') {
          if (y === s) expenseItems.push({ label: exp.name, amount: exp.amount, currency: exp.currency })
        } else if (y >= s && y <= e) {
          const a = exp.frequency === 'monthly' ? exp.amount * 12 : exp.amount
          expenseItems.push({ label: exp.name, amount: a, currency: exp.currency })
        }
      }

      const income = Math.round(incomeItems.reduce((s, it) => s + (it.currency === 'EUR' ? it.amount : it.amount / DEFAULT_EUR_USD_RATE), 0))
      const expense = Math.round(expenseItems.reduce((s, it) => s + (it.currency === 'EUR' ? it.amount : it.amount / DEFAULT_EUR_USD_RATE), 0))

      return {
        label: String(y),
        median: Math.max(0, Math.round(result.medianNetWorth[i])),
        bandBase: p10,
        bandSize: Math.max(0, p90 - p10),
        events: eventsByYear[y] ?? [],
        income, expense, incomeItems, expenseItems,
      }
    }),
  ]

  const ticks = ['Today', ...result.years.filter(y => y % 5 === 0).map(String)]

  return (
    <ResponsiveContainer width="100%" height={300}>
      <ComposedChart data={data} margin={{ top: 20, right: 48, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="bandGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#378ADD" stopOpacity={0.25} />
            <stop offset="100%" stopColor="#378ADD" stopOpacity={0.05} />
          </linearGradient>
        </defs>
        <XAxis dataKey="label" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} ticks={ticks} />
        <YAxis yAxisId="nw" tickFormatter={(v) => formatCompact(v, 'EUR')} tick={{ fontSize: 10 }} tickLine={false} axisLine={false} width={48} />
        <YAxis yAxisId="ie" orientation="right" tickFormatter={(v) => formatCompact(v, 'EUR')} tick={{ fontSize: 10 }} tickLine={false} axisLine={false} width={44} />
        <Tooltip content={<LifetimeTooltip />} />
        {events.map(ev => (
          <ReferenceLine
            key={`${ev.year}-${ev.label}`}
            yAxisId="nw"
            x={String(ev.year)}
            stroke={ev.color}
            strokeDasharray="3 3"
            strokeWidth={1.5}
            label={{ value: ev.emoji, position: 'top', fontSize: 10, fill: ev.color }}
          />
        ))}
        <Area yAxisId="nw" type="monotone" dataKey="bandBase" stackId="band" stroke="none" fill="transparent" legendType="none" />
        <Area yAxisId="nw" type="monotone" dataKey="bandSize" stackId="band" stroke="none" fill="url(#bandGrad)" legendType="none" />
        <Area yAxisId="nw" type="monotone" dataKey="median" stroke="#378ADD" strokeWidth={2} fill="none" dot={false} legendType="none" />
        <Bar yAxisId="ie" dataKey="income" name="Income" fill="#22c55e" opacity={0.65} radius={[2, 2, 0, 0]} />
        <Bar yAxisId="ie" dataKey="expense" name="Expenses" fill="#ef4444" opacity={0.5} radius={[2, 2, 0, 0]} />
      </ComposedChart>
    </ResponsiveContainer>
  )
}

// ─── Monthly ±6m chart ────────────────────────────────────────────────────────

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function toMonthLabel(year: number, month: number) {
  return `${MONTH_NAMES[month - 1]} ${year}`
}

interface MonthItem { label: string; amount: number; currency: string; amountEUR: number }
interface MonthlyPoint {
  month: string
  monthLabel: string
  income: number
  expense: number
  incomeItems: MonthItem[]
  expenseItems: MonthItem[]
}

function safeMonth(totalM: number): number {
  return (((totalM - 1) % 12) + 12) % 12 + 1
}

function buildMonthlyData(
  expenses: Expense[],
  medicalCoverages: MedicalCoverage[],
  medicalExpenses: MedicalExpense[],
  pensions: PensionEstimate[],
  windfalls: Windfall[],
  accounts: Account[],
  profile: UserProfile,
  today: Date,
  pastMonths = 6,
  futureMonths = 6,
): MonthlyPoint[] {
  const allExp = allExpensesOf(expenses, medicalCoverages, medicalExpenses)
  const points: MonthlyPoint[] = []
  const cy = today.getFullYear()
  const cm = today.getMonth() + 1
  const currentYM = `${cy}-${String(cm).padStart(2, '0')}`
  const quarterlyProjectedDiv = projectedAnnualDividendsEUR(accounts, DEFAULT_EUR_USD_RATE) / 4

  for (let offset = -pastMonths; offset <= futureMonths; offset++) {
    const totalM = cm + offset
    const year = cy + Math.floor((totalM - 1) / 12)
    const month = safeMonth(totalM)
    const ym = `${year}-${String(month).padStart(2, '0')}`

    const incomeItems: MonthItem[] = []
    const expenseItems: MonthItem[] = []

    for (const p of pensions) {
      const personBY = p.person === 'self' ? profile.birthYear : profile.spouseBirthYear
      if (personBY + p.startAge > year) continue
      incomeItems.push({ label: p.label, amount: p.monthlyAmount, currency: p.currency, amountEUR: toEUR(p.monthlyAmount, p.currency) })
    }

    for (const acc of accounts) {
      if (acc.interestRate && acc.interestRate > 0 && acc.balance > 0) {
        const monthly = acc.balance * acc.interestRate / 100 / 12
        incomeItems.push({ label: `${acc.name} interest`, amount: monthly, currency: acc.currency, amountEUR: toEUR(monthly, acc.currency) })
      }
      if (acc.dividends) {
        for (const div of acc.dividends) {
          const dY = parseInt(div.date.split('-')[0])
          const dM = parseInt(div.date.split('-')[1])
          if (dY === year && dM === month) {
            incomeItems.push({ label: `${div.securityName} dividend`, amount: div.amount, currency: div.currency, amountEUR: toEUR(div.amount, div.currency) })
          }
        }
      }
    }

    // Projected quarterly dividends for future months (Q1=Mar, Q2=Jun, Q3=Sep, Q4=Dec)
    if (ym >= currentYM && DIVIDEND_MONTHS.has(month) && quarterlyProjectedDiv > 0) {
      incomeItems.push({ label: 'Dividends (est.)', amount: quarterlyProjectedDiv, currency: 'EUR', amountEUR: quarterlyProjectedDiv })
    }

    // Include windfall income in the month of the windfall (treat YYYY or YYYY-MM)
    for (const w of windfalls) {
      const wYear = parseInt(w.date.split('-')[0])
      const wMonth = w.date.includes('-') ? parseInt(w.date.split('-')[1] ?? '1') : 1
      if (wYear === year && wMonth === month) {
        incomeItems.push({ label: w.name, amount: w.amount, currency: w.currency, amountEUR: toEUR(w.amount, w.currency) })
      }
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
          {pt.incomeItems.map((it, i) => (
            <div key={i} className="flex items-start gap-1">
              <span className="text-gray-500 shrink-0">•</span>
              <span className="text-gray-300 flex-1 min-w-0 truncate">{it.label}</span>
              <span className="text-white shrink-0 ml-2">{formatCurrency(it.amount, it.currency)}</span>
            </div>
          ))}
        </div>
      )}
      {pt.expenseItems.length > 0 && (
        <div>
          <div className="text-red-400 text-[10px] font-medium mb-1">Expenses</div>
          {pt.expenseItems.map((it, i) => (
            <div key={i} className="flex items-start gap-1">
              <span className="text-gray-500 shrink-0">•</span>
              <span className="text-gray-300 flex-1 min-w-0 truncate">{it.label}</span>
              <span className="text-white shrink-0 ml-2">{formatCurrency(it.amount, it.currency)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function MonthlyIEChart({ monthlyData }: { monthlyData: MonthlyPoint[] }) {
  const today = new Date()
  const currentYM = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`

  return (
    <ResponsiveContainer width="100%" height={180}>
      <BarChart
        data={monthlyData}
        margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
      >
        <XAxis dataKey="monthLabel" tick={{ fontSize: 9 }} tickLine={false} axisLine={false}
          tickFormatter={l => l.split(' ')[0]} />
        <YAxis tickFormatter={(v) => formatCompact(v, 'EUR')} tick={{ fontSize: 9 }} tickLine={false} axisLine={false} width={40} />
        <Tooltip content={<MonthlyTooltip />} />
        <ReferenceArea
          x1={monthlyData.find(p => p.month === currentYM)?.monthLabel ?? ''}
          x2={monthlyData.find(p => p.month === currentYM)?.monthLabel ?? ''}
          fill="#3b82f6" fillOpacity={0.07}
        />
        <Bar dataKey="income" name="Income" radius={[2, 2, 0, 0]}>
          {monthlyData.map((entry, index) => (
            <Cell key={index} fill="#22c55e" opacity={entry.month < currentYM ? 0.25 : 0.75} />
          ))}
        </Bar>
        <Bar dataKey="expense" name="Expenses" radius={[2, 2, 0, 0]}>
          {monthlyData.map((entry, index) => (
            <Cell key={index} fill="#ef4444" opacity={entry.month < currentYM ? 0.2 : 0.6} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

// ─── Upcoming item helpers ────────────────────────────────────────────────────

interface UpcomingItem {
  key: string
  date: string
  label: string
  note: string
  amount: number
  currency: string
  recurring: boolean
}

function buildUpcomingExpenses(
  expenses: Expense[],
  medicalCoverages: MedicalCoverage[],
  medicalExpenses: MedicalExpense[],
  today: Date,
  futureMonths = 6,
  maxItems = 30,
): UpcomingItem[] {
  const allExp = allExpensesOf(expenses, medicalCoverages, medicalExpenses)
  const items: UpcomingItem[] = []
  const cy = today.getFullYear()
  const cm = today.getMonth() + 1

  for (let i = 0; i < futureMonths; i++) {
    const totalM = cm + i
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
        items.push({ key: `exp-${exp.id}-${ym}`, date: ym, label: exp.name, note: recurrenceNote(exp.frequency, exp.startDate, exp.endDate), amount: exp.amount, currency: exp.currency, recurring: true })
      } else if (exp.frequency === 'yearly' && month === startM) {
        items.push({ key: `exp-${exp.id}-${year}`, date: ym, label: exp.name, note: recurrenceNote(exp.frequency, exp.startDate, exp.endDate), amount: exp.amount, currency: exp.currency, recurring: true })
      } else if (exp.frequency === 'one_time' && year === startY && month === startM) {
        items.push({ key: `exp-${exp.id}-ot`, date: ym, label: exp.name, note: '', amount: exp.amount, currency: exp.currency, recurring: false })
      }
    }
  }

  return items.sort((a, b) => a.date.localeCompare(b.date)).slice(0, maxItems)
}

function buildUpcomingIncome(
  pensions: PensionEstimate[],
  windfalls: Windfall[],
  accounts: Account[],
  profile: UserProfile,
  today: Date,
  futureMonths = 6,
  maxItems = 30,
): UpcomingItem[] {
  const items: UpcomingItem[] = []
  const cy = today.getFullYear()
  const cm = today.getMonth() + 1

  const quarterlyProjectedDiv = projectedAnnualDividendsEUR(accounts, DEFAULT_EUR_USD_RATE) / 4

  for (let i = 0; i < futureMonths; i++) {
    const totalM = cm + i
    const year = cy + Math.floor((totalM - 1) / 12)
    const month = safeMonth(totalM)
    const ym = `${year}-${String(month).padStart(2, '0')}`
    for (const p of pensions) {
      const personBY = p.person === 'self' ? profile.birthYear : profile.spouseBirthYear
      if (personBY + p.startAge > year) continue
      items.push({ key: `pension-${p.id}-${ym}`, date: ym, label: p.label, note: 'monthly pension', amount: p.monthlyAmount, currency: p.currency, recurring: true })
    }
    if (DIVIDEND_MONTHS.has(month) && quarterlyProjectedDiv > 0) {
      items.push({ key: `div-proj-${ym}`, date: ym, label: 'Dividends (est.)', note: 'quarterly projection', amount: quarterlyProjectedDiv, currency: 'EUR', recurring: true })
    }
  }

  const endTotalM = cm + futureMonths
  const endYear = cy + Math.floor((endTotalM - 1) / 12)
  for (const w of windfalls) {
    const wYear = parseInt(w.date.split('-')[0])
    if (wYear >= cy && wYear <= endYear) {
      items.push({ key: `windfall-${w.id}`, date: `${wYear}-01`, label: w.name, note: '', amount: w.amount, currency: w.currency, recurring: false })
    }
  }

  return items.sort((a, b) => a.date.localeCompare(b.date)).slice(0, maxItems)
}

// ─── Upcoming panel ───────────────────────────────────────────────────────────

function UpcomingPanel({ title, items, colorClass, sign, emptyMsg }: {
  title: string; items: UpcomingItem[]; colorClass: string; sign: '+' | '−'; emptyMsg: string
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [showMore, setShowMore] = useState(false)

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const check = () => setShowMore(el.scrollHeight > el.clientHeight + 2)
    check()
    const ro = new ResizeObserver(check)
    ro.observe(el)
    return () => ro.disconnect()
  }, [items])

  function handleScroll() {
    const el = scrollRef.current
    if (!el) return
    setShowMore(el.scrollTop + el.clientHeight < el.scrollHeight - 2)
  }

  const total = items.reduce((s, i) => s + toEUR(i.amount, i.currency), 0)

  return (
    <div>
      <div className="flex justify-between items-center mb-2">
        <div className="text-[11px] font-medium text-gray-500 dark:text-gray-400">{title}</div>
        {items.length > 0 && (
          <span className={`text-[11.5px] font-semibold ${colorClass}`}>
            {sign}{formatCurrency(total, 'EUR')}
          </span>
        )}
      </div>
      <div className="relative">
        <div ref={scrollRef} className="overflow-y-auto max-h-[220px]" onScroll={handleScroll}>
          {items.length === 0 && <div className="text-[11px] text-gray-400 py-1">{emptyMsg}</div>}
          <div className="px-0">
            {items.map(item => (
              <FlowRow
                key={item.key}
                dateLabel={flowMonthLabel(item.date)}
                description={item.label}
                note={item.note}
                recurring={item.recurring}
                amount={item.amount}
                currency={item.currency}
                colorClass={colorClass}
                sign={sign}
              />
            ))}
          </div>
        </div>
        {showMore && (
          <div className="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-white dark:from-gray-900 to-transparent pointer-events-none" />
        )}
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const {
    accounts, simulationResult, simulationRunning, setSimulationRunning, setSimulationResult,
    profile, expenses, medicalCoverages, medicalExpenses, pensions, windfalls, realEstateEvents,
    monteCarloConfig, setMonteCarloConfig,
  } = useAppStore()
  const [showSimSettings, setShowSimSettings] = useState(false)

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
  const upcomingExpenses = buildUpcomingExpenses(expenses, medicalCoverages ?? [], medicalExpenses ?? [], today, 6, 30)
  const upcomingIncome = buildUpcomingIncome(pensions, windfalls, accounts, profile, today, 6, 30)
  const monthlyData = buildMonthlyData(expenses, medicalCoverages ?? [], medicalExpenses ?? [], pensions, windfalls, accounts, profile, today, 6, 6)

  return (
    <div>
      <PageHeader title="Overview" />

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

        {/* Lifetime projection */}
        <Card>
          <div className="flex justify-between items-center mb-[10px]">
            <span className="text-[11.5px] font-medium text-gray-500 dark:text-gray-400">
              Lifetime projection
            </span>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setShowSimSettings(v => !v)}
                title="Simulation settings"
                className={`p-[5px] rounded-[4px] transition-colors ${showSimSettings ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400' : 'text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-600 dark:hover:text-gray-300'}`}
              >
                <Settings2 size={13} />
              </button>
              <Button variant="default" onClick={runSimulation} disabled={simulationRunning}>
                {simulationRunning ? 'Running…' : '↺ Recalculate'}
              </Button>
            </div>
          </div>
          {showSimSettings && (
            <SimulationSettingsPanel config={monteCarloConfig} onChange={setMonteCarloConfig} />
          )}
          {result ? (
            <LifetimeChart
              result={result}
              initialNW={netWorth}
              expenses={expenses}
              medicalCoverages={medicalCoverages ?? []}
              medicalExpenses={medicalExpenses ?? []}
              pensions={pensions}
              windfalls={windfalls}
              accounts={accounts}
              profile={profile}
            />
          ) : (
            <div className="h-[200px] flex items-center justify-center text-[13px] text-gray-400">
              {simulationRunning ? 'Running simulation…' : 'Add accounts to see projections — simulation runs automatically'}
            </div>
          )}
        </Card>

        {/* Monthly ±6m chart */}
        <Card>
          <CardTitle>Income vs expenses — last 6m / next 6m ({profile.baseCurrency})</CardTitle>
          <MonthlyIEChart monthlyData={monthlyData} />
        </Card>

        {/* Upcoming panels — future 6 months only */}
        <div className="grid grid-cols-2 gap-3">
          <Card>
            <UpcomingPanel
              title="Upcoming expenses (next 6 months)"
              items={upcomingExpenses}
              colorClass="text-red-500"
              sign="−"
              emptyMsg="No upcoming expenses"
            />
          </Card>
          <Card>
            <UpcomingPanel
              title="Upcoming income (next 6 months)"
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
