# DinnerMoney — Claude context

## Tech stack

React 18 + TypeScript + Vite 5 + Tailwind CSS 3 + Recharts + Zustand 5. HashRouter (GitHub Pages). Web Worker for Monte Carlo. localStorage via Zustand `persist`. No backend.

## Project structure

```
src/
  App.tsx                  # HashRouter + OnboardingGate (→ /settings if no API key)
  types/index.ts           # Single source of truth for all TypeScript types
  store/useAppStore.ts     # Zustand store with localStorage persistence
  lib/
    lunchmoney.ts          # LM API client; mapLMType(); decodeHtml()
    format.ts              # formatCurrency, formatCompact, generateId
    currency.ts            # DEFAULT_EUR_USD_RATE = 1.08, convertToBase()
  workers/
    montecarlo.worker.ts   # Monte Carlo engine (Box-Muller, 10k sims, Web Worker)
  components/
    layout/AppShell.tsx    # Root layout: sidebar + main
    layout/Sidebar.tsx     # Nav sidebar; logo = <Link to="/">
    ui/                    # Badge, Banner, Button, Card, MetricCard, PageHeader, Table
  pages/
    Dashboard.tsx          # KPI cards, net worth chart, I&E charts, upcoming panels
    Investments.tsx        # Portfolio breakdown
    CashSavings.tsx        # Cash accounts
    IncomeExpenses.tsx     # Year selector, one row per occurrence, income/expense columns
    Tax.tsx                # Federal + CA (side-by-side) + FR quarterly tables
    config/
      Profile.tsx          # Birth years, projection end age, residency timeline (sorted ASC)
      Accounts.tsx         # LM sync; type/allocation per account; include/exclude in planning
      Pensions.tsx         # US SS + FR CNAV/AGIRC estimates
      RealEstate.tsx       # Sell/Buy/Rent events; inline edit pattern
      Expenses.tsx         # Medical coverage + medical expenses + other expenses
      Windfalls.tsx        # Lump-sum events with tax treatment
      Simulation.tsx       # Monte Carlo parameters
      Settings.tsx         # LM API key; CORS proxy; tax rates; export/import/reset
worker/
  lm-proxy.js             # Cloudflare Worker CORS proxy (stateless, no logging)
  wrangler.toml           # name: dinner-money-lm-proxy
```

## Key data model (src/types/index.ts)

```
UserProfile        birthYear, spouseBirthYear, projectionEndAge, baseCurrency, residencyPeriods[]
Account            id (LM id), name, balance, currency, type, allocation{equity,bonds,cash},
                   syncedAt, isManual, typeOverridden?, includedInPlanning?
                   type: investment | retirement | cash | real_estate | loan | credit | other
PensionEstimate    source (US_SS|FR_CNAV|FR_AGIRC|OTHER), person (self|spouse), monthlyAmount, startAge
RealEstateEvent    eventType (sell|buy|rent), date, endDate, amount, currency, isRecurring, notes
Expense            name, amount, frequency (monthly|yearly|one_time), currency, startDate, endDate, category
MedicalCoverage    name, amount, frequency, currency, startDate, endDate  (coverage/premiums)
MedicalExpense     name, amount, frequency, currency, startDate, endDate, category  (out-of-pocket)
Windfall           name, date (YYYY), amount, currency, taxTreatment, notes
TaxConfig          usFederalEffectiveRate, usCaliforniaEffectiveRate, frCombinedEffectiveRate
                   quarterlyPayments[] (IRS/federal), stateQuarterlyPayments[] (CA/FTB)
                   QuarterlyPayment.status?: 'paid'|'todo'|'none'
SimulationResult   (runtime, not persisted) successRate, medianNetWorth[], p10/p90[], years[], safeMonthlySpend
```

## LunchMoney integration

CORS proxy required (Cloudflare Worker). Proxy URL saved as `lmProxyUrl`.

`mapLMType(typeName)` maps LM `type_name` (manual assets) or `subtype || type` (Plaid accounts) → `AccountType`:
- roth/401k/403b/ira/retirement/pension → `retirement`
- investment/brokerage/employee/compensation/rsu → `investment`
- loan/mortgage/student/vehicle/auto/home equity → `loan` (balance negated on sync)
- credit → `credit`
- checking/savings/cash/depository/money market/cd → `cash`
- real estate/property → `real_estate`

Sync preserves user-overridden types (`typeOverridden: true`) and account allocation. Loan balances are negated (LM stores positive principal; we want negative liability).

## Monte Carlo engine

10,000 sims, annual steps, current year → `projectionEndAge`. Correlated equity/bond/FX log-normal draws (Box-Muller). Cash flows: pensions (age-gated), expenses + medicalCoverages + medicalExpenses (date ranges), windfalls (lump-sum), real estate. Only accounts with `includedInPlanning !== false` count toward net worth. Base currency EUR. Web Worker.

## Coding conventions

- Tailwind only — no custom CSS
- `formatCurrency(amount, currency)` for all money; `formatCompact` for KPI cards
- `DEFAULT_EUR_USD_RATE` from `src/lib/currency.ts` for all conversions
- `generateId()` from `src/lib/format.ts` for new record IDs
- Inline edit: local `editing` state → `upsertX()` on save → `setEditing(null)` on cancel (see RealEstate.tsx)
- One default export per file, named after the route/component
- **`noUnusedLocals: true`** — unused imports/vars fail CI. Clean up before committing.
- CI: `npm ci` → `npm run type-check` → `npm run build` (tsc -b && vite build)
