# DinnerMoney / Instructions for CLAUDE

## References
- [LunchMoney](https://lunchmoney.app) is the main reference for banking and transactions. It's also the main source of data. This app should be as consistent as possible in terms of UX, terminology and available features.
- [Boldin](https://boldin.app) is the main reference for everything related to retirement projection.
- [Empower](https://empower.com) is the main reference for everything related to investments.

## Functional notes
- Make sure each indicator is tooltiped

## Technical notes
- **`noUnusedLocals: true`** — unused imports/vars fail CI. Clean up before committing.
- CI: `npm ci` → `npm run type-check` → `npm run build` (tsc -b && vite build)
- **Always run `npm run build` after edits** — `tsc --noEmit` alone does not catch Babel/JSX parse errors or Vite-specific issues. `npm run build` is the only full check.
- **Recharts `content` callbacks** — called for internal/root nodes too (no data props). Always guard: `if (size == null || width == null || width <= 0) return null` at the top of any `Treemap` / custom cell renderer.
- **`formatCompact` / `formatCurrency`** — both can receive `undefined` at runtime (e.g. from Recharts props). Always pass a real number; add `if (amount == null || !isFinite(amount)) return '—'` if the source is untrusted.
- **Tooltip indicators** — always use `<InfoTooltip text="…" />` from `src/components/ui/InfoTooltip.tsx` (circled `?` icon with hover popover). Never use HTML `title` attribute or dotted-underline patterns for metric explanations. Pass the `tooltip` prop to `MetricCard` which renders `InfoTooltip` internally.
- **Sign before currency symbol** — always format signed amounts as `−$10k` / `+€5k`, never `$-10k`. Use `formatCompact(v, currency)` from `src/lib/format.ts` or the local `fmtNative(v, sym)` in `CashFlow.tsx`. Never concatenate `${sym}${formatK(v)}` directly when the value may be negative.
