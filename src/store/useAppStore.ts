import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type {
  UserProfile, Account, PensionEstimate, RealEstateEvent,
  Expense, Windfall, MonteCarloConfig, TaxConfig, SimulationResult,
  QuarterlyPayment,
} from '../types'

// ─── Default values ───────────────────────────────────────────────────────────

const defaultProfile: UserProfile = {
  birthYear: 1975,
  spouseBirthYear: 1978,
  projectionEndAge: 90,
  baseCurrency: 'EUR',
  residencyPeriods: [
    { id: '1', startDate: '2026-07', endDate: null, country: 'FR' },
  ],
  cobraMonthlyUSD: 2100,
  cobraEndDate: '2026-07',
}

const defaultMonteCarloConfig: MonteCarloConfig = {
  equityMeanReturn: 7,
  equityStdDev: 15,
  bondMeanReturn: 2,
  bondStdDev: 6,
  inflationEUR: 2.5,
  eurUsdDrift: 0,
  eurUsdVolatility: 8,
  numSimulations: 10000,
  successThreshold: 90,
}

const defaultTaxConfig: TaxConfig = {
  usFederalEffectiveRate: 22,
  usCaliforniaEffectiveRate: 9.3,
  frCombinedEffectiveRate: 11,
  quarterlyPayments: [
    { year: 2026, quarter: 1, amountPaid: 8200, estimatedDue: 8200 },
    { year: 2026, quarter: 2, amountPaid: null, estimatedDue: 8200 },
    { year: 2026, quarter: 3, amountPaid: null, estimatedDue: null },
    { year: 2026, quarter: 4, amountPaid: null, estimatedDue: null },
  ],
}

// ─── Store interface ──────────────────────────────────────────────────────────

interface AppState {
  // Auth
  lmApiKey: string | null
  // Config
  profile: UserProfile
  accounts: Account[]
  pensions: PensionEstimate[]
  realEstateEvents: RealEstateEvent[]
  expenses: Expense[]
  windfalls: Windfall[]
  monteCarloConfig: MonteCarloConfig
  taxConfig: TaxConfig
  // Runtime (not persisted)
  simulationResult: SimulationResult | null
  simulationRunning: boolean
  // Actions
  setLmApiKey: (key: string | null) => void
  setProfile: (patch: Partial<UserProfile>) => void
  setAccounts: (accounts: Account[]) => void
  upsertAccount: (account: Account) => void
  setPensions: (pensions: PensionEstimate[]) => void
  upsertPension: (pension: PensionEstimate) => void
  deletePension: (id: string) => void
  setRealEstateEvents: (events: RealEstateEvent[]) => void
  upsertRealEstateEvent: (event: RealEstateEvent) => void
  deleteRealEstateEvent: (id: string) => void
  setExpenses: (expenses: Expense[]) => void
  upsertExpense: (expense: Expense) => void
  deleteExpense: (id: string) => void
  setWindfalls: (windfalls: Windfall[]) => void
  upsertWindfall: (windfall: Windfall) => void
  deleteWindfall: (id: string) => void
  setMonteCarloConfig: (patch: Partial<MonteCarloConfig>) => void
  setTaxConfig: (patch: Partial<TaxConfig>) => void
  upsertQuarterlyPayment: (payment: QuarterlyPayment) => void
  setSimulationResult: (result: SimulationResult | null) => void
  setSimulationRunning: (running: boolean) => void
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      // Initial state
      lmApiKey: null,
      profile: defaultProfile,
      accounts: [],
      pensions: [],
      realEstateEvents: [],
      expenses: [],
      windfalls: [],
      monteCarloConfig: defaultMonteCarloConfig,
      taxConfig: defaultTaxConfig,
      simulationResult: null,
      simulationRunning: false,

      // Actions
      setLmApiKey: (key) => set({ lmApiKey: key }),
      setProfile: (patch) =>
        set((s) => ({ profile: { ...s.profile, ...patch } })),

      setAccounts: (accounts) => set({ accounts }),
      upsertAccount: (account) =>
        set((s) => ({
          accounts: s.accounts.some((a) => a.id === account.id)
            ? s.accounts.map((a) => (a.id === account.id ? account : a))
            : [...s.accounts, account],
        })),

      setPensions: (pensions) => set({ pensions }),
      upsertPension: (pension) =>
        set((s) => ({
          pensions: s.pensions.some((p) => p.id === pension.id)
            ? s.pensions.map((p) => (p.id === pension.id ? pension : p))
            : [...s.pensions, pension],
        })),
      deletePension: (id) =>
        set((s) => ({ pensions: s.pensions.filter((p) => p.id !== id) })),

      setRealEstateEvents: (realEstateEvents) => set({ realEstateEvents }),
      upsertRealEstateEvent: (event) =>
        set((s) => ({
          realEstateEvents: s.realEstateEvents.some((e) => e.id === event.id)
            ? s.realEstateEvents.map((e) => (e.id === event.id ? event : e))
            : [...s.realEstateEvents, event],
        })),
      deleteRealEstateEvent: (id) =>
        set((s) => ({ realEstateEvents: s.realEstateEvents.filter((e) => e.id !== id) })),

      setExpenses: (expenses) => set({ expenses }),
      upsertExpense: (expense) =>
        set((s) => ({
          expenses: s.expenses.some((e) => e.id === expense.id)
            ? s.expenses.map((e) => (e.id === expense.id ? expense : e))
            : [...s.expenses, expense],
        })),
      deleteExpense: (id) =>
        set((s) => ({ expenses: s.expenses.filter((e) => e.id !== id) })),

      setWindfalls: (windfalls) => set({ windfalls }),
      upsertWindfall: (windfall) =>
        set((s) => ({
          windfalls: s.windfalls.some((w) => w.id === windfall.id)
            ? s.windfalls.map((w) => (w.id === windfall.id ? windfall : w))
            : [...s.windfalls, windfall],
        })),
      deleteWindfall: (id) =>
        set((s) => ({ windfalls: s.windfalls.filter((w) => w.id !== id) })),

      setMonteCarloConfig: (patch) =>
        set((s) => ({ monteCarloConfig: { ...s.monteCarloConfig, ...patch } })),

      setTaxConfig: (patch) =>
        set((s) => ({ taxConfig: { ...s.taxConfig, ...patch } })),
      upsertQuarterlyPayment: (payment) =>
        set((s) => ({
          taxConfig: {
            ...s.taxConfig,
            quarterlyPayments: s.taxConfig.quarterlyPayments.some(
              (p) => p.year === payment.year && p.quarter === payment.quarter
            )
              ? s.taxConfig.quarterlyPayments.map((p) =>
                  p.year === payment.year && p.quarter === payment.quarter ? payment : p
                )
              : [...s.taxConfig.quarterlyPayments, payment],
          },
        })),

      setSimulationResult: (simulationResult) => set({ simulationResult }),
      setSimulationRunning: (simulationRunning) => set({ simulationRunning }),
    }),
    {
      name: 'dinner-money-store',
      // Exclude runtime state from persistence
      partialize: (s) => ({
        lmApiKey: s.lmApiKey,
        profile: s.profile,
        accounts: s.accounts,
        pensions: s.pensions,
        realEstateEvents: s.realEstateEvents,
        expenses: s.expenses,
        windfalls: s.windfalls,
        monteCarloConfig: s.monteCarloConfig,
        taxConfig: s.taxConfig,
      }),
    }
  )
)
