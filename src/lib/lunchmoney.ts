// LunchMoney API client — all calls made browser-side using the user's API key.
// Docs: https://lunchmoney.app/developers

const LM_BASE = 'https://dev.lunchmoney.app/v1'

export class LunchMoneyError extends Error {
  constructor(
    message: string,
    public status?: number
  ) {
    super(message)
    this.name = 'LunchMoneyError'
  }
}

async function lmFetch<T>(path: string, apiKey: string): Promise<T> {
  const res = await fetch(`${LM_BASE}${path}`, {
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
  accounts: LMPlaidAccount[]
}

export interface LMUser {
  user_name: string
  user_email: string
  api_key_label: string | null
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function fetchCurrentUser(apiKey: string): Promise<LMUser> {
  return lmFetch<LMUser>('/me', apiKey)
}

export async function fetchAllAccounts(apiKey: string): Promise<{
  manual: LMAsset[]
  synced: LMPlaidAccount[]
}> {
  const [assetsRes, plaidRes] = await Promise.all([
    lmFetch<LMAssetsResponse>('/assets', apiKey),
    lmFetch<LMPlaidAccountsResponse>('/plaid_accounts', apiKey),
  ])
  return {
    manual: assetsRes.assets,
    synced: plaidRes.accounts,
  }
}

export async function fetchTransactions(
  apiKey: string,
  startDate: string, // YYYY-MM-DD
  endDate: string    // YYYY-MM-DD
) {
  return lmFetch<{ transactions: unknown[] }>(
    `/transactions?start_date=${startDate}&end_date=${endDate}`,
    apiKey
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Map LM account type strings to our AccountType enum */
export function mapLMType(
  typeName: string
): 'investment' | 'retirement' | 'cash' | 'real_estate' | 'other' {
  const t = typeName.toLowerCase()
  if (t.includes('investment') || t.includes('brokerage')) return 'investment'
  if (t.includes('401') || t.includes('ira') || t.includes('retirement')) return 'retirement'
  if (t.includes('checking') || t.includes('savings') || t.includes('cash')) return 'cash'
  if (t.includes('real') || t.includes('property')) return 'real_estate'
  return 'other'
}
