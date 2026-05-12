import { useAppStore } from '../store/useAppStore'

export function serializeStore(): string {
  const s = useAppStore.getState()
  return JSON.stringify({
    lmApiKey: s.lmApiKey,
    lmProxyUrl: s.lmProxyUrl,
    tiingoApiKey: s.tiingoApiKey,
    fredApiKey: s.fredApiKey,
    ibkrFlexToken: s.ibkrFlexToken,
    ibkrFlexQueryId: s.ibkrFlexQueryId,
    profile: s.profile,
    accounts: s.accounts,
    pensions: s.pensions,
    realEstateEvents: s.realEstateEvents,
    expenses: s.expenses,
    windfalls: s.windfalls,
    monteCarloConfig: s.monteCarloConfig,
    taxConfig: s.taxConfig,
    medicalCoverages: s.medicalCoverages,
    medicalExpenses: s.medicalExpenses,
    transfers: s.transfers,
    minTransactionEUR: s.minTransactionEUR,
    dividendHistory: s.dividendHistory,
    dividendSyncedAt: s.dividendSyncedAt,
    portfolioSnapshot: s.portfolioSnapshot,
  })
}

export function applyToStore(json: string): void {
  const d = JSON.parse(json)
  const s = useAppStore.getState()
  if (d.lmApiKey !== undefined) s.setLmApiKey(d.lmApiKey)
  if (d.lmProxyUrl !== undefined) s.setLmProxyUrl(d.lmProxyUrl)
  if (d.tiingoApiKey !== undefined) s.setTiingoApiKey(d.tiingoApiKey)
  if (d.fredApiKey !== undefined) s.setFredApiKey(d.fredApiKey)
  if (d.ibkrFlexToken !== undefined) s.setIbkrFlexToken(d.ibkrFlexToken)
  if (d.ibkrFlexQueryId !== undefined) s.setIbkrFlexQueryId(d.ibkrFlexQueryId)
  if (d.profile) s.setProfile(d.profile)
  if (d.accounts) s.setAccounts(d.accounts)
  if (d.pensions) s.setPensions(d.pensions)
  if (d.realEstateEvents) s.setRealEstateEvents(d.realEstateEvents)
  if (d.expenses) s.setExpenses(d.expenses)
  if (d.windfalls) s.setWindfalls(d.windfalls)
  if (d.monteCarloConfig) s.setMonteCarloConfig(d.monteCarloConfig)
  if (d.taxConfig) s.setTaxConfig(d.taxConfig)
  if (d.medicalCoverages) s.setMedicalCoverages(d.medicalCoverages)
  if (d.medicalExpenses) s.setMedicalExpenses(d.medicalExpenses)
  if (d.transfers) s.setTransfers(d.transfers)
  if (d.minTransactionEUR != null) s.setMinTransactionEUR(d.minTransactionEUR)
  if (d.dividendHistory) {
    Object.entries(d.dividendHistory as Record<string, any[]>).forEach(([ticker, divs]) =>
      s.setTickerDividends(ticker, divs as any),
    )
  }
}
