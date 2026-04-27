# DinnerMoney / Instructions for CLAUDE

- **`noUnusedLocals: true`** — unused imports/vars fail CI. Clean up before committing.
- CI: `npm ci` → `npm run type-check` → `npm run build` (tsc -b && vite build)
- **Recharts `content` callbacks** — called for internal/root nodes too (no data props). Always guard: `if (size == null || width == null || width <= 0) return null` at the top of any `Treemap` / custom cell renderer.
- **`formatCompact` / `formatCurrency`** — both can receive `undefined` at runtime (e.g. from Recharts props). Always pass a real number; add `if (amount == null || !isFinite(amount)) return '—'` if the source is untrusted.
