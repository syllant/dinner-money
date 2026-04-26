import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type {
  UserProfile, Account, PensionEstimate, RealEstateEvent,
  Expense, Windfall, MonteCarloConfig, TaxConfig, SimulationResult,
  QuarterlyPayment, MedicalCoverage, MedicalExpense,
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

const defaultQuarterlyPayments = (year: number): QuarterlyPayment[] => [
  { year, quarter: 1, amountPaid: null, estimatedDue: null },
  { year, quarter: 2, amountPaid: null, estimatedDue: null },
  { year, quarter: 3, amountPaid: null, estimatedDue: null },
  { year, quarter: 4, amountPaid: null, estimatedDue: null },
]

const defaultTaxConfig: TaxConfig = {
  usFederalEffectiveRate: 22,
  usCaliforniaEffectiveRate: 9.3,
  frCombinedEffectiveRate: 11,
  quarterlyPayments: defaultQuarterlyPayments(new Date().getFullYear()),
  stateQuarterlyPayments: defaultQuarterlyPayments(new Date().getFullYear()),
}

// ─── Store interface ──────────────────────────────────────────────────────────

interface AppState {
  // Auth
  lmApiKey: string | null
  lmProxyUrl: string | null
  // Config
  profile: UserProfile
  accounts: Account[]
  pensions: PensionEstimate[]
  realEstateEvents: RealEstateEvent[]
  expenses: Expense[]
  windfalls: Windfall[]
  monteCarloConfig: MonteCarloConfig
  taxConfig: TaxConfig
  medicalCoverages: MedicalCoverage[]
  medicalExpenses: MedicalExpense[]
  // Runtime (not persisted)
  simulationResult: SimulationResult | null
  simulationRunning: boolean
  // Actions
  setLmApiKey: (key: string | null) => void
  setLmProxyUrl: (url: string | null) => void
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
  upsertStatePayment: (payment: QuarterlyPayment) => void
  upsertMedicalCoverage: (coverage: MedicalCoverage) => void
  deleteMedicalCoverage: (id: string) => void
  upsertMedicalExpense: (expense: MedicalExpense) => void
  deleteMedicalExpense: (id: string) => void
  setSimulationResult: (result: SimulationResult | null) => void
  setSimulationRunning: (running: boolean) => void
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      // Initial state
      lmApiKey: null,
      lmProxyUrl: null,
      profile: defaultProfile,
      accounts: [],
      pensions: [],
      realEstateEvents: [],
      expenses: [],
      windfalls: [],
      monteCarloConfig: defaultMonteCarloConfig,
      taxConfig: defaultTaxConfig,
      medicalCoverages: [],
      medicalExpenses: [],
      simulationResult: null,
      simulationRunning: false,

      // Actions
      setLmApiKey: (key) => set({ lmApiKey: key }),
      setLmProxyUrl: (url) => set({ lmProxyUrl: url }),
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
      upsertStatePayment: (payment) =>
        set((s) => ({
          taxConfig: {
            ...s.taxConfig,
            stateQuarterlyPayments: (s.taxConfig.stateQuarterlyPayments ?? []).some(
              (p) => p.year === payment.year && p.quarter === payment.quarter
            )
              ? (s.taxConfig.stateQuarterlyPayments ?? []).map((p) =>
                  p.year === payment.year && p.quarter === payment.quarter ? payment : p
                )
              : [...(s.taxConfig.stateQuarterlyPayments ?? []), payment],
          },
        })),

      upsertMedicalCoverage: (coverage) =>
        set((s) => ({
          medicalCoverages: s.medicalCoverages.some((c) => c.id === coverage.id)
            ? s.medicalCoverages.map((c) => (c.id === coverage.id ? coverage : c))
            : [...s.medicalCoverages, coverage],
        })),
      deleteMedicalCoverage: (id) =>
        set((s) => ({ medicalCoverages: s.medicalCoverages.filter((c) => c.id !== id) })),

      upsertMedicalExpense: (expense) =>
        set((s) => ({
          medicalExpenses: s.medicalExpenses.some((e) => e.id === expense.id)
            ? s.medicalExpenses.map((e) => (e.id === expense.id ? expense : e))
            : [...s.medicalExpenses, expense],
        })),
      deleteMedicalExpense: (id) =>
        set((s) => ({ medicalExpenses: s.medicalExpenses.filter((e) => e.id !== id) })),

      setSimulationResult: (simulationResult) => set({ simulationResult }),
      setSimulationRunning: (simulationRunning) => set({ simulationRunning }),
    }),
    {
      name: 'dinner-money-store',
      // Exclude runtime state from persistence
      partialize: (s) => ({
        lmApiKey: s.lmApiKey,
        lmProxyUrl: s.lmProxyUrl,
        profile: s.profile,
        accounts: s.accounts,
        pensions: s.pensions,
        realEstateEvents: s.realEstateEvents,
        expenses: s.expenses,
        windfalls: s.windfalls,
        monteCarloConfig: s.monteCarloConfig,
        taxConfig: {
          ...s.taxConfig,
          // ensure stateQuarterlyPayments is always persisted even if missing from old data
          stateQuarterlyPayments: s.taxConfig.stateQuarterlyPayments ?? defaultQuarterlyPayments(new Date().getFullYear()),
        },
        medicalCoverages: s.medicalCoverages,
        medicalExpenses: s.medicalExpenses,
      }),
    }
  )
)
