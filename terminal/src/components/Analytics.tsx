import { useStore } from '../store'
import {
  AreaChart, Area, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, ReferenceLine,
} from 'recharts'
import type { Trade } from '../types'
import { MODEL_LABELS } from '../types'

function buildEquityCurve(trades: Trade[]) {
  let equity = 0
  return trades.map((t, i) => {
    equity += t.net_pnl
    return { i: i + 1, equity: +equity.toFixed(2), pnl: t.net_pnl }
  })
}

function modelStats(trades: Trade[]) {
  const map: Record<string, { wins: number; total: number; pnl: number }> = {}
  for (const t of trades) {
    if (!t.model) continue
    if (!map[t.model]) map[t.model] = { wins: 0, total: 0, pnl: 0 }
    map[t.model].total++
    map[t.model].pnl += t.net_pnl
    if (t.net_pnl > 0) map[t.model].wins++
  }
  return Object.entries(map).map(([model, s]) => ({
    model,
    label: MODEL_LABELS[model as keyof typeof MODEL_LABELS] ?? model,
    total: s.total,
    winRate: s.total ? (s.wins / s.total) * 100 : 0,
    pnl: s.pnl,
  }))
}

function regimeStats(trades: Trade[]) {
  const map: Record<string, { wins: number; total: number; pnl: number }> = {}
  for (const t of trades) {
    const r = t.regime ?? 'unknown'
    if (!map[r]) map[r] = { wins: 0, total: 0, pnl: 0 }
    map[r].total++
    map[r].pnl += t.net_pnl
    if (t.net_pnl > 0) map[r].wins++
  }
  return map
}

const CustomTooltip = ({ active, payload }: any) => {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  return (
    <div className="bg-surface-panel border border-surface-border rounded px-2 py-1.5 text-xs font-mono">
      <div className="text-slate-400">Trade #{d.i}</div>
      <div className={d.equity >= 0 ? 'text-up' : 'text-down'}>
        Equity: ${d.equity.toFixed(2)}
      </div>
    </div>
  )
}

export function Analytics() {
  const trades = useStore(s => s.trades)
  const metrics = useStore(s => s.metrics)

  const curve = buildEquityCurve(trades)
  const byModel = modelStats(trades)
  const byRegime = regimeStats(trades)
  const lastEquity = curve[curve.length - 1]?.equity ?? 0
  const peak = Math.max(0, ...curve.map(d => d.equity))
  const drawdown = peak - lastEquity
  const wins = trades.filter(t => t.net_pnl > 0).length
  const losses = trades.filter(t => t.net_pnl <= 0).length

  const regimeColor: Record<string, string> = {
    low: 'text-emerald-400',
    medium: 'text-warn',
    high: 'text-down',
  }

  return (
    <div className="flex flex-col gap-3 h-full overflow-y-auto p-2">
      {/* Top stats */}
      <div className="grid grid-cols-4 gap-2">
        {[
          ['Sharpe', (metrics?.sharpe ?? 0).toFixed(2), metrics?.sharpe !== undefined && metrics.sharpe >= 1 ? 'text-up' : 'text-slate-300'],
          ['Max DD', `$${drawdown.toFixed(2)}`, 'text-down'],
          ['Win Rate', trades.length ? `${((wins / trades.length) * 100).toFixed(1)}%` : '—', 'text-slate-300'],
          ['Net P&L', `${lastEquity >= 0 ? '+' : ''}$${lastEquity.toFixed(2)}`, lastEquity >= 0 ? 'text-up' : 'text-down'],
        ].map(([label, value, cls]) => (
          <div key={label} className="bg-surface-card border border-surface-border rounded p-2">
            <div className="label mb-0.5">{label}</div>
            <span className={`text-sm font-mono font-semibold ${cls}`}>{value}</span>
          </div>
        ))}
      </div>

      {/* Equity curve */}
      <div className="bg-surface-card border border-surface-border rounded p-3">
        <div className="label mb-2">Equity Curve</div>
        {curve.length < 2 ? (
          <div className="text-2xs text-muted font-mono text-center py-6">
            No trades yet — start trading to see performance
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={120}>
            <AreaChart data={curve} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="eqGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#00d4a4" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#00d4a4" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e2d4e" />
              <XAxis dataKey="i" tick={{ fill: '#4a5568', fontSize: 10 }} tickLine={false} />
              <YAxis tick={{ fill: '#4a5568', fontSize: 10 }} tickLine={false} axisLine={false}
                tickFormatter={v => `$${v}`} width={50} />
              <Tooltip content={<CustomTooltip />} />
              <ReferenceLine y={0} stroke="#4a5568" strokeDasharray="4 2" />
              <Area
                type="monotone"
                dataKey="equity"
                stroke={lastEquity >= 0 ? '#00d4a4' : '#ff4757'}
                strokeWidth={1.5}
                fill="url(#eqGrad)"
                dot={false}
                activeDot={{ r: 3, fill: '#00d4a4' }}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Win/Loss summary */}
      <div className="bg-surface-card border border-surface-border rounded p-2">
        <div className="label mb-1.5">Win / Loss</div>
        <div className="flex gap-4 items-center">
          <div className="flex-1 bg-surface rounded-full h-2 overflow-hidden">
            <div
              className="h-full bg-up rounded-full transition-all"
              style={{ width: trades.length ? `${(wins / trades.length) * 100}%` : '0%' }}
            />
          </div>
          <span className="text-xs font-mono text-up">{wins}W</span>
          <span className="text-xs font-mono text-muted">/</span>
          <span className="text-xs font-mono text-down">{losses}L</span>
        </div>
      </div>

      {/* Per-model stats */}
      <div className="bg-surface-card border border-surface-border rounded p-2">
        <div className="label mb-1.5">Per Model</div>
        {byModel.length === 0 ? (
          <div className="text-2xs text-muted font-mono text-center py-2">No data</div>
        ) : (
          <div className="space-y-1.5">
            {byModel.map(m => (
              <div key={m.model} className="flex items-center justify-between">
                <span className="text-2xs text-slate-400 truncate w-28">{m.label}</span>
                <div className="flex gap-3 items-center">
                  <span className="text-2xs font-mono text-muted">{m.total}t</span>
                  <span className="text-2xs font-mono text-slate-300">{m.winRate.toFixed(0)}%wr</span>
                  <span className={`text-2xs font-mono font-semibold ${m.pnl >= 0 ? 'text-up' : 'text-down'}`}>
                    {m.pnl >= 0 ? '+' : ''}${m.pnl.toFixed(2)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Per-regime stats */}
      <div className="bg-surface-card border border-surface-border rounded p-2">
        <div className="label mb-1.5">Per Regime</div>
        {Object.keys(byRegime).length === 0 ? (
          <div className="text-2xs text-muted font-mono text-center py-2">No data</div>
        ) : (
          <div className="space-y-1">
            {Object.entries(byRegime).map(([r, s]) => (
              <div key={r} className="flex items-center justify-between">
                <span className={`text-2xs font-mono uppercase ${regimeColor[r] ?? 'text-slate-400'}`}>{r}</span>
                <div className="flex gap-3">
                  <span className="text-2xs font-mono text-muted">{s.total}t</span>
                  <span className="text-2xs font-mono text-slate-300">
                    {s.total ? ((s.wins / s.total) * 100).toFixed(0) : 0}%wr
                  </span>
                  <span className={`text-2xs font-mono font-semibold ${s.pnl >= 0 ? 'text-up' : 'text-down'}`}>
                    {s.pnl >= 0 ? '+' : ''}${s.pnl.toFixed(2)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
