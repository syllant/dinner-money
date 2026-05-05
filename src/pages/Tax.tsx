import { useAppStore } from '../store/useAppStore'
import { PageHeader } from '../components/ui/PageHeader'
import { MetricCard } from '../components/ui/MetricCard'
import { Table, TableHead, TableRow } from '../components/ui/Table'
import { NumericInput } from '../components/ui/NumericInput'
import { InfoTooltip } from '../components/ui/InfoTooltip'
import { formatCurrency } from '../lib/format'
import { estimateAnnualIncomeTaxes } from '../lib/tax'
import type { QuarterlyPayment, PaymentStatus, TaxFilingStatus, TaxProfile, TaxSettlement } from '../types'

// ─── Due-date / percentage tables ────────────────────────────────────────────

const FED_DUE: Record<number, string> = { 1: 'Apr 15', 2: 'Jun 15', 3: 'Sep 15', 4: 'Jan 15+1' }

// CA FTB: Q1=30% Apr 15, Q2=40% Jun 15, Q3=no payment, Q4=30% Jan 15+1
const CA_DUE: Record<number, string> = { 1: 'Apr 15', 2: 'Jun 15', 3: '—', 4: 'Jan 15+1' }
const CA_PCT: Record<number, number | null> = { 1: 30, 2: 40, 3: null, 4: 30 }

const FILING_STATUS_LABELS: Record<TaxFilingStatus, string> = {
  single: 'Single',
  married_joint: 'Married filing jointly',
  head_household: 'Head of household',
}

function TaxProfileField({
  label,
  value,
  onChange,
  suffix,
  tooltip,
}: {
  label: string
  value: number
  onChange: (value: number) => void
  suffix?: string
  tooltip: string
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] text-gray-500 dark:text-gray-400 inline-flex items-center gap-1">
        {label}
        <InfoTooltip text={tooltip} />
      </span>
      <div className="flex items-center gap-1">
        <NumericInput
          className="h-[30px] min-w-0 flex-1 border border-gray-300 dark:border-gray-600 rounded-[5px] px-2 text-[12px] bg-white dark:bg-gray-800"
          value={value}
          onChange={next => onChange(next ?? 0)}
        />
        {suffix && <span className="text-[11px] text-gray-400 w-7">{suffix}</span>}
      </div>
    </label>
  )
}

// ─── QuarterlyTable ───────────────────────────────────────────────────────────

function QuarterlyTable({
  payments,
  onUpdate,
  currency = 'USD',
  tableType,
}: {
  payments: QuarterlyPayment[]
  onUpdate: (p: QuarterlyPayment) => void
  currency?: string
  tableType: 'federal' | 'state'
}) {
  const accounts = useAppStore(s => s.accounts)
  const cashAccounts = accounts.filter(a => a.includedInPlanning !== false && ['cash', 'investment', 'retirement'].includes(a.type))
  const currentYear = new Date().getFullYear()
  const rows = payments.filter(p => p.year === currentYear)

  const dueLabel = (q: number) => tableType === 'state' ? CA_DUE[q] : FED_DUE[q]
  const pctLabel = (q: number): string | null => {
    if (tableType === 'state') {
      const pct = CA_PCT[q]
      return pct != null ? `${pct}%` : null
    }
    return null
  }

  return (
    <Table>
      <TableHead>
        <div className="grid grid-cols-[1fr_56px_105px_1fr_68px] gap-2 text-[10.5px]">
          <span>Quarter</span>
          <span>Due</span>
          <span>Amount ({currency})</span>
          <span>Account</span>
          <span>Status</span>
        </div>
      </TableHead>
      {rows.map(q => {
        const due = dueLabel(q.quarter)
        const pct = pctLabel(q.quarter)
        const status = q.status ?? 'none'
        return (
          <TableRow key={q.quarter}>
            <div className="grid grid-cols-[1fr_56px_105px_1fr_68px] gap-2 items-center py-0.5">
              <div>
                <span className="text-[11.5px]">Q{q.quarter} {q.year}</span>
                {pct && <span className="text-[10px] text-gray-400 ml-1">({pct})</span>}
              </div>
              <span className="text-gray-500 text-[10.5px]">{due}</span>
              <NumericInput
                className="h-[26px] w-full border border-gray-300 dark:border-gray-600 rounded px-2 text-[11px] bg-white dark:bg-gray-800"
                value={q.estimatedDue}
                placeholder="—"
                onChange={value => onUpdate({ ...q, estimatedDue: value ?? null })}
              />
              <select
                className="h-[26px] w-full border border-gray-200 dark:border-gray-700 rounded px-1 text-[11px] bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300"
                value={q.fundAccountId ?? ''}
                onChange={e => onUpdate({ ...q, fundAccountId: e.target.value ? parseInt(e.target.value) : undefined })}
              >
                <option value="">Cash (default)</option>
                {cashAccounts.map(a => (
                  <option key={a.id} value={a.id}>{a.name} ({a.currency.toUpperCase()})</option>
                ))}
              </select>
              <select
                className="h-[26px] w-full border border-gray-300 dark:border-gray-600 rounded px-1 text-[11px] bg-white dark:bg-gray-800"
                value={status}
                onChange={e => onUpdate({ ...q, status: e.target.value as PaymentStatus })}
              >
                <option value="none">—</option>
                <option value="paid">Paid</option>
                <option value="todo">Due</option>
              </select>
            </div>
          </TableRow>
        )
      })}
    </Table>
  )
}

function TaxSettlementControl({
  jurisdiction,
  label,
  defaultCurrency,
  settlements,
  onUpdate,
}: {
  jurisdiction: NonNullable<TaxSettlement['jurisdiction']>
  label: string
  defaultCurrency: TaxSettlement['currency']
  settlements: TaxSettlement[]
  onUpdate: (settlement: TaxSettlement) => void
}) {
  const accounts = useAppStore(s => s.accounts)
  const currentYear = new Date().getFullYear()
  const previousYear = currentYear - 1
  const existing = (
    settlements.find(item => item.taxYear === previousYear && item.jurisdiction === jurisdiction)
    ?? (jurisdiction === 'federal'
      ? settlements.find(item => item.taxYear === previousYear && item.jurisdiction == null)
      : undefined)
  )
  const makeSettlement = (patch: Partial<TaxSettlement>): TaxSettlement => {
    return {
      id: existing?.id ?? `${previousYear}-${jurisdiction}`,
      jurisdiction,
      taxYear: previousYear,
      date: `${currentYear}-04`,
      amount: 0,
      currency: defaultCurrency,
      kind: 'payment',
      ...existing,
      ...patch,
    }
  }
  const item = existing ?? makeSettlement({})

  return (
    <div className="space-y-2 pt-1">
      <div>
        <h3 className="text-[12px] font-medium">{label} paid/refunded for {previousYear}</h3>
        <p className="text-[11px] text-gray-500 dark:text-gray-400">
          Final payment or refund posted in {currentYear}.
        </p>
      </div>
      <div className="grid grid-cols-[82px_1fr] gap-2">
        <select
          className="h-[28px] border border-gray-300 dark:border-gray-600 rounded px-1 text-[11px] bg-white dark:bg-gray-800"
          value={item.kind}
          onChange={e => onUpdate(makeSettlement({ kind: e.target.value as TaxSettlement['kind'] }))}
        >
          <option value="payment">Paid</option>
          <option value="refund">Refund</option>
        </select>
        <input
          className="h-[28px] border border-gray-300 dark:border-gray-600 rounded px-2 text-[11px] bg-white dark:bg-gray-800"
          value={item.date}
          onChange={e => onUpdate(makeSettlement({ date: e.target.value }))}
          placeholder={`${currentYear}-04`}
        />
      </div>
      <div className="flex gap-1">
        <NumericInput
          className="h-[28px] min-w-0 flex-1 border border-gray-300 dark:border-gray-600 rounded px-2 text-[11px] bg-white dark:bg-gray-800"
          value={item.amount}
          onChange={value => onUpdate(makeSettlement({ amount: value ?? 0 }))}
        />
        <select
          className="h-[28px] w-[54px] border border-gray-300 dark:border-gray-600 rounded px-1 text-[11px] bg-white dark:bg-gray-800"
          value={item.currency}
          onChange={e => onUpdate(makeSettlement({ currency: e.target.value as TaxSettlement['currency'] }))}
        >
          <option value="USD">USD</option>
          <option value="EUR">EUR</option>
        </select>
      </div>
      <select
        className="h-[28px] w-full border border-gray-200 dark:border-gray-700 rounded px-1 text-[11px] bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300"
        value={item.accountId ?? ''}
        onChange={e => onUpdate(makeSettlement({ accountId: e.target.value ? parseInt(e.target.value) : undefined }))}
      >
        <option value="">Cash (default)</option>
        {accounts.filter(a => a.includedInPlanning !== false && ['cash', 'investment', 'retirement'].includes(a.type)).map(a => (
          <option key={a.id} value={a.id}>{a.name} ({a.currency.toUpperCase()})</option>
        ))}
      </select>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function Tax() {
  const { taxConfig, setTaxConfig, upsertQuarterlyPayment, upsertStatePayment, upsertTaxSettlement, profile, pensions, windfalls, accounts } = useAppStore()

  const currentYear = new Date().getFullYear()

  const fedEst = taxConfig.quarterlyPayments
    .filter(p => p.year === currentYear)
    .reduce((s, p) => s + (p.estimatedDue ?? 0), 0)
  const stateEst = (taxConfig.stateQuarterlyPayments ?? [])
    .filter(p => p.year === currentYear)
    .reduce((s, p) => s + (p.estimatedDue ?? 0), 0)

  const incomeTaxEstimate = estimateAnnualIncomeTaxes({
    year: currentYear,
    profile,
    taxConfig,
    pensions,
    windfalls,
    accounts,
  })
  const statePayments = taxConfig.stateQuarterlyPayments ?? []
  const taxProfile = taxConfig.taxProfile
  const updateTaxProfile = (patch: Partial<TaxProfile>) => {
    setTaxConfig({ taxProfile: { ...taxProfile, ...patch } })
  }

  return (
    <div>
      <PageHeader title="Tax">
        <span className="text-[11px] text-gray-400">Configuration</span>
      </PageHeader>
      <div className="p-4 space-y-4">
        <p className="text-[11.5px] text-gray-500 dark:text-gray-400">
          Estimates use income definitions, pension sources, events, account income, account tax domicile, and the residency timeline.
          Not tax advice — verify with your accountant.
        </p>

        <section className="border border-gray-200 dark:border-gray-700 rounded-[8px] p-4">
          <div className="flex items-center justify-between gap-3 mb-1">
            <h2 className="text-[13px] font-medium">Tax profile</h2>
          </div>
          <p className="text-[11.5px] text-gray-500 dark:text-gray-400 mb-3">
            Effective rates are computed from 2026 US federal brackets, the California estimated-tax schedule,
            and France brackets with the inputs below.
          </p>
          <div className="grid grid-cols-3 gap-3 mb-4">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-gray-500 dark:text-gray-400 inline-flex items-center gap-1">
                Federal filing status
                <InfoTooltip text="Used to choose the federal standard deduction and ordinary/capital-gain tax brackets. Usually this should match the status you file on Form 1040." />
              </span>
              <select
                className="h-[30px] border border-gray-300 dark:border-gray-600 rounded-[5px] px-2 text-[12px] bg-white dark:bg-gray-800"
                value={taxProfile.federalFilingStatus}
                onChange={event => updateTaxProfile({ federalFilingStatus: event.target.value as TaxFilingStatus })}
              >
                {Object.entries(FILING_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-gray-500 dark:text-gray-400 inline-flex items-center gap-1">
                California filing status
                <InfoTooltip text="Used for California standard deduction and tax rate schedule. California generally expects the same filing status as federal when eligible." />
              </span>
              <select
                className="h-[30px] border border-gray-300 dark:border-gray-600 rounded-[5px] px-2 text-[12px] bg-white dark:bg-gray-800"
                value={taxProfile.stateFilingStatus}
                onChange={event => updateTaxProfile({ stateFilingStatus: event.target.value as TaxFilingStatus })}
              >
                {Object.entries(FILING_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <TaxProfileField
              label="France household parts"
              value={taxProfile.franceHouseholdParts}
              onChange={value => updateTaxProfile({ franceHouseholdParts: Math.max(1, value) })}
              tooltip="French quotient familial parts. A married couple is commonly 2 parts before child/dependent adjustments."
            />
            <TaxProfileField
              label="Federal itemized deductions"
              value={taxProfile.federalItemizedDeductionsUSD}
              onChange={value => updateTaxProfile({ federalItemizedDeductionsUSD: Math.max(0, value) })}
              suffix="USD"
              tooltip="Enter annual itemized deductions only if they exceed the federal standard deduction. Leave 0 to use the standard deduction automatically."
            />
            <TaxProfileField
              label="California itemized deductions"
              value={taxProfile.stateItemizedDeductionsUSD}
              onChange={value => updateTaxProfile({ stateItemizedDeductionsUSD: Math.max(0, value) })}
              suffix="USD"
              tooltip="Enter California-allowable itemized deductions only if they exceed California's standard deduction. California rules differ from federal, especially for some deductions."
            />
            <TaxProfileField
              label="France deduction"
              value={taxProfile.franceDeductionEUR}
              onChange={value => updateTaxProfile({ franceDeductionEUR: Math.max(0, value) })}
              suffix="EUR"
              tooltip="Annual deduction applied before the French income-tax brackets in this simplified model. Use it for known deductible allowances not already modeled elsewhere."
            />
            <TaxProfileField
              label="France social rate on taxable investment income"
              value={taxProfile.franceSocialRate}
              onChange={value => updateTaxProfile({ franceSocialRate: Math.max(0, value) })}
              suffix="%"
              tooltip="Rate applied to French-taxable investment income after treaty exclusions. US-domiciled investment accounts are excluded from French tax in this model."
            />
          </div>
        </section>

        {/* Three-column layout: Federal | State CA | France */}
        <div className="grid grid-cols-[2fr_2fr_1.5fr] gap-4">

          {/* Federal column */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="text-[13px]">🇺🇸</span>
              <h2 className="text-[13px] font-medium">Federal (IRS)</h2>
            </div>
            <MetricCard
              label="Federal effective rate"
              value={`${incomeTaxEstimate.federalEffectiveRate.toFixed(1)}%`}
              sub={fedEst > 0 ? `${formatCurrency(fedEst, 'USD')} in quarterly payments` : `${formatCurrency(incomeTaxEstimate.federalUSD, 'USD')} income-based estimate`}
              tooltip="Computed from the tax profile, 2026 federal brackets, deductions, and capital-gain assumptions. Quarterly payment rows are still manually editable."
            />
            <TaxSettlementControl
              jurisdiction="federal"
              label="Federal"
              defaultCurrency="USD"
              settlements={taxConfig.settlements ?? []}
              onUpdate={upsertTaxSettlement}
            />
            <h3 className="text-[12px] font-medium pt-1">Quarterly payments for {currentYear}</h3>
            <QuarterlyTable
              payments={taxConfig.quarterlyPayments}
              onUpdate={upsertQuarterlyPayment}
              tableType="federal"
            />
          </div>

          {/* State column */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="text-[13px]">🏛</span>
              <h2 className="text-[13px] font-medium">California (FTB)</h2>
            </div>
            <MetricCard
              label="California effective rate"
              value={`${incomeTaxEstimate.stateEffectiveRate.toFixed(1)}%`}
              sub={stateEst > 0 ? `${formatCurrency(stateEst, 'USD')} in quarterly payments` : `${formatCurrency(incomeTaxEstimate.stateUSD, 'USD')} income-based estimate`}
              tooltip="Computed from the tax profile and California estimated-tax rules for income sourced to US-residency months. California taxes capital gains as ordinary income and adds the Mental Health Services Tax above $1M taxable income."
            />
            <TaxSettlementControl
              jurisdiction="state"
              label="State"
              defaultCurrency="USD"
              settlements={taxConfig.settlements ?? []}
              onUpdate={upsertTaxSettlement}
            />
            <h3 className="text-[12px] font-medium pt-1">Quarterly payments for {currentYear}</h3>
            <QuarterlyTable
              payments={statePayments}
              onUpdate={upsertStatePayment}
              tableType="state"
            />
          </div>

          {/* France column */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="text-[13px]">🇫🇷</span>
              <h2 className="text-[13px] font-medium">France</h2>
            </div>
            <MetricCard
              label="France effective rate"
              value={`${incomeTaxEstimate.franceEffectiveRate.toFixed(1)}%`}
              sub={`~${formatCurrency(incomeTaxEstimate.franceEUR, 'EUR')} income-based estimate`}
              tooltip="Computed from France household parts, the 2026 barème, France deduction, and social rate on taxable investment income."
            />
            <TaxSettlementControl
              jurisdiction="france"
              label="France"
              defaultCurrency="EUR"
              settlements={taxConfig.settlements ?? []}
              onUpdate={upsertTaxSettlement}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
