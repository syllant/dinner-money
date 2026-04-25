import { useAppStore } from '../store/useAppStore'
import { PageHeader } from '../components/ui/PageHeader'
import { MetricCard } from '../components/ui/MetricCard'
import { Banner } from '../components/ui/Banner'
import { Table, TableHead, TableRow } from '../components/ui/Table'
import { Badge } from '../components/ui/Badge'
import { DEFAULT_EUR_USD_RATE } from '../lib/currency'
import { formatCurrency } from '../lib/format'
import { useNavigate } from 'react-router-dom'

export default function Tax() {
  const { taxConfig, upsertQuarterlyPayment } = useAppStore()
  const navigate = useNavigate()

  const fedRate = taxConfig.usFederalEffectiveRate / 100
  const caRate = taxConfig.usCaliforniaEffectiveRate / 100
  const frRate = taxConfig.frCombinedEffectiveRate / 100

  // Rough income estimate from quarterly payments
  const q1 = taxConfig.quarterlyPayments.find(p => p.year === 2026 && p.quarter === 1)
  const estimatedUsIncome = q1?.estimatedDue ? q1.estimatedDue / (fedRate + caRate) * 4 : 0
  const usFedTax = estimatedUsIncome * fedRate
  const usCaTax = estimatedUsIncome * caRate
  const usTotalTax = usFedTax + usCaTax
  const frPartialTax = estimatedUsIncome * frRate * 0.08 // partial year ~1 month
  const totalEUR = (usTotalTax / DEFAULT_EUR_USD_RATE) + frPartialTax

  const currentYear = new Date().getFullYear()
  const quarters = taxConfig.quarterlyPayments.filter(p => p.year === currentYear)

  const DUE_DATES: Record<number, string> = { 1: 'Apr 15', 2: 'Jun 15', 3: 'Sep 15', 4: 'Jan 15 +1' }

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
              <div className="text-[10.5px] text-gray-500 mb-1">🇺🇸 US taxes (federal + CA)</div>
              <div className="text-[15px] font-medium">{formatCurrency(usTotalTax, 'USD')}</div>
            </div>
            <div className="px-5">
              <div className="text-[10.5px] text-gray-500 mb-1">🇫🇷 French taxes (IR + PS)</div>
              <div className="text-[15px] font-medium">{formatCurrency(frPartialTax, 'EUR')}</div>
              <div className="text-[10px] text-gray-400">partial year from ~Aug {currentYear}</div>
            </div>
            <div className="pl-5">
              <div className="text-[10.5px] text-gray-500 mb-1">🇫🇷 French tax ({currentYear + 1}, full year)</div>
              <div className="text-[15px] font-medium text-amber-600">{formatCurrency(estimatedUsIncome * frRate / DEFAULT_EUR_USD_RATE, 'EUR')}</div>
              <div className="text-[10px] text-gray-400">first full year estimate</div>
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
              <MetricCard label="Federal income tax" value={`~${formatCurrency(usFedTax, 'USD')}`} sub={`${taxConfig.usFederalEffectiveRate}% eff. rate`} />
              <MetricCard label="California state tax" value={`~${formatCurrency(usCaTax, 'USD')}`} sub={`${taxConfig.usCaliforniaEffectiveRate}% eff. rate`} />
            </div>
            <p className="text-[11px] text-gray-500">Includes capital gains on investments (LT rate 15%).</p>
            <h3 className="text-[12.5px] font-medium">Quarterly payments</h3>
            <Table>
              <TableHead>
                <div className="grid grid-cols-[1fr_80px_80px_90px_80px] gap-2">
                  <span>Quarter</span><span>Due</span><span>Paid</span><span>Estimated</span><span>Status</span>
                </div>
              </TableHead>
              {quarters.map(q => (
                <TableRow key={q.quarter}>
                  <div className="grid grid-cols-[1fr_80px_80px_90px_80px] gap-2 items-center">
                    <span>Q{q.quarter} {q.year}</span>
                    <span className="text-gray-500">{DUE_DATES[q.quarter]}</span>
                    <input
                      type="number"
                      className="h-[26px] w-full border border-gray-300 dark:border-gray-600 rounded px-2 text-[11px] bg-white dark:bg-gray-800"
                      value={q.amountPaid ?? ''}
                      placeholder="—"
                      onChange={e => upsertQuarterlyPayment({ ...q, amountPaid: e.target.value ? parseFloat(e.target.value) : null })}
                    />
                    <span className="text-[11px] text-gray-500">{q.estimatedDue ? formatCurrency(q.estimatedDue, 'USD') : '—'}</span>
                    {q.amountPaid != null
                      ? <Badge variant="success">Paid</Badge>
                      : q.quarter === 2 ? <Badge variant="warning">Upcoming</Badge>
                      : <Badge variant="neutral">Future</Badge>}
                  </div>
                </TableRow>
              ))}
            </Table>
          </div>

          {/* FR column */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="text-[13px]">🇫🇷</span>
              <h2 className="text-[13px] font-medium">France</h2>
            </div>
            <Banner variant="warning">Resident from ~Aug {currentYear}. First full tax filing: {currentYear + 1}.</Banner>
            <div className="space-y-2">
              <MetricCard label={`${currentYear} (partial year)`} value={`~${formatCurrency(frPartialTax, 'EUR')}`} sub="IR + PS combined" />
              <MetricCard label={`${currentYear + 1} (first full year)`} value={`~${formatCurrency(estimatedUsIncome * frRate / DEFAULT_EUR_USD_RATE, 'EUR')}`}
                sub={`${taxConfig.frCombinedEffectiveRate}% eff. rate`} valueClass="text-amber-600" />
            </div>
            <p className="text-[11px] text-gray-500 leading-relaxed">
              IR and prélèvements sociaux are shown as a single combined effective rate.
              US Social Security is generally exempt from French tax under the bilateral treaty.
            </p>
            <button onClick={() => navigate('/settings')} className="text-[11px] text-blue-600 underline">
              Edit rate in Settings →
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
