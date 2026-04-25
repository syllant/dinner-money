# DinnerMoney — Claude context

## What this project is

**DinnerMoney** is a local-first browser SPA for retirement planning, built as a personal companion to [LunchMoney](https://lunchmoney.app) ("lunch → dinner, career → retirement").

**Why it exists:** Boldin and similar tools don't support French pension systems, multi-currency EUR/USD portfolios, or LunchMoney account sync. This app is free, self-hosted on GitHub Pages, and keeps all data in the browser — nothing is ever sent to a server.

**Target user:** Folks with a multi-country retirement situation, multi-currency assets, and a desire to model retirement cash flows without paying for an inadequate SaaS tool.

## Tech stack

- **React 18** + **TypeScript** + **Vite 5** + **Tailwind CSS 3** + **Recharts** + **Zustand 5**
- **HashRouter** — required for GitHub Pages (no server-side routing support)
- **Web Workers** — Monte Carlo simulation runs off the main thread (10k simulations)
- **localStorage** via Zustand `persist` middleware — all data stays in the browser
- **LunchMoney API** called browser-side through a Cloudflare Worker CORS proxy (see below)
- No backend, no database, no authentication server

## Project structure

```
src/
  App.tsx                        # HashRouter + OnboardingGate (redirects to /settings if no API key)
  types/index.ts                 # All shared TypeScript types (single source of truth)
  store/useAppStore.ts           # Zustand store with localStorage persistence
  lib/
    lunchmoney.ts                # LunchMoney API client (proxy-aware); mapLMType(); decodeHtml()
    format.ts                    # formatCurrency (navigator.language), formatCompact, generateId
    currency.ts                  # DEFAULT_EUR_USD_RATE = 1.08, convertToBase()
  workers/
    montecarlo.worker.ts         # Monte Carlo engine (Box-Muller, correlated log-normal draws)
  components/
    layout/AppShell.tsx          # Root layout: sidebar + main content area
    layout/Sidebar.tsx           # Nav sidebar; "DinnerMoney" logo is <Link to="/"> (home)
    ui/                          # Badge, Banner, Button, Card, MetricCard, PageHeader, Table
  pages/
    Dashboard.tsx                # Net worth projection chart, Monte Carlo KPIs, income/expense bar chart
    Investments.tsx              # Portfolio breakdown by type/currency; allocation editor
    CashSavings.tsx              # Cash & savings accounts summary
    IncomeExpenses.tsx           # Cash-flow view: year selector, one row per occurrence, net total at top
    Tax.tsx                      # US federal (IRS) + CA state (FTB) quarterly payment tables; FR estimate
    config/
      Profile.tsx                # Birth years, projection end age, residency timeline (add/edit/delete)
      Accounts.tsx               # LM sync; green/+ positive, red/- negative balances; type selector
      Pensions.tsx               # US SS + FR CNAV/AGIRC pension estimates (manual entry)
      RealEstate.tsx             # Sell/Buy/Rent events; start + end date; amount/currency
      Expenses.tsx               # Monthly/yearly/one-time expenses; date ranges
      Windfalls.tsx              # Lump-sum events (stock sales, inheritance) with tax treatment
      Simulation.tsx             # Monte Carlo parameters (return assumptions, correlations)
      Settings.tsx               # LM API key; CORS proxy URL; tax rates; export/import/reset
worker/
  lm-proxy.js                    # Cloudflare Worker CORS proxy — deployed separately
  wrangler.toml                  # Cloudflare Worker config (name: dinner-money-lm-proxy)
```

## Key data model (src/types/index.ts)

```
UserProfile        birthYear, spouseBirthYear, projectionEndAge, baseCurrency, residencyPeriods[]
Account            id (LM id), name, balance, currency, type, allocation{equity,bonds,cash}, syncedAt
                   type: investment | retirement | cash | real_estate | loan | credit | other
PensionEstimate    source (US_SS|FR_CNAV|FR_AGIRC|OTHER), person (self|spouse), monthlyAmount, startAge
RealEstateEvent    eventType (sell|buy|rent), date, endDate, amount, currency, isRecurring
Expense            name, amount, frequency (monthly|yearly|one_time), currency, startDate, endDate
Windfall           name, date (YYYY), amount, currency, taxTreatment (CAPITAL_GAINS_LT/ST|ORDINARY_INCOME|TAX_FREE)
TaxConfig          usFederalEffectiveRate, usCaliforniaEffectiveRate, frCombinedEffectiveRate
                   quarterlyPayments[] (IRS/federal), stateQuarterlyPayments[] (CA/FTB)
SimulationResult   (runtime, not persisted) successRate, medianNetWorth[], p10/p90[], years[], safeMonthlySpend
```

## LunchMoney integration

LM's API (`https://dev.lunchmoney.app/v1`) blocks direct browser requests via a CORS origin allowlist. A **Cloudflare Worker proxy** is required — it forwards requests to LM and strips the `Access-Control-Allow-Credentials: true` header that would otherwise conflict with `Access-Control-Allow-Origin: *`.

- Proxy source: `worker/lm-proxy.js` — stateless, no logging, no data stored
- Deploy: `cd worker && wrangler deploy`
- Proxy URL saved to Zustand as `lmProxyUrl` (persisted); configured in Settings → CORS proxy
- All `lmFetch()` calls accept optional `proxyUrl`; `getBase()` selects direct vs proxy
- Account names are HTML-entity decoded on import (`decodeHtml()` using `<textarea>` trick)
- `mapLMType()` maps LM `type_name`/`subtype` strings → our `AccountType`:
  - roth/401k/403b/ira/retirement → `retirement`
  - brokerage/investment → `investment`
  - loan/mortgage/student/auto/vehicle/home equity → `loan`
  - credit (card) → `credit`
  - checking/savings/cash/depository/money market/cd → `cash`
  - real estate/property → `real_estate`

## Monte Carlo engine

- 10,000 simulations, annual time steps from current year to `projectionEndAge`
- Correlated equity/bond/FX log-normal draws using Box-Muller transform
- Annual cash flows modelled: pensions (age-gated), expenses (with date ranges), windfalls (lump-sum years), real estate events
- Base currency EUR; USD amounts converted at `eurUsdSpot`
- Outputs: `successRate` (% of runs ending with positive net worth), `medianNetWorth[]`, `p10/p90[]`, `years[]`, `safeMonthlySpend` (found via bisection at the configured success threshold)
- Runs in a Web Worker to avoid blocking the UI; auto-triggered on first load when accounts exist

## Feature specifications

### Dashboard
- 4 KPI cards: success probability, net worth today, median NW at age 80, safe monthly spend
- Projected net worth area chart (median + p10/p90 band) with life event pins (sell home, buy home, pension starts, RMDs)
- Income vs expenses bar chart (every 3 years, in base currency)
- Upcoming expenses panel (next 5)

### Investments
- Total invested (investment + retirement accounts), projected dividends (~2.2% yield placeholder)
- Asset type breakdown: equity/bonds/cash (weighted by balance, from per-account allocation)
- Currency exposure pie (EUR vs USD)
- Capital gains summary (links to Windfalls for realised gains)
- Transaction history: placeholder until LM transaction sync is built (Phase 3)

### Cash & Savings
- Cash accounts (type=cash) summary

### Income & Expenses
- Year selector (prev year / current year / next 2 years); default = current year
- Net total bar at top (income − expenses in EUR)
- Two-column layout: Income | Expenses
- **One row per occurrence**: monthly expense → 12 rows; yearly → 1 row; one-time → 1 row
- Income sources: pensions (active in selected year, one row/month), windfalls (lump sum)
- Expense sources: configured expenses expanded by frequency, quarterly tax payments (IRS + FTB)
- All amounts shown in original currency; totals converted to EUR at DEFAULT_EUR_USD_RATE
- Badge types: received / projected / recurring / one_time / tax / windfall

### Tax
- Consolidated estimate at top (US federal + CA state + FR partial, all in EUR)
- US column: federal + CA effective rate cards; two independent quarterly payment tables (IRS and FTB)
  - Each table row: quarter, due date, paid (editable), estimated (editable), status badge
- FR column: partial-year estimate (first ~2 months of residency) + first full year estimate
  - Single combined IR+PS effective rate
  - Note: US SS benefits generally exempt under US-FR tax treaty

### Configuration — Accounts
- Sync button calls `/assets` + `/plaid_accounts` in parallel via proxy
- Merges: preserves existing account allocation and type on re-sync
- Balance display: green + prefix for positive, red − prefix for negative (loans are negative)
- Per-account: type selector (7 types), equity/bonds/cash allocation (editable inline)

### Configuration — Profile
- Birth years, projection end age, base currency
- Residency timeline: add/edit/delete periods with country + start/end date
- **No COBRA field** — model COBRA as a regular monthly expense in Expenses config

### Configuration — Real Estate
- Event types: Sell / Buy / Rent
- Fields: start date, end date (shown as "ongoing" if null, required for rentals), amount, currency, notes
- Rent events: isRecurring=true, amount = monthly rent

### Configuration — Settings
- LM API key (password field; Save button + Test Connection button)
- Test Connection also saves both key and proxy URL on success; shows "Go to Accounts →" CTA
- CORS proxy URL (expandable deployment instructions for Cloudflare Worker)
- Tax effective rates (US federal, CA, FR combined)
- Data: export JSON / import JSON / reset all

### Onboarding
- `OnboardingGate` in App.tsx: if `lmApiKey` is null, any route redirects to `/settings`
- After first successful test connection, banner links to Accounts to trigger sync

## CI / Deploy

- GitHub Actions: `.github/workflows/ci.yml`
- `build` job: `npm ci` → `npm run type-check` → `npm run build`
- `deploy` job (main branch only): rebuild → upload `dist/` → deploy to GitHub Pages
- Build command: `tsc -b && vite build`
- **`noUnusedLocals: true`** — unused imports/variables fail CI. Always clean up before committing.

## Roadmap

### Phase 2 (next)
- [ ] Holdings sub-page: manual positions (ticker, shares) + live price fetch (Yahoo Finance or Alpha Vantage) for asset-type breakdown
- [ ] Real EUR/USD spot rate fetch (currently hardcoded 1.08 in `src/lib/currency.ts`)
- [ ] Withdrawal sequencing: taxable → tax-deferred → Roth draw-down order
- [ ] Roth conversion window optimizer (low-income years before SS/pension start)

### Phase 3
- [ ] LunchMoney transaction sync (`/v1/transactions`) for actual vs planned spending
- [ ] French pension AGIRC-ARRCO estimate from uploaded relevé de carrière PDF

## Coding conventions

- Tailwind utility classes only — no custom CSS files
- `formatCurrency(amount, currency)` for all monetary display (locale-aware via `navigator.language`)
- `formatCompact(amount, currency)` for dashboard metric cards
- `DEFAULT_EUR_USD_RATE` from `src/lib/currency.ts` for all EUR/USD conversions
- `generateId()` from `src/lib/format.ts` for new record IDs (random base-36)
- Inline edit forms: local `editing` state, `upsertX()` on save, `setEditing(null)` on cancel
  — follow the pattern in `src/pages/config/RealEstate.tsx`
- One default export per file, named after the route/component
- Keep `src/types/index.ts` as the single source of truth for all types
