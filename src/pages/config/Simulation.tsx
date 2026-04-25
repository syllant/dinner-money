import { useAppStore } from '../../store/useAppStore'
import { PageHeader } from '../../components/ui/PageHeader'
import { Button } from '../../components/ui/Button'

interface SliderRowProps {
  label: string
  value: number
  min: number
  max: number
  step: number
  unit?: string
  onChange: (v: number) => void
}

function SliderRow({ label, value, min, max, step, unit = '%', onChange }: SliderRowProps) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-[12px] text-gray-500 dark:text-gray-400 min-w-[200px]">{label}</span>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        className="flex-1 h-[4px] accent-green-600" />
      <span className="text-[12px] font-medium min-w-[44px] text-right text-gray-900 dark:text-white">
        {value.toFixed(step < 1 ? 2 : 0)}{unit}
      </span>
    </div>
  )
}

export default function Simulation() {
  const { monteCarloConfig, setMonteCarloConfig } = useAppStore()
  const c = monteCarloConfig
  const set = (patch: typeof c extends infer T ? Partial<T> : never) => setMonteCarloConfig(patch as Partial<typeof c>)

  return (
    <div>
      <PageHeader title="Simulation settings">
        <Button variant="success">Save &amp; re-run</Button>
      </PageHeader>
      <div className="p-4 max-w-2xl space-y-5">
        <section>
          <h2 className="text-[13px] font-medium mb-3">Market assumptions</h2>
          <div className="space-y-3">
            <SliderRow label="Equity real return (mean)" value={c.equityMeanReturn} min={0} max={12} step={0.5} onChange={v => set({ equityMeanReturn: v })} />
            <SliderRow label="Equity volatility (std dev)" value={c.equityStdDev} min={5} max={25} step={0.5} onChange={v => set({ equityStdDev: v })} />
            <SliderRow label="Bond real return (mean)" value={c.bondMeanReturn} min={-2} max={6} step={0.25} onChange={v => set({ bondMeanReturn: v })} />
            <SliderRow label="Bond volatility (std dev)" value={c.bondStdDev} min={1} max={12} step={0.25} onChange={v => set({ bondStdDev: v })} />
          </div>
        </section>
        <hr className="border-gray-200 dark:border-gray-700" />
        <section>
          <h2 className="text-[13px] font-medium mb-3">Macro assumptions</h2>
          <div className="space-y-3">
            <SliderRow label="Inflation (EUR, annual)" value={c.inflationEUR} min={0} max={6} step={0.25} onChange={v => set({ inflationEUR: v })} />
            <SliderRow label="EUR/USD drift (annual)" value={c.eurUsdDrift} min={-3} max={3} step={0.25} onChange={v => set({ eurUsdDrift: v })} />
            <SliderRow label="EUR/USD volatility" value={c.eurUsdVolatility} min={2} max={15} step={0.5} onChange={v => set({ eurUsdVolatility: v })} />
          </div>
        </section>
        <hr className="border-gray-200 dark:border-gray-700" />
        <section>
          <h2 className="text-[13px] font-medium mb-3">Simulation parameters</h2>
          <div className="space-y-3">
            <SliderRow label="Number of simulations" value={c.numSimulations} min={1000} max={50000} step={1000} unit="" onChange={v => set({ numSimulations: v })} />
            <SliderRow label="Success threshold" value={c.successThreshold} min={50} max={99} step={1} onChange={v => set({ successThreshold: v })} />
          </div>
        </section>
      </div>
    </div>
  )
}
