import type { Account, PlaidHolding, TaxLot, InvestmentEvent } from '../types'
import { computeAllocationFromHoldings } from './plaid'

export interface IbkrFlexStatus {
  ok: boolean
  reachable?: boolean
  message?: string
}

interface ParsedFlexLot {
  accountId: string
  lot: TaxLot
  securityType: string
  price: number
}

function trimSlash(url: string): string {
  return url.replace(/\/$/, '')
}

export async function fetchIbkrFlexStatus(proxyUrl: string): Promise<IbkrFlexStatus> {
  const res = await fetch(`${trimSlash(proxyUrl)}/ibkr-flex/ping`)
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    throw new Error(data?.message ?? `IBKR Flex proxy returned ${res.status}`)
  }
  return data as IbkrFlexStatus
}

export async function fetchIbkrFlexXml(proxyUrl: string, token: string, queryId: string): Promise<string> {
  const res = await fetch(`${trimSlash(proxyUrl)}/ibkr-flex/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, queryId }),
  })
  const text = await res.text()
  if (!res.ok) {
    const data = parseJson(text)
    throw new Error(data?.message ?? data?.error ?? `IBKR Flex API returned ${res.status}`)
  }
  return text
}

function mergeNavHistories(
  existing: Array<{ date: string; value: number }> | undefined,
  ibkr: Array<{ date: string; value: number }> | undefined,
): Array<{ date: string; value: number }> | undefined {
  if (!ibkr?.length) return existing
  const map = new Map<string, number>((existing ?? []).map(p => [p.date, p.value]))
  for (const p of ibkr) map.set(p.date, p.value)
  return [...map.entries()].map(([date, value]) => ({ date, value })).sort((a, b) => a.date.localeCompare(b.date))
}

export async function syncIbkrFlexAccounts(
  accounts: Account[],
  proxyUrl: string,
  token: string,
  queryId: string
): Promise<Account[]> {
  const xml = await fetchIbkrFlexXml(proxyUrl, token, queryId)
  const grouped = parseIbkrFlexXml(xml)
  const cashByAccount = parseIbkrFlexCashHoldings(xml)
  const navByAccount = parseIbkrFlexNavHistory(xml)
  const tradesByAccount = parseIbkrFlexTrades(xml)
  const now = new Date().toISOString()
  return accounts.map(account => {
    const accountId = account.ibkrAccountId?.trim().toUpperCase()
    if (!accountId) return account
    const lots = grouped.get(accountId) ?? []
    const cashHoldings = cashByAccount.get(accountId) ?? []
    if (lots.length === 0 && cashHoldings.length === 0) return account
    const holdings = [...holdingsFromLots(lots), ...cashHoldings]
    const ibkrTrades = tradesByAccount.get(accountId)
    return {
      ...account,
      holdings,
      taxLots: lots.map(item => item.lot),
      allocation: computeAllocationFromHoldings(holdings),
      balance: holdings.reduce((sum, holding) => sum + holding.institutionValue, 0),
      currency: (lots[0]?.lot.currency ?? account.currency).toLowerCase(),
      syncedAt: now,
      navHistory: mergeNavHistories(account.navHistory, navByAccount.get(accountId)),
      investmentEvents: ibkrTrades ?? account.investmentEvents,
    }
  })
}

export function parseIbkrFlexXml(xml: string): Map<string, ParsedFlexLot[]> {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  const parserError = doc.querySelector('parsererror')
  if (parserError) throw new Error('IBKR Flex returned invalid XML.')

  const error = doc.querySelector('Error, FlexStatementResponse error')
  const errorText = error?.textContent?.trim()
  if (errorText) throw new Error(errorText)

  const grouped = new Map<string, ParsedFlexLot[]>()
  const rows = Array.from(doc.querySelectorAll('OpenPosition, Position, Lot, TaxLot'))
  const lotParentKeys = new Set(
    rows
      .filter(row => isFlexLotRow(row))
      .map(row => positionKey(row))
      .filter(Boolean) as string[]
  )
  rows.forEach((row, index) => {
    if (!isFlexLotRow(row) && lotParentKeys.has(positionKey(row) ?? '')) return
    const accountId = inheritedAttr(row, 'accountId', 'account_id', 'account')?.toUpperCase()
    if (!accountId) return
    const quantity = inheritedNumberAttr(row, 'quantity', 'qty', 'position')
    if (quantity == null || quantity === 0) return
    const costBasis = inheritedNumberAttr(row, 'costBasisMoney', 'costBasis', 'costBasisPrice')
    const unrealized = inheritedNumberAttr(row, 'fifoPnlUnrealized', 'unrealizedPnl', 'unrealizedPNL')
    const rawSecurityType = (inheritedAttr(row, 'assetCategory', 'securityType') ?? '').toLowerCase()
    const isDebtInstrument = rawSecurityType.includes('bill') || rawSecurityType.includes('bond')
    // For T-Bills and bonds, use the par/face value (the `position` attribute) rather than the
    // current discounted market price (`positionValue`). Bills are held to maturity and will pay
    // face value, so par is the economically meaningful balance figure.
    const parValue = isDebtInstrument
      ? inheritedNumberAttr(row, 'position', 'quantity', 'qty')
      : null
    const marketValue = parValue
      ?? inheritedNumberAttr(row, 'positionValue', 'marketValue', 'value')
      ?? (costBasis != null && unrealized != null ? costBasis + unrealized : null)
    if (marketValue == null || marketValue === 0) return

    const rawTicker = inheritedAttr(row, 'symbol', 'ticker', 'underlyingSymbol') ?? null
    const rawName = inheritedAttr(row, 'description', 'securityDescription', 'name') ?? rawTicker ?? 'Unknown'
    const currency = (inheritedAttr(row, 'currency', 'reportCurrency') ?? 'USD').toUpperCase()
    const securityType = rawSecurityType || 'equity'
    const acquiredDate = normalizeIbkrDate(inheritedAttr(row, 'openDate', 'openDateTime', 'holdingPeriodDateTime', 'dateOpened', 'dateAcquired', 'acquiredDate', 'tradeDate', 'dateTime'))
    const price = inheritedNumberAttr(row, 'markPrice', 'price') ?? (marketValue / quantity)
    const debtMaturity = normalizeIbkrDate(inheritedAttr(row, 'maturity', 'maturityDate', 'expiry', 'expirationDate')) ?? parseBillDescriptionDate(rawName)
    const name = friendlySecurityName(rawName, securityType, debtMaturity)
    const ticker = friendlyTicker(rawTicker, name, securityType, debtMaturity)
    const idParts = [
      'ibkr-flex',
      accountId,
      inheritedAttr(row, 'conid', 'conId', 'isin', 'cusip') ?? ticker ?? name,
      acquiredDate ?? 'unknown',
      index,
    ]
    const parsed: ParsedFlexLot = {
      accountId,
      securityType,
      price,
      lot: {
        id: idParts.join('-'),
        ticker,
        name,
        quantity,
        marketValue,
        costBasis,
        currency,
        acquiredDate,
        source: 'ibkr-flex',
      },
    }
    grouped.set(accountId, [...(grouped.get(accountId) ?? []), parsed])
  })
  return grouped
}

function isFlexLotRow(row: Element): boolean {
  const tag = row.tagName.toLowerCase()
  if (tag === 'lot' || tag === 'taxlot') return true
  const detail = attr(row, 'levelOfDetail', 'level_of_detail', 'level')?.toLowerCase()
  return detail === 'lot' || detail === 'lots'
}

function positionKey(row: Element): string | null {
  const accountId = inheritedAttr(row, 'accountId', 'account_id', 'account')?.toUpperCase()
  const identifier = inheritedAttr(row, 'conid', 'conId', 'isin', 'cusip', 'securityID', 'securityId', 'figi', 'symbol', 'ticker')
  const currency = inheritedAttr(row, 'currency', 'reportCurrency')?.toUpperCase()
  if (!accountId || !identifier) return null
  return [accountId, identifier, currency ?? ''].join('|')
}

export function parseIbkrFlexAccountIds(xml: string): string[] {
  const ids = new Set<string>()
  parseIbkrFlexXml(xml).forEach((_, accountId) => ids.add(accountId))
  parseIbkrFlexCashHoldings(xml).forEach((_, accountId) => ids.add(accountId))
  return Array.from(ids).sort()
}

export function parseIbkrFlexCashHoldings(xml: string): Map<string, PlaidHolding[]> {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  const grouped = new Map<string, PlaidHolding[]>()
  const rows = Array.from(doc.querySelectorAll('CashReportCurrency'))
  rows.forEach(row => {
    const accountId = inheritedAttr(row, 'accountId', 'account_id', 'account')?.toUpperCase()
    if (!accountId || accountId === 'BASE_SUMMARY') return
    const currency = (inheritedAttr(row, 'currency', 'currencyCode') ?? '').toUpperCase()
    if (!currency || currency === 'BASE' || currency === 'TOTAL' || currency === 'BASE_SUMMARY') return
    const cash = inheritedNumberAttr(row, 'endingCash', 'endingSettledCash', 'endingCashSecurities', 'endingSettledCashSecurities', 'cash', 'quantity', 'amount')
    if (cash == null || cash === 0) return
    const holding: PlaidHolding = {
      ticker: `CUR:${currency}`,
      name: `${currency} cash`,
      quantity: cash,
      institutionPrice: 1,
      institutionValue: cash,
      costBasis: cash,
      currency,
      securityType: 'cash',
    }
    grouped.set(accountId, [...(grouped.get(accountId) ?? []), holding])
  })
  return grouped
}

export function parseIbkrFlexNavHistory(xml: string): Map<string, Array<{ date: string; value: number }>> {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  const grouped = new Map<string, Array<{ date: string; value: number }>>()
  const rows = Array.from(doc.querySelectorAll('EquitySummaryByReportDateInBase'))
  for (const row of rows) {
    const accountId = inheritedAttr(row, 'accountId', 'account_id', 'account')?.toUpperCase()
    if (!accountId || accountId === 'BASE_SUMMARY' || accountId === 'TOTAL') continue
    const reportDate = normalizeIbkrDate(attr(row, 'reportDate', 'report_date', 'date'))
    if (!reportDate) continue
    const total = numberAttr(row, 'total', 'Total', 'netLiquidation', 'equity')
    if (total == null || total === 0) continue
    const series = grouped.get(accountId) ?? []
    if (!series.some(p => p.date === reportDate)) series.push({ date: reportDate, value: total })
    grouped.set(accountId, series)
  }
  for (const [id, series] of grouped) grouped.set(id, series.sort((a, b) => a.date.localeCompare(b.date)))
  return grouped
}

export function parseIbkrFlexTrades(xml: string): Map<string, InvestmentEvent[]> {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  const grouped = new Map<string, InvestmentEvent[]>()
  for (const row of Array.from(doc.querySelectorAll('Trade'))) {
    const accountId = inheritedAttr(row, 'accountId', 'account_id')?.toUpperCase()
    if (!accountId) continue
    const rawBuySell = attr(row, 'buySell', 'buy_sell', 'transactionType')?.toUpperCase() ?? ''
    const isBuy = rawBuySell.startsWith('BUY')
    const isSell = rawBuySell.startsWith('SELL')
    if (!isBuy && !isSell) continue
    const date = normalizeIbkrDate(attr(row, 'tradeDate', 'dateTime', 'date'))
    if (!date) continue
    const amount = Math.abs(numberAttr(row, 'tradeMoney', 'tradeValue', 'proceeds') ?? 0)
    if (amount === 0) continue
    const ticker = attr(row, 'symbol', 'ticker') ?? null
    const name = attr(row, 'description') ?? ticker ?? ''
    const currency = (attr(row, 'currency') ?? 'USD').toUpperCase()
    const quantity = Math.abs(numberAttr(row, 'quantity', 'qty') ?? 0)
    grouped.set(accountId, [...(grouped.get(accountId) ?? []), {
      date,
      type: isBuy ? 'buy' : 'sell',
      ticker,
      name,
      amount,
      currency,
      quantity: quantity > 0 ? quantity : undefined,
    }])
  }
  return grouped
}

function holdingsFromLots(lots: ParsedFlexLot[]): PlaidHolding[] {
  const byKey = new Map<string, ParsedFlexLot[]>()
  lots.forEach(lot => {
    const key = `${lot.lot.ticker ?? lot.lot.name}|${lot.lot.currency}|${lot.securityType}`
    byKey.set(key, [...(byKey.get(key) ?? []), lot])
  })
  return Array.from(byKey.values()).map(group => {
    const first = group[0]
    const quantity = group.reduce((sum, item) => sum + item.lot.quantity, 0)
    const institutionValue = group.reduce((sum, item) => sum + item.lot.marketValue, 0)
    const costBasis = group.reduce((sum, item) => sum + (item.lot.costBasis ?? 0), 0)
    const hasCostBasis = group.some(item => item.lot.costBasis != null)
    return {
      ticker: first.lot.ticker,
      name: first.lot.name,
      quantity,
      institutionPrice: quantity ? institutionValue / quantity : first.price,
      institutionValue,
      costBasis: hasCostBasis ? costBasis : null,
      currency: first.lot.currency,
      securityType: first.securityType,
      purchaseDate: group
        .map(item => item.lot.acquiredDate)
        .filter(Boolean)
        .sort()[0],
    }
  })
}

function attr(el: Element, ...names: string[]): string | undefined {
  for (const name of names) {
    const value = el.getAttribute(name)
    if (value != null && value !== '') return value
  }
  return undefined
}

function inheritedAttr(el: Element, ...names: string[]): string | undefined {
  let current: Element | null = el
  while (current) {
    const value = attr(current, ...names)
    if (value != null) return value
    current = current.parentElement
  }
  return undefined
}

function numberAttr(el: Element, ...names: string[]): number | null {
  for (const name of names) {
    const value = attr(el, name)
    if (value == null) continue
    const parsed = Number(value.replace(/,/g, ''))
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function inheritedNumberAttr(el: Element, ...names: string[]): number | null {
  let current: Element | null = el
  while (current) {
    const value = numberAttr(current, ...names)
    if (value != null) return value
    current = current.parentElement
  }
  return null
}

function shouldSuppressTicker(ticker: string | null, name: string, securityType: string): boolean {
  if (!ticker) return false
  const normalizedType = securityType.toLowerCase()
  const looksLikeCusip = /^[0-9A-Z]{9}$/.test(ticker)
  const isDebt = normalizedType.includes('bill') || normalizedType.includes('bond') || normalizedType.includes('fixed')
  return looksLikeCusip && isDebt && name !== ticker
}

function friendlyTicker(ticker: string | null, name: string, securityType: string, maturity?: string): string | null {
  if (!ticker) return null
  if (!shouldSuppressTicker(ticker, name, securityType)) return ticker
  return maturity ? `T-Bill ${maturity}` : 'T-Bill'
}

function friendlySecurityName(name: string, securityType: string, maturity?: string): string {
  const parsedBillDate = maturity ?? parseBillDescriptionDate(name)
  if (!parsedBillDate) return name
  const normalizedType = securityType.toLowerCase()
  if (!normalizedType.includes('bill') && !normalizedType.includes('bond') && !normalizedType.includes('fixed')) return name
  return `US-T Govt Bill ${formatBillDate(parsedBillDate)}`
}

function parseBillDescriptionDate(name: string): string | undefined {
  const match = name.trim().match(/^B\s+(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/i)
  if (!match) return undefined
  const month = match[1].padStart(2, '0')
  const day = match[2].padStart(2, '0')
  const year = match[3].length === 2 ? `20${match[3]}` : match[3]
  return `${year}-${month}-${day}`
}

function formatBillDate(date: string): string {
  const [year, month, day] = date.split('-')
  const monthName = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Math.max(0, Number(month) - 1)] ?? month
  return `${monthName}${Number(day)}'${year.slice(2)}`
}

function normalizeIbkrDate(value?: string): string | undefined {
  if (!value) return undefined
  const trimmed = value.trim()
  const embeddedIso = trimmed.match(/\d{4}-\d{2}-\d{2}/)
  if (embeddedIso) return embeddedIso[0]
  const embeddedCompact = trimmed.match(/\b\d{8}\b/)
  if (embeddedCompact) return `${embeddedCompact[0].slice(0, 4)}-${embeddedCompact[0].slice(4, 6)}-${embeddedCompact[0].slice(6, 8)}`
  const embeddedSlash = trimmed.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\b/)
  if (embeddedSlash) {
    const year = embeddedSlash[3].length === 2 ? `20${embeddedSlash[3]}` : embeddedSlash[3]
    return `${year}-${embeddedSlash[1].padStart(2, '0')}-${embeddedSlash[2].padStart(2, '0')}`
  }
  const datePart = trimmed.split(/[; T]/)[0]
  if (/^\d{4}-\d{2}-\d{2}$/.test(datePart)) return datePart
  if (/^\d{4}\d{2}\d{2}$/.test(datePart)) return `${datePart.slice(0, 4)}-${datePart.slice(4, 6)}-${datePart.slice(6, 8)}`
  const slash = datePart.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/)
  if (slash) {
    const year = slash[3].length === 2 ? `20${slash[3]}` : slash[3]
    return `${year}-${slash[1].padStart(2, '0')}-${slash[2].padStart(2, '0')}`
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed
  if (/^\d{8}$/.test(trimmed)) return `${trimmed.slice(0, 4)}-${trimmed.slice(4, 6)}-${trimmed.slice(6, 8)}`
  const parsed = new Date(trimmed)
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString().slice(0, 10)
}

function parseJson(text: string): any {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}
