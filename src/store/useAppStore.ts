import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type {
  UserProfile, Account, PensionEstimate, RealEstateEvent,
  Expense, Windfall, MonteCarloConfig, TaxConfig, SimulationResult,
  QuarterlyPayment, MedicalCoverage, MedicalExpense, Transfer, TaxSettlement,
} from '../types'

// ─── Default values ───────────────────────────────────────────────────────────

const defaultProfile: UserProfile = {
  birthYear: 1970,
  spouseBirthYear: 1972,
  projectionEndAge: 90,
  spouseProjectionEndAge: 90,
  baseCurrency: 'EUR',
  residencyPeriods: [],
  cobraMonthlyUSD: 0,
  cobraEndDate: '',
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
  frenchTaxRate: 17.2,
  taxableWithdrawalShare: 60,
  annualTaxAllowanceEUR: 0,
  cashYieldMultiplier: 75,
  fallbackUsdEurRate: 1.08,
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
  taxProfile: {
    federalFilingStatus: 'married_joint',
    stateFilingStatus: 'married_joint',
    federalItemizedDeductionsUSD: 0,
    stateItemizedDeductionsUSD: 0,
    franceHouseholdParts: 2,
    franceDeductionEUR: 0,
    franceSocialRate: 17.2,
  },
  quarterlyPayments: defaultQuarterlyPayments(new Date().getFullYear()),
  stateQuarterlyPayments: defaultQuarterlyPayments(new Date().getFullYear()),
  settlements: [],
}

// ─── Store interface ──────────────────────────────────────────────────────────

interface AppState {
  // Auth
  lmApiKey: string | null
  lmProxyUrl: string | null
  lmProxySecret: string | null
  tiingoApiKey: string | null
  fredApiKey: string | null
  ibkrFlexToken: string | null
  ibkrFlexQueryId: string | null
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
  transfers: Transfer[]
  // Dividend history from Tiingo (persisted)
  dividendHistory: Record<string, import('../lib/tiingo').TickerDividend[]>
  dividendSyncedAt: string | null
  setTickerDividends: (ticker: string, dividends: import('../lib/tiingo').TickerDividend[]) => void
  setDividendSyncedAt: (at: string) => void
  // Display preferences
  minTransactionEUR: number
  setMinTransactionEUR: (val: number) => void
  // Runtime (not persisted)
  simulationResult: SimulationResult | null
  simulationRunning: boolean
  /** Computed by the Investments page — used by the sidebar Net Worth widget */
  portfolioSnapshot: {
    invested: number
    todayPct: number | null
    todayAmt: number | null
    points: Array<{ date: string; value: number }>  // ~7 daily data points
  } | null
  // Actions
  setLmApiKey: (key: string | null) => void
  setLmProxyUrl: (url: string | null) => void
  setLmProxySecret: (secret: string | null) => void
  setTiingoApiKey: (key: string | null) => void
  setFredApiKey: (key: string | null) => void
  setIbkrFlexToken: (key: string | null) => void
  setIbkrFlexQueryId: (key: string | null) => void
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
  upsertTaxSettlement: (settlement: TaxSettlement) => void
  deleteTaxSettlement: (id: string) => void
  setMedicalCoverages: (coverages: MedicalCoverage[]) => void
  upsertMedicalCoverage: (coverage: MedicalCoverage) => void
  deleteMedicalCoverage: (id: string) => void
  setMedicalExpenses: (expenses: MedicalExpense[]) => void
  upsertMedicalExpense: (expense: MedicalExpense) => void
  deleteMedicalExpense: (id: string) => void
  setTransfers: (transfers: Transfer[]) => void
  upsertTransfer: (transfer: Transfer) => void
  deleteTransfer: (id: string) => void
  setSimulationResult: (result: SimulationResult | null) => void
  setSimulationRunning: (running: boolean) => void
  setPortfolioSnapshot: (snap: AppState['portfolioSnapshot']) => void
  mergeNavHistory: (accountId: number, rows: Array<{ date: string; value: number }>) => void
  snapshotPlaidNavToday: () => void
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      // Initial state
      lmApiKey: null,
      lmProxyUrl: null,
      lmProxySecret: null,
      tiingoApiKey: null,
      fredApiKey: null,
      ibkrFlexToken: null,
      ibkrFlexQueryId: null,
      dividendHistory: {},
      dividendSyncedAt: null,
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
      transfers: [],
      minTransactionEUR: 100,
      simulationResult: null,
      simulationRunning: false,
      portfolioSnapshot: null,

      // Actions
      setLmApiKey: (key) => set({ lmApiKey: key }),
      setLmProxyUrl: (url) => set({ lmProxyUrl: url }),
      setLmProxySecret: (secret) => set({ lmProxySecret: secret }),
      setTiingoApiKey: (key) => set({ tiingoApiKey: key }),
      setFredApiKey: (key) => set({ fredApiKey: key }),
      setIbkrFlexToken: (key) => set({ ibkrFlexToken: key }),
      setIbkrFlexQueryId: (key) => set({ ibkrFlexQueryId: key }),
      setTickerDividends: (ticker, dividends) =>
        set((s) => ({ dividendHistory: { ...s.dividendHistory, [ticker]: dividends } })),
      setDividendSyncedAt: (at) => set({ dividendSyncedAt: at }),
      setProfile: (patch) =>
        set((s) => ({ profile: { ...s.profile, ...patch } })),

      setAccounts: (accounts) => set({ accounts }),
      mergeNavHistory: (accountId, rows) =>
        set((s) => ({
          accounts: s.accounts.map((a) => {
            if (a.id !== accountId) return a
            const existing = new Map((a.navHistory ?? []).map((p) => [p.date, p.value]))
            for (const row of rows) {
              if (!existing.has(row.date)) existing.set(row.date, row.value)
            }
            const merged = [...existing.entries()]
              .map(([date, value]) => ({ date, value }))
              .sort((x, y) => x.date.localeCompare(y.date))
            return { ...a, navHistory: merged }
          }),
        })),

      snapshotPlaidNavToday: () =>
        set((s) => {
          const today = new Date().toISOString().slice(0, 10)
          let changed = false
          const accounts = s.accounts.map((a) => {
            if (a.type !== 'investment' && a.type !== 'retirement') return a
            if (!a.plaidAccessToken || a.ibkrAccountId) return a
            if ((a.navHistory ?? []).some(p => p.date === today)) return a
            if (!a.balance || a.balance <= 0) return a
            changed = true
            const existing = new Map((a.navHistory ?? []).map(p => [p.date, p.value]))
            existing.set(today, a.balance)
            const navHistory = [...existing.entries()]
              .map(([date, value]) => ({ date, value }))
              .sort((x, y) => x.date.localeCompare(y.date))
            return { ...a, navHistory }
          })
          return changed ? { accounts } : s
        }),
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
      upsertTaxSettlement: (settlement) =>
        set((s) => ({
          taxConfig: {
            ...s.taxConfig,
            settlements: (s.taxConfig.settlements ?? []).some(item => item.id === settlement.id)
              ? (s.taxConfig.settlements ?? []).map(item => item.id === settlement.id ? settlement : item)
              : [...(s.taxConfig.settlements ?? []), settlement],
          },
        })),
      deleteTaxSettlement: (id) =>
        set((s) => ({
          taxConfig: {
            ...s.taxConfig,
            settlements: (s.taxConfig.settlements ?? []).filter(item => item.id !== id),
          },
        })),

      setMedicalCoverages: (medicalCoverages) => set({ medicalCoverages }),
      upsertMedicalCoverage: (coverage) =>
        set((s) => ({
          medicalCoverages: s.medicalCoverages.some((c) => c.id === coverage.id)
            ? s.medicalCoverages.map((c) => (c.id === coverage.id ? coverage : c))
            : [...s.medicalCoverages, coverage],
        })),
      deleteMedicalCoverage: (id) =>
        set((s) => ({ medicalCoverages: s.medicalCoverages.filter((c) => c.id !== id) })),

      setMedicalExpenses: (medicalExpenses) => set({ medicalExpenses }),
      upsertMedicalExpense: (expense) =>
        set((s) => ({
          medicalExpenses: s.medicalExpenses.some((e) => e.id === expense.id)
            ? s.medicalExpenses.map((e) => (e.id === expense.id ? expense : e))
            : [...s.medicalExpenses, expense],
        })),
      deleteMedicalExpense: (id) =>
        set((s) => ({ medicalExpenses: s.medicalExpenses.filter((e) => e.id !== id) })),

      setTransfers: (transfers) => set({ transfers }),
      upsertTransfer: (transfer) =>
        set((s) => ({
          transfers: s.transfers.some((t) => t.id === transfer.id)
            ? s.transfers.map((t) => (t.id === transfer.id ? transfer : t))
            : [...s.transfers, transfer],
        })),
      deleteTransfer: (id) =>
        set((s) => ({ transfers: s.transfers.filter((t) => t.id !== id) })),

      setMinTransactionEUR: (minTransactionEUR) => set({ minTransactionEUR }),
      setSimulationResult: (simulationResult) => set({ simulationResult }),
      setSimulationRunning: (simulationRunning) => set({ simulationRunning }),
      setPortfolioSnapshot: (portfolioSnapshot) => set({ portfolioSnapshot }),
    }),
    {
      name: 'dinner-money-store',
      // Exclude runtime state from persistence
      partialize: (s) => ({
        lmApiKey: s.lmApiKey,
        lmProxyUrl: s.lmProxyUrl,
        fredApiKey: s.fredApiKey,
        ibkrFlexToken: s.ibkrFlexToken,
        ibkrFlexQueryId: s.ibkrFlexQueryId,
        profile: s.profile,
        accounts: s.accounts,
        pensions: s.pensions,
        realEstateEvents: s.realEstateEvents,
        expenses: s.expenses,
        windfalls: s.windfalls,
        monteCarloConfig: s.monteCarloConfig,
        taxConfig: {
          ...s.taxConfig,
          taxProfile: s.taxConfig.taxProfile ?? defaultTaxConfig.taxProfile,
          // ensure stateQuarterlyPayments is always persisted even if missing from old data
          stateQuarterlyPayments: s.taxConfig.stateQuarterlyPayments ?? defaultQuarterlyPayments(new Date().getFullYear()),
          settlements: s.taxConfig.settlements ?? [],
        },
        medicalCoverages: s.medicalCoverages,
        medicalExpenses: s.medicalExpenses,
        transfers: s.transfers,
        minTransactionEUR: s.minTransactionEUR,
        tiingoApiKey: s.tiingoApiKey,
        dividendHistory: s.dividendHistory,
        dividendSyncedAt: s.dividendSyncedAt,
        portfolioSnapshot: s.portfolioSnapshot,
      }),
      merge: (persistedState: any, currentState) => {
        if (persistedState.avApiKey && !persistedState.tiingoApiKey) {
          persistedState.tiingoApiKey = persistedState.avApiKey
        }
        delete persistedState.avApiKey
        for (const key of ['snap' + 'TradeClientId', 'snap' + 'TradeConsumerKey', 'snap' + 'TradeUserId', 'snap' + 'TradeUserSecret']) {
          delete persistedState[key]
        }
        if (persistedState.profile && persistedState.profile.spouseProjectionEndAge == null) {
          persistedState.profile.spouseProjectionEndAge = persistedState.profile.projectionEndAge ?? currentState.profile.spouseProjectionEndAge
        }
        if (persistedState.taxConfig) {
          persistedState.taxConfig.taxProfile = {
            ...currentState.taxConfig.taxProfile,
            ...(persistedState.taxConfig.taxProfile ?? {}),
          }
        }
        if (persistedState.accounts) {
          persistedState.accounts = persistedState.accounts.map((account: any) => ({
            ...account,
            taxCountry: account.taxCountry ?? undefined,
            ['snap' + 'TradeAccountId']: undefined,
            ['snap' + 'TradeAuthorizationId']: undefined,
            taxLots: account.taxLots?.filter((lot: any) => lot.source !== 'snap' + 'trade'),
          }))
        }
        if (persistedState.pensions) {
          persistedState.pensions = persistedState.pensions.map((p: any) => {
            if (p.monthlyAmount !== undefined) {
              const by = p.person === 'self' ? (persistedState.profile?.birthYear ?? 1975) : (persistedState.profile?.spouseBirthYear ?? 1975)
              return {
                ...p,
                amount: p.monthlyAmount,
                frequency: 'monthly',
                startDate: `${by + (p.startAge || 65)}-01`,
                endDate: null,
              }
            }
            return p
          })
        }
        return { ...currentState, ...persistedState } as AppState
      },
    }
  )
)
