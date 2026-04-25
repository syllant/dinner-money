import { useState } from 'react'
import { useAppStore } from '../../store/useAppStore'
import { PageHeader } from '../../components/ui/PageHeader'
import { Table, TableHead, TableRow, TableAddRow } from '../../components/ui/Table'
import { Badge } from '../../components/ui/Badge'
import { generateId } from '../../lib/format'
import type { ResidencyPeriod } from '../../types'

const blankPeriod = (): ResidencyPeriod => ({
  id: generateId(), startDate: '', endDate: null, country: 'FR',
})

export default function Profile() {
  const { profile, setProfile } = useAppStore()
  const [editingPeriod, setEditingPeriod] = useState<ResidencyPeriod | null>(null)

  function savePeriod() {
    if (!editingPeriod) return
    const existing = profile.residencyPeriods.find(r => r.id === editingPeriod.id)
    const updated = existing
      ? profile.residencyPeriods.map(r => r.id === editingPeriod.id ? editingPeriod : r)
      : [...profile.residencyPeriods, editingPeriod]
    setProfile({ residencyPeriods: updated })
    setEditingPeriod(null)
  }

  function deletePeriod(id: string) {
    setProfile({ residencyPeriods: profile.residencyPeriods.filter(r => r.id !== id) })
  }

  return (
    <div>
      <PageHeader title="Profile" />
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
          {editingPeriod && (
            <div className="border border-blue-200 dark:border-blue-700 rounded-xl p-4 bg-blue-50 dark:bg-blue-900/10 space-y-3 mb-3">
              <h3 className="text-[12.5px] font-medium">
                {profile.residencyPeriods.find(r => r.id === editingPeriod.id) ? 'Edit period' : 'Add period'}
              </h3>
              <div className="grid grid-cols-3 gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-[11px] text-gray-500">Country</label>
                  <select
                    className="h-[32px] border border-gray-300 rounded-[5px] px-2 text-[12px] bg-white dark:bg-gray-800"
                    value={editingPeriod.country}
                    onChange={e => setEditingPeriod({ ...editingPeriod, country: e.target.value as 'US' | 'FR' })}
                  >
                    <option value="FR">🇫🇷 France</option>
                    <option value="US">🇺🇸 USA</option>
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[11px] text-gray-500">Start (YYYY-MM)</label>
                  <input
                    className="h-[32px] border border-gray-300 rounded-[5px] px-3 text-[12px] bg-white dark:bg-gray-800"
                    value={editingPeriod.startDate}
                    onChange={e => setEditingPeriod({ ...editingPeriod, startDate: e.target.value })}
                    placeholder="2026-07"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[11px] text-gray-500">End (YYYY-MM, blank = ongoing)</label>
                  <input
                    className="h-[32px] border border-gray-300 rounded-[5px] px-3 text-[12px] bg-white dark:bg-gray-800"
                    value={editingPeriod.endDate ?? ''}
                    onChange={e => setEditingPeriod({ ...editingPeriod, endDate: e.target.value || null })}
                    placeholder="ongoing"
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <button className="text-[11.5px] px-3 py-1 border border-gray-300 rounded-[5px] hover:bg-gray-50" onClick={() => setEditingPeriod(null)}>Cancel</button>
                <button className="text-[11.5px] px-3 py-1 bg-green-50 border border-green-300 text-green-700 rounded-[5px] hover:bg-green-100" onClick={savePeriod}>Save</button>
              </div>
            </div>
          )}
          <Table>
            <TableHead>
              <div className="grid grid-cols-[1fr_1fr_1fr_1fr_80px] gap-2">
                <span>Country</span><span>Start</span><span>End</span><span>Status</span><span></span>
              </div>
            </TableHead>
            {profile.residencyPeriods.map(r => (
              <TableRow key={r.id}>
                <div className="grid grid-cols-[1fr_1fr_1fr_1fr_80px] gap-2 items-center">
                  <span>{r.country === 'FR' ? '🇫🇷 France' : '🇺🇸 USA'}</span>
                  <span>{r.startDate}</span>
                  <span className="text-gray-400">{r.endDate ?? 'ongoing'}</span>
                  <Badge variant={r.country === 'FR' ? 'fr' : 'us'}>{r.country === 'FR' ? 'FR resident' : 'US resident'}</Badge>
                  <div className="flex gap-2">
                    <button className="text-[11px] text-blue-600 hover:underline" onClick={() => setEditingPeriod(r)}>Edit</button>
                    <button className="text-[11px] text-red-500 hover:underline" onClick={() => deletePeriod(r.id)}>Del</button>
                  </div>
                </div>
              </TableRow>
            ))}
            <TableAddRow onClick={() => setEditingPeriod(blankPeriod())}>+ Add period</TableAddRow>
          </Table>
          <p className="text-[11px] text-gray-400 mt-2">Used for tax residency estimates on the Tax page.</p>
        </section>
      </div>
    </div>
  )
}
