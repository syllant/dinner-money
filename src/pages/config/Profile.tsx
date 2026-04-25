import { useAppStore } from '../../store/useAppStore'
import { PageHeader } from '../../components/ui/PageHeader'
import { Button } from '../../components/ui/Button'
import { Table, TableHead, TableRow, TableAddRow } from '../../components/ui/Table'
import { Badge } from '../../components/ui/Badge'

export default function Profile() {
  const { profile, setProfile } = useAppStore()

  return (
    <div>
      <PageHeader title="Profile">
        <Button variant="success">Save</Button>
      </PageHeader>
      <div className="p-4 max-w-xl space-y-6">
        <section>
          <h2 className="text-[13px] font-medium mb-3">Personal details</h2>
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: 'Your birth year', key: 'birthYear' as const },
              { label: 'Spouse birth year', key: 'spouseBirthYear' as const },
              { label: 'Projection end age', key: 'projectionEndAge' as const },
            ].map(({ label, key }) => (
              <div key={key} className="flex flex-col gap-1">
                <label className="text-[11px] text-gray-500 dark:text-gray-400">{label}</label>
                <input
                  type="number"
                  className="h-[32px] border border-gray-300 dark:border-gray-600 rounded-[5px] px-3 text-[12.5px] bg-white dark:bg-gray-800"
                  value={profile[key]}
                  onChange={e => setProfile({ [key]: parseInt(e.target.value) })}
                />
              </div>
            ))}
            <div className="flex flex-col gap-1">
              <label className="text-[11px] text-gray-500 dark:text-gray-400">Base currency</label>
              <select
                className="h-[32px] border border-gray-300 dark:border-gray-600 rounded-[5px] px-2 text-[12.5px] bg-white dark:bg-gray-800"
                value={profile.baseCurrency}
                onChange={e => setProfile({ baseCurrency: e.target.value as 'EUR' | 'USD' })}
              >
                <option value="EUR">EUR</option>
                <option value="USD">USD</option>
              </select>
            </div>
          </div>
        </section>

        <hr className="border-gray-200 dark:border-gray-700" />

        <section>
          <h2 className="text-[13px] font-medium mb-3">Residency timeline</h2>
          <Table>
            <TableHead>
              <div className="grid grid-cols-[1fr_1fr_1fr_60px] gap-2">
                <span>Start</span><span>Country</span><span>Status</span><span></span>
              </div>
            </TableHead>
            {profile.residencyPeriods.map(r => (
              <TableRow key={r.id}>
                <div className="grid grid-cols-[1fr_1fr_1fr_60px] gap-2 items-center">
                  <span>{r.startDate}</span>
                  <span>{r.country === 'FR' ? '🇫🇷 France' : '🇺🇸 USA'}</span>
                  <Badge variant={r.country === 'FR' ? 'fr' : 'us'}>{r.country === 'FR' ? 'FR resident' : 'US resident'}</Badge>
                  <button className="text-[11px] text-blue-600 hover:underline">Edit</button>
                </div>
              </TableRow>
            ))}
            <TableAddRow>+ Add period</TableAddRow>
          </Table>
        </section>

        <hr className="border-gray-200 dark:border-gray-700" />

        <section>
          <h2 className="text-[13px] font-medium mb-3">Health insurance (COBRA)</h2>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-[11px] text-gray-500 dark:text-gray-400">Monthly amount (USD)</label>
              <input
                type="number"
                className="h-[32px] border border-gray-300 dark:border-gray-600 rounded-[5px] px-3 text-[12.5px] bg-white dark:bg-gray-800"
                value={profile.cobraMonthlyUSD}
                onChange={e => setProfile({ cobraMonthlyUSD: parseFloat(e.target.value) })}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[11px] text-gray-500 dark:text-gray-400">End date (YYYY-MM)</label>
              <input
                type="text"
                className="h-[32px] border border-gray-300 dark:border-gray-600 rounded-[5px] px-3 text-[12.5px] bg-white dark:bg-gray-800"
                value={profile.cobraEndDate}
                onChange={e => setProfile({ cobraEndDate: e.target.value })}
              />
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
