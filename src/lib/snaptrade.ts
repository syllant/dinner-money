import type { Account, PlaidHolding } from '../types'
import { computeAllocationFromHoldings, deriveTaxLots } from './plaid'

export interface SnapTradeStatus {
  version?: number
  timestamp?: string
  online?: boolean
}

export interface SnapTradePing {
  ok: boolean
  client_id_set: boolean
  consumer_key_set: boolean
  upstream?: SnapTradeStatus
  message?: string
}

export interface SnapTradeUser {
  userId: string
  userSecret: string
}

export interface SnapTradeLogin {
  redirectURI?: string
  redirectUri?: string
}

type SnapTradeAccount = Record<string, any>
type SnapTradeBalance = Record<string, any>
type SnapTradePosition = Record<string, any>
export type SnapTradeRaw = Record<string, any>
interface SnapTradeAuth {
  clientId?: string | null
  consumerKey?: string | null
}

function trimSlash(url: string): string {
  return url.replace(/\/$/, '')
}

export async function fetchSnapTradeStatus(
  proxyUrl: string,
  clientId?: string | null,
  consumerKey?: string | null
): Promise<SnapTradePing> {
  const headers: Record<string, string> = {}
  if (clientId?.trim()) headers['X-SnapTrade-Client-Id'] = clientId.trim()
  if (consumerKey?.trim()) headers['X-SnapTrade-Consumer-Key'] = consumerKey.trim()
  const res = await fetch(`${trimSlash(proxyUrl)}/snaptrade/ping`, { headers })
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    const message = data && typeof data.message === 'string'
      ? data.message
      : `SnapTrade proxy returned ${res.status}`
    throw new Error(message)
  }
  return data as SnapTradePing
}

export async function registerSnapTradeUser(proxyUrl: string, userId: string, auth?: SnapTradeAuth): Promise<SnapTradeUser> {
  return snapTradeFetch(proxyUrl, '/snapTrade/registerUser', {
    method: 'POST',
    body: { userId },
    auth,
  }) as Promise<SnapTradeUser>
}

export async function createSnapTradeLoginLink(
  proxyUrl: string,
  userId: string,
  userSecret: string,
  customRedirect?: string,
  auth?: SnapTradeAuth
): Promise<string> {
  const body = {
    userId,
    userSecret,
    connectionType: 'read',
    connectionPortalVersion: 'v4',
    showCloseButton: true,
    immediateRedirect: true,
    ...(customRedirect ? { customRedirect } : {}),
  }
  try {
    const data = await snapTradeFetch(proxyUrl, '/snapTrade/login', {
      method: 'POST',
      query: { userId, userSecret },
      body,
      auth,
    }) as SnapTradeLogin
    return data.redirectURI ?? data.redirectUri ?? ''
  } catch {
    const data = await snapTradeFetch(proxyUrl, '/snapTrade/login', {
      query: {
        userId,
        userSecret,
        connectionType: 'read',
        connectionPortalVersion: 'v4',
        immediateRedirect: 'true',
        ...(customRedirect ? { customRedirect } : {}),
      },
      auth,
    }) as SnapTradeLogin
    return data.redirectURI ?? data.redirectUri ?? ''
  }
}

export async function syncSnapTradeAccounts(
  proxyUrl: string,
  userId: string,
  userSecret: string,
  existingAccounts: Account[],
  auth?: SnapTradeAuth
): Promise<Account[]> {
  const accounts = await snapTradeFetch(proxyUrl, '/accounts', {
    query: { userId, userSecret },
    auth,
  }) as SnapTradeAccount[]
  const now = new Date().toISOString()
  const synced = await Promise.all((accounts ?? [])
    .filter(account => String(account.status ?? 'open').toLowerCase() !== 'closed')
    .map(async account => snapTradeAccountToPlanningAccount(proxyUrl, userId, userSecret, account, now, auth)))
  const syncedById = new Map(synced.map(account => [account.id, account]))
  const previous = new Map(existingAccounts.map(account => [account.id, account]))

  const mergedSynced = synced.map(account => {
    const existing = previous.get(account.id)
    if (!existing) return account
    return {
      ...account,
      includedInPlanning: existing.includedInPlanning,
      taxCountry: existing.taxCountry,
      interestRate: existing.interestRate,
      dueDate: existing.dueDate,
      fxSplitEUR: existing.fxSplitEUR,
      fxSplitEURRef: existing.fxSplitEURRef,
      ...(existing.typeOverridden ? { type: existing.type, typeOverridden: true } : {}),
    }
  })

  return [
    ...existingAccounts.filter(account => !account.snapTradeAccountId || !syncedById.has(account.id)),
    ...mergedSynced,
  ]
}

export async function fetchSnapTradeConnections(
  proxyUrl: string,
  userId: string,
  userSecret: string,
  auth?: SnapTradeAuth
): Promise<SnapTradeRaw[]> {
  return snapTradeFetch(proxyUrl, '/authorizations', {
    query: { userId, userSecret },
    auth,
  }) as Promise<SnapTradeRaw[]>
}

export async function fetchSnapTradeAccountsRaw(
  proxyUrl: string,
  userId: string,
  userSecret: string,
  auth?: SnapTradeAuth
): Promise<SnapTradeRaw[]> {
  return snapTradeFetch(proxyUrl, '/accounts', {
    query: { userId, userSecret },
    auth,
  }) as Promise<SnapTradeRaw[]>
}

export async function fetchSnapTradeConnectionDetail(
  proxyUrl: string,
  userId: string,
  userSecret: string,
  authorizationId: string,
  auth?: SnapTradeAuth
): Promise<SnapTradeRaw> {
  return snapTradeFetch(proxyUrl, `/authorizations/${encodeURIComponent(authorizationId)}`, {
    query: { userId, userSecret },
    auth,
  }) as Promise<SnapTradeRaw>
}

export async function refreshSnapTradeConnection(
  proxyUrl: string,
  userId: string,
  userSecret: string,
  authorizationId: string,
  auth?: SnapTradeAuth
): Promise<void> {
  await snapTradeFetch(proxyUrl, `/authorizations/${encodeURIComponent(authorizationId)}/refresh`, {
    method: 'POST',
    query: { userId, userSecret },
    auth,
  })
}

async function snapTradeAccountToPlanningAccount(
  proxyUrl: string,
  userId: string,
  userSecret: string,
  account: SnapTradeAccount,
  syncedAt: string,
  auth?: SnapTradeAuth
): Promise<Account> {
  const accountId = String(account.id)
  const [balances, positions] = await Promise.all([
    snapTradeFetch(proxyUrl, `/accounts/${encodeURIComponent(accountId)}/balances`, {
      query: { userId, userSecret },
      auth,
    }).catch(() => []),
    snapTradeFetch(proxyUrl, `/accounts/${encodeURIComponent(accountId)}/positions`, {
      query: { userId, userSecret },
      auth,
    }).catch(() => []),
  ]) as [SnapTradeBalance[], SnapTradePosition[]]
  const currency = account.balance?.total?.currency ?? account.currency ?? firstCurrency(balances) ?? 'USD'
  const balance = numberValue(account.balance?.total?.amount)
    ?? sumPositionValue(positions)
    + balances.reduce((sum, balanceRow) => sum + (numberValue(balanceRow.cash) ?? 0), 0)
  const holdings = [
    ...positions.map(snapTradePositionToHolding).filter(Boolean) as PlaidHolding[],
    ...balances
      .map(balanceRow => snapTradeCashHolding(balanceRow))
      .filter(Boolean) as PlaidHolding[],
  ]
  return {
    id: stableNegativeId(accountId),
    lmId: stableNegativeId(accountId),
    name: [account.institution_name ?? account.meta?.institution_name, account.name].filter(Boolean).join(' · ') || 'SnapTrade account',
    balance,
    currency: String(currency).toLowerCase(),
    type: snapTradeAccountType(account),
    allocation: computeAllocationFromHoldings(holdings),
    syncedAt,
    isManual: false,
    snapTradeAccountId: accountId,
    snapTradeAuthorizationId: snapTradeAuthorizationId(account),
    holdings,
    taxLots: deriveTaxLots(holdings, 'snaptrade'),
    taxCountry: undefined,
  }
}

function snapTradePositionToHolding(position: SnapTradePosition): PlaidHolding | null {
  const symbol = position.symbol?.symbol ?? position.symbol?.ticker ?? position.symbol?.raw_symbol ?? position.symbol
  const ticker = typeof symbol === 'string' ? symbol : null
  const quantity = numberValue(position.units ?? position.quantity ?? position.open_quantity)
  const marketValue = numberValue(position.market_value ?? position.marketValue ?? position.value)
  const price = numberValue(position.price ?? position.last_price ?? position.average_purchase_price)
  if ((quantity == null || quantity === 0) && (marketValue == null || marketValue === 0)) return null
  const currency = position.currency?.code ?? position.currency ?? position.symbol?.currency?.code ?? 'USD'
  const securityType = String(position.symbol?.type?.description ?? position.symbol?.type ?? position.type ?? 'equity').toLowerCase()
  const averagePurchasePrice = numberValue(position.average_purchase_price)
  const explicitCostBasis = numberValue(position.cost_basis ?? position.costBasis)
  const costBasis = explicitCostBasis ?? (averagePurchasePrice != null && quantity != null
    ? averagePurchasePrice * quantity
    : null)
  return {
    ticker,
    name: position.symbol?.description ?? position.symbol?.name ?? position.description ?? ticker ?? 'Unknown',
    quantity: quantity ?? 0,
    institutionPrice: price ?? (marketValue != null && quantity ? marketValue / quantity : 0),
    institutionValue: marketValue ?? ((quantity ?? 0) * (price ?? 0)),
    costBasis,
    currency: String(currency).toUpperCase(),
    securityType,
  }
}

function snapTradeCashHolding(balance: SnapTradeBalance): PlaidHolding | null {
  const cash = numberValue(balance.cash)
  if (cash == null || cash === 0) return null
  const currency = balance.currency?.code ?? balance.currency ?? 'USD'
  const code = String(currency).toUpperCase()
  return {
    ticker: `CUR:${code}`,
    name: `${code} cash`,
    quantity: cash,
    institutionPrice: 1,
    institutionValue: cash,
    costBasis: cash,
    currency: code,
    securityType: 'cash',
  }
}


async function snapTradeFetch(
  proxyUrl: string,
  path: string,
  options: { method?: 'GET' | 'POST'; body?: object; query?: Record<string, string>; auth?: SnapTradeAuth } = {}
): Promise<unknown> {
  const url = new URL(`${trimSlash(proxyUrl)}/snaptrade${path}`)
  Object.entries(options.query ?? {}).forEach(([key, value]) => url.searchParams.set(key, value))
  const headers: Record<string, string> = {}
  if (options.body) headers['Content-Type'] = 'application/json'
  if (options.auth?.clientId?.trim()) headers['X-SnapTrade-Client-Id'] = options.auth.clientId.trim()
  if (options.auth?.consumerKey?.trim()) headers['X-SnapTrade-Consumer-Key'] = options.auth.consumerKey.trim()
  const res = await fetch(url, {
    method: options.method ?? 'GET',
    headers: Object.keys(headers).length > 0 ? headers : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    const message = data && typeof data === 'object' && 'message' in data
      ? String((data as { message?: unknown }).message)
      : data && typeof data === 'object' && 'detail' in data
        ? String((data as { detail?: unknown }).detail)
        : `SnapTrade API returned ${res.status}`
    throw new Error(message)
  }
  return data
}

function snapTradeAccountType(account: SnapTradeAccount): Account['type'] {
  const raw = String(account.raw_type ?? account.meta?.type ?? account.name ?? '').toLowerCase()
  if (raw.includes('ira') || raw.includes('401') || raw.includes('retirement') || raw.includes('rrsp')) return 'retirement'
  return 'investment'
}

function snapTradeAuthorizationId(account: SnapTradeAccount): string | undefined {
  const value = account.brokerage_authorization ?? account.brokerageAuthorization ?? account.authorization
  if (typeof value === 'string') return value
  if (value && typeof value === 'object' && typeof value.id === 'string') return value.id
  return undefined
}

function firstCurrency(balances: SnapTradeBalance[]): string | null {
  return balances.map(row => row.currency?.code ?? row.currency).find(Boolean) ?? null
}

function numberValue(value: unknown): number | null {
  if (value == null || value === '') return null
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function sumPositionValue(positions: SnapTradePosition[]): number {
  return positions.reduce((sum, position) => sum + (numberValue(position.market_value ?? position.marketValue ?? position.value) ?? 0), 0)
}

function stableNegativeId(value: string): number {
  let hash = 0
  for (let i = 0; i < value.length; i++) hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0
  return -Math.max(1, Math.abs(hash))
}
