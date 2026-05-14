import { fetchAllAccounts, mapLMType } from './lunchmoney'
import { syncPlaidInvestmentAccount } from './investmentSync'
import { syncIbkrFlexAccounts } from './ibkrFlex'
import type { Account } from '../types'

export const LM_FULL_SYNC_TTL = 24 * 60 * 60 * 1000
export const LM_FAST_SYNC_TTL = 60 * 60 * 1000

export async function syncAllAccounts(params: {
  lmApiKey: string
  lmProxyUrl: string | null
  ibkrFlexToken: string | null
  ibkrFlexQueryId: string | null
  existingAccounts: Account[]
  allowIbkrSync?: boolean
  allowPlaidSync?: boolean
}): Promise<Account[]> {
  const { lmApiKey, lmProxyUrl, ibkrFlexToken, ibkrFlexQueryId, existingAccounts, allowIbkrSync = true, allowPlaidSync = true } = params

  const { manual, synced } = await fetchAllAccounts(lmApiKey, lmProxyUrl)
  const now = new Date().toISOString()

  const mapped: Account[] = [
    ...manual.filter(a => !a.closed_on).map(a => {
      const type = mapLMType(a.type_name)
      const rawBalance = parseFloat(a.balance)
      return {
        id: a.id, lmId: a.id,
        name: a.display_name ?? a.name,
        institutionName: a.institution_name ?? undefined,
        balance: (type === 'loan' || type === 'credit') ? -rawBalance : rawBalance,
        currency: a.currency,
        type,
        allocation: { equity: 0, bonds: 0, cash: 100 },
        syncedAt: now,
        isManual: true,
      }
    }),
    ...synced.map(a => {
      const type = mapLMType(a.subtype || a.type)
      const rawBalance = parseFloat(a.balance)
      return {
        id: a.id, lmId: a.id,
        name: a.display_name ?? a.name,
        institutionName: a.institution_name ?? undefined,
        balance: (type === 'loan' || type === 'credit') ? -rawBalance : rawBalance,
        currency: a.currency,
        type,
        allocation: { equity: 0, bonds: 0, cash: 100 },
        syncedAt: now,
        isManual: false,
      }
    }),
  ]

  const existing = new Map(existingAccounts.map(a => [a.id, a]))
  let merged = mapped.map(a => {
    const ex = existing.get(a.id)
    if (!ex) return a
    return {
      ...a,
      allocation: ex.allocation,
      includedInPlanning: ex.includedInPlanning,
      interestRate: ex.interestRate,
      dueDate: ex.dueDate,
      taxCountry: ex.taxCountry,
      ...(ex.typeOverridden ? { type: ex.type, typeOverridden: true } : {}),
      plaidAccessToken: ex.plaidAccessToken,
      plaidItemId: ex.plaidItemId,
      ibkrAccountId: ex.ibkrAccountId,
      fxSplitEUR: ex.fxSplitEUR,
      fxSplitEURRef: ex.fxSplitEURRef,
      holdings: ex.holdings,
      dividends: ex.dividends,
      taxLots: ex.taxLots,
      navHistory: ex.navHistory,
    }
  })

  // Override balances for connected accounts with authoritative broker data.
  // IBKR: use latest navHistory entry (populated by full sync; survives fast syncs).
  // Plaid: syncPlaidInvestmentAccount below sets balance from holdings sum.
  for (const acc of merged) {
    if (acc.ibkrAccountId?.trim() && acc.navHistory?.length) {
      acc.balance = acc.navHistory[acc.navHistory.length - 1].value
    }
  }

  if (allowPlaidSync && lmProxyUrl) {
    for (const acc of merged) {
      if (acc.plaidAccessToken && !acc.ibkrAccountId) {
        try {
          const result = await syncPlaidInvestmentAccount(acc, lmProxyUrl)
          Object.assign(acc, result)
        } catch (err) {
          console.error(`[Plaid] Investment sync failed for ${acc.name}:`, err)
        }
      }
    }
  }

  if (allowIbkrSync && lmProxyUrl && ibkrFlexToken && ibkrFlexQueryId && merged.some(acc => acc.ibkrAccountId?.trim())) {
    merged = await syncIbkrFlexAccounts(merged, lmProxyUrl, ibkrFlexToken, ibkrFlexQueryId)
    // syncIbkrFlexAccounts already computes balance from fresh holdings, so no further override needed.
  }

  return merged
}

/** Fast sync: updates LunchMoney account balances only. Skips Plaid and IBKR Flex. */
export async function fastSyncAccounts(params: {
  lmApiKey: string
  lmProxyUrl: string | null
  existingAccounts: Account[]
}): Promise<Account[]> {
  return syncAllAccounts({
    ...params,
    ibkrFlexToken: null,
    ibkrFlexQueryId: null,
    allowIbkrSync: false,
    allowPlaidSync: false,
  })
}
