// LunchMoney API client — all calls made browser-side using the user's API key.
// Docs: https://lunchmoney.app/developers

const LM_DIRECT = 'https://dev.lunchmoney.app/v1'

function getBase(proxyUrl?: string | null): string {
  return proxyUrl ? `${proxyUrl.replace(/\/$/, '')}/v1` : LM_DIRECT
}

export class LunchMoneyError extends Error {
  constructor(
    message: string,
    public status?: number
  ) {
    super(message)
    this.name = 'LunchMoneyError'
  }
}

async function lmFetch<T>(path: string, apiKey: string, proxyUrl?: string | null): Promise<T> {
  const base = getBase(proxyUrl)
  const res = await fetch(`${base}${path}`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
  })
  if (!res.ok) {
    throw new LunchMoneyError(
      `LunchMoney API error: ${res.status} ${res.statusText}`,
      res.status
    )
  }
  return res.json() as Promise<T>
}

// ─── Types mirroring LM API responses ────────────────────────────────────────

export interface LMAsset {
  id: number
  name: string
  display_name: string | null
  type_name: string
  balance: string
  currency: string
  closed_on: string | null
  institution_name: string | null
}

export interface LMPlaidAccount {
  id: number
  name: string
  display_name: string | null
  type: string
  subtype: string
  balance: string
  currency: string
  institution_name: string | null
}

export interface LMAssetsResponse {
  assets: LMAsset[]
}

export interface LMPlaidAccountsResponse {
  plaid_accounts: LMPlaidAccount[]
}

export interface LMUser {
  user_name: string
  user_email: string
  api_key_label: string | null
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function fetchCurrentUser(apiKey: string, proxyUrl?: string | null): Promise<LMUser> {
  return lmFetch<LMUser>('/me', apiKey, proxyUrl)
}

export async function fetchAllAccounts(apiKey: string, proxyUrl?: string | null): Promise<{
  manual: LMAsset[]
  synced: LMPlaidAccount[]
}> {
  const [assetsRes, plaidRes] = await Promise.all([
    lmFetch<LMAssetsResponse>('/assets', apiKey, proxyUrl),
    lmFetch<LMPlaidAccountsResponse>('/plaid_accounts', apiKey, proxyUrl),
  ])
  const manual = (assetsRes.assets ?? []).map(a => ({
    ...a,
    name: decodeHtml(a.name),
    display_name: a.display_name ? decodeHtml(a.display_name) : null,
    institution_name: a.institution_name ? decodeHtml(a.institution_name) : null,
  }))
  const synced = (plaidRes.plaid_accounts ?? []).map(a => ({
    ...a,
    name: decodeHtml(a.name),
    display_name: a.display_name ? decodeHtml(a.display_name) : null,
    institution_name: a.institution_name ? decodeHtml(a.institution_name) : null,
  }))
  return { manual, synced }
}

export async function fetchTransactions(
  apiKey: string,
  startDate: string, // YYYY-MM-DD
  endDate: string,   // YYYY-MM-DD
  proxyUrl?: string | null,
) {
  return lmFetch<{ transactions: unknown[] }>(
    `/transactions?start_date=${startDate}&end_date=${endDate}`,
    apiKey,
    proxyUrl,
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Decode HTML entities returned by the LunchMoney API (e.g. &#x27; → ') */
function decodeHtml(str: string): string {
  const txt = document.createElement('textarea')
  txt.innerHTML = str
  return txt.value
}

/** Map LM account type strings to our AccountType enum */
export function mapLMType(typeName: string): import('../types').AccountType {
  const t = typeName.toLowerCase()
  // Retirement / tax-advantaged
  if (t.includes('401') || t.includes('ira') || t.includes('roth') ||
      t.includes('retirement') || t.includes('pension') || t.includes('403')) return 'retirement'
  // Investment / brokerage
  if (t.includes('investment') || t.includes('brokerage')) return 'investment'
  // Loans / debts
  if (t.includes('loan') || t.includes('mortgage') || t.includes('student') ||
      t.includes('vehicle') || t.includes('auto') || t.includes('home equity')) return 'loan'
  // Credit cards
  if (t.includes('credit')) return 'credit'
  // Cash / depository
  if (t.includes('checking') || t.includes('savings') || t.includes('cash') ||
      t.includes('depository') || t.includes('money market') || t.includes('cd')) return 'cash'
  // Real estate (manual asset type_name)
  if (t.includes('real estate') || t.includes('property')) return 'real_estate'
  return 'other'
}
