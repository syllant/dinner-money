# DinnerMoney / Instructions for CLAUDE

- **`noUnusedLocals: true`** — unused imports/vars fail CI. Clean up before committing.
- CI: `npm ci` → `npm run type-check` → `npm run build` (tsc -b && vite build)
