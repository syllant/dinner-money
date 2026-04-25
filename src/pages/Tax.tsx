import { useAppStore } from '../store/useAppStore'
import { PageHeader } from '../components/ui/PageHeader'
import { MetricCard } from '../components/ui/MetricCard'
import { Banner } from '../components/ui/Banner'
import { Table, TableHead, TableRow } from '../components/ui/Table'
import { Badge } from '../components/ui/Badge'
import { DEFAULT_EUR_USD_RATE } from '../lib/currency'
import { formatCurrency } from '../lib/format'
import { useNavigate } from 'react-router-dom'
import type { QuarterlyPayment } from '../types'

const DUE_DATES: Record<number, string> = { 1: 'Apr 15', 2: 'Jun 15', 3: 'Sep 15', 4: 'Jan 15+1' }

function QuarterlyTable({
  payments,
  onUpdate,
  currency = 'USD',
}: {
  payments: QuarterlyPayment[]
  onUpdate: (p: QuarterlyPayment) => void
  currency?: string
}) {
  const currentYear = new Date().getFullYear()
  const currentQ = Math.ceil((new Date().getMonth() + 1) / 3)
  const rows = payments.filter(p => p.year === currentYear)
  return (
    <Table>
      <TableHead>
        <div className="grid grid-cols-[1fr_70px_90px_100px_70px] gap-2">
          <span>Quarter</span><span>Due</span><span>Paid ({currency})</span><span>Est. due ({currency})</span><span>Status</span>
        </div>
      </TableHead>
      {rows.map(q => (
        <TableRow key={q.quarter}>
          <div className="grid grid-cols-[1fr_70px_90px_100px_70px] gap-2 items-center">
            <span>Q{q.quarter} {q.year}</span>
            <span className="text-gray-500 text-[11px]">{DUE_DATES[q.quarter]}</span>
            <input
              type="number"
              className="h-[26px] w-full border border-gray-300 dark:border-gray-600 rounded px-2 text-[11px] bg-white dark:bg-gray-800"
              value={q.amountPaid ?? ''}
              placeholder="—"
              onChange={e => onUpdate({ ...q, amountPaid: e.target.value ? parseFloat(e.target.value) : null })}
            />
            <input
              type="number"
              className="h-[26px] w-full border border-gray-300 dark:border-gray-600 rounded px-2 text-[11px] bg-white dark:bg-gray-800"
              value={q.estimatedDue ?? ''}
              placeholder="—"
              onChange={e => onUpdate({ ...q, estimatedDue: e.target.value ? parseFloat(e.target.value) : null })}
            />
            {q.amountPaid != null
              ? <Badge variant="success">Paid</Badge>
              : q.quarter <= currentQ
              ? <Badge variant="warning">Due</Badge>
              : <Badge variant="neutral">Future</Badge>}
          </div>
        </TableRow>
      ))}
    </Table>
  )
}

export default function Tax() {
  const { taxConfig, upsertQuarterlyPayment, upsertStatePayment } = useAppStore()
  const navigate = useNavigate()

  const fedRate = taxConfig.usFederalEffectiveRate / 100
  const frRate = taxConfig.frCombinedEffectiveRate / 100

  const currentYear = new Date().getFullYear()

  // Estimate income from federal quarterly payments
  const fedPaid = taxConfig.quarterlyPayments
    .filter(p => p.year === currentYear && p.amountPaid != null)
    .reduce((s, p) => s + (p.amountPaid ?? 0), 0)
  const fedEst = taxConfig.quarterlyPayments
    .filter(p => p.year === currentYear)
    .reduce((s, p) => s + (p.estimatedDue ?? 0), 0)
  const stateEst = (taxConfig.stateQuarterlyPayments ?? [])
    .filter(p => p.year === currentYear)
    .reduce((s, p) => s + (p.estimatedDue ?? 0), 0)

  const usTotalEst = fedEst + stateEst
  const frPartialEst = fedEst > 0 ? (fedEst / fedRate) * frRate * (2 / 12) / DEFAULT_EUR_USD_RATE : 0
  const totalEUR = (usTotalEst / DEFAULT_EUR_USD_RATE) + frPartialEst

  const statePayments = taxConfig.stateQuarterlyPayments ?? []

  return (
    <div>
      <PageHeader title={`Tax — ${currentYear} estimate`}>
        <button onClick={() => navigate('/settings')} className="text-[11px] text-blue-600 underline cursor-pointer">
          Edit tax rates in Settings →
        </button>
      </PageHeader>
      <div className="p-4 space-y-4">
        <p className="text-[11.5px] text-gray-500 dark:text-gray-400">
          Estimates use effective rates set in Settings. Not tax advice — verify with your accountant.
        </p>

        {/* Consolidated total */}
        <div className="border border-gray-200 dark:border-gray-700 rounded-xl p-4">
          <div className="text-[10.5px] text-gray-500 mb-2">Total estimated taxes — {currentYear}</div>
          <div className="flex items-baseline gap-2 mb-3">
            <span className="text-[24px] font-medium text-red-500">{formatCurrency(totalEUR, 'EUR')}</span>
            <span className="text-[12px] text-gray-500">combined, at EUR/USD {DEFAULT_EUR_USD_RATE}</span>
          </div>
          <div className="flex gap-0 divide-x divide-gray-200 dark:divide-gray-700">
            <div className="pr-5">
              <div className="text-[10.5px] text-gray-500 mb-1">🇺🇸 Federal (IRS)</div>
              <div className="text-[15px] font-medium">{formatCurrency(fedEst, 'USD')}</div>
              <div className="text-[10px] text-gray-400">{formatCurrency(fedPaid, 'USD')} paid so far</div>
            </div>
            <div className="px-5">
              <div className="text-[10.5px] text-gray-500 mb-1">🇺🇸 California (FTB)</div>
              <div className="text-[15px] font-medium">{formatCurrency(stateEst, 'USD')}</div>
            </div>
            <div className="px-5">
              <div className="text-[10.5px] text-gray-500 mb-1">🇫🇷 France (partial year)</div>
              <div className="text-[15px] font-medium">{formatCurrency(frPartialEst, 'EUR')}</div>
              <div className="text-[10px] text-gray-400">~2 months from Jul {currentYear}</div>
            </div>
          </div>
        </div>

        {/* Side-by-side US / FR */}
        <div className="grid grid-cols-[3fr_2fr] gap-4">

          {/* US column */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="text-[13px]">🇺🇸</span>
              <h2 className="text-[13px] font-medium">United States</h2>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <MetricCard label="Federal effective rate" value={`${taxConfig.usFederalEffectiveRate}%`} sub={`~${formatCurrency(fedEst, 'USD')} est.`} />
              <MetricCard label="California effective rate" value={`${taxConfig.usCaliforniaEffectiveRate}%`} sub={`~${formatCurrency(stateEst, 'USD')} est.`} />
            </div>

            <h3 className="text-[12.5px] font-medium pt-1">Federal (IRS) quarterly payments</h3>
            <QuarterlyTable payments={taxConfig.quarterlyPayments} onUpdate={upsertQuarterlyPayment} />

            <h3 className="text-[12.5px] font-medium pt-2">California (FTB) quarterly payments</h3>
            <QuarterlyTable payments={statePayments} onUpdate={upsertStatePayment} />

            <p className="text-[11px] text-gray-500">
              Amounts are editable — enter what you've paid and your current estimates.
            </p>
          </div>

          {/* FR column */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="text-[13px]">🇫🇷</span>
              <h2 className="text-[13px] font-medium">France</h2>
            </div>
            <Banner variant="warning">Resident from ~Jul {currentYear}. First full tax filing: {currentYear + 1}.</Banner>
            <div className="space-y-2">
              <MetricCard
                label={`${currentYear} (partial year)`}
                value={`~${formatCurrency(frPartialEst, 'EUR')}`}
                sub="IR + PS combined, ~2 months"
              />
              <MetricCard
                label={`${currentYear + 1} (first full year)`}
                value={`~${formatCurrency(fedEst > 0 ? (fedEst / fedRate) * frRate / DEFAULT_EUR_USD_RATE : 0, 'EUR')}`}
                sub={`${taxConfig.frCombinedEffectiveRate}% eff. rate`}
                valueClass="text-amber-600"
              />
            </div>
            <p className="text-[11px] text-gray-500 leading-relaxed">
              IR and prélèvements sociaux are shown as a single combined effective rate.
              US Social Security benefits are generally exempt from French tax under the US-FR bilateral treaty.
            </p>
            <button onClick={() => navigate('/settings')} className="text-[11px] text-blue-600 underline">
              Edit rates in Settings →
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
