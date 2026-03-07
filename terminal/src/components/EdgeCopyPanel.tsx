import { useState } from 'react'
import toast from 'react-hot-toast'
import { useStore } from '../store'
import type { MasterInfo } from '../types'

const API = '/api'

function MasterRow({ master }: { master: MasterInfo }) {
  return (
    <div className={`px-2 py-1.5 rounded border ${
      master.paused
        ? 'border-surface-border opacity-50'
        : 'border-surface-border/50 bg-surface-card'
    }`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <div className={`w-1.5 h-1.5 rounded-full ${master.paused ? 'bg-warn' : 'bg-up'}`} />
          <span className="text-xs font-mono text-slate-300">
            {master.alias ?? master.wallet_address.slice(0, 10) + '...'}
          </span>
          <span className={`tag text-2xs ${master.source === 'leaderboard' ? 'bg-accent/15 text-accent' : 'bg-purple-500/15 text-purple-400'}`}>
            {master.source}
          </span>
        </div>
        {master.paused && <span className="tag bg-warn/15 text-warn">PAUSED</span>}
      </div>
      <div className="flex gap-4 mt-0.5">
        <span className="text-2xs text-muted font-mono">WR {(master.win_rate * 100).toFixed(1)}%</span>
        <span className="text-2xs text-muted font-mono">Sharpe {master.sharpe.toFixed(2)}</span>
        <span className="text-2xs text-muted font-mono">{master.trade_count} trades</span>
      </div>
    </div>
  )
}

export function EdgeCopyPanel() {
  const copyStatus = useStore(s => s.copyStatus)
  const [toggling, setToggling] = useState(false)

  const enabled = copyStatus?.enabled ?? false

  async function toggleBot() {
    setToggling(true)
    try {
      const endpoint = enabled ? 'stop' : 'start'
      await fetch(`${API}/copy/${endpoint}`, { method: 'POST' })
      toast(enabled ? 'EdgeCopy stopped' : 'EdgeCopy started', {
        style: { background: '#0f1629', color: '#e2e8f0', border: '1px solid #1e2d4e' },
        icon: enabled ? '⏹' : '▶',
      })
    } finally {
      setToggling(false)
    }
  }

  const masters = copyStatus?.active_masters ?? []

  return (
    <div className="flex flex-col h-full">
      <div className="panel-header">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${enabled ? 'bg-up' : 'bg-muted'}`} />
          <span className="text-xs font-semibold text-slate-300">EdgeCopy</span>
        </div>
        <button
          className={`btn text-xs ${enabled ? 'btn-danger' : 'btn-up'}`}
          onClick={toggleBot}
          disabled={toggling}
        >
          {toggling ? '...' : enabled ? '⏹ Stop' : '▶ Start'}
        </button>
      </div>

      <div className="p-2 flex flex-col gap-2 flex-1 overflow-y-auto">
        {/* Stats */}
        <div className="grid grid-cols-2 gap-2">
          <div className="bg-surface-card border border-surface-border rounded p-2">
            <div className="label mb-0.5">Copy Trades</div>
            <span className="val text-sm">{copyStatus?.copy_trades_today ?? 0}</span>
          </div>
          <div className="bg-surface-card border border-surface-border rounded p-2">
            <div className="label mb-0.5">Copy P&L</div>
            <span className={`text-sm font-mono font-semibold ${
              (copyStatus?.copy_pnl_today ?? 0) >= 0 ? 'text-up' : 'text-down'
            }`}>
              {(copyStatus?.copy_pnl_today ?? 0) >= 0 ? '+' : ''}
              ${(copyStatus?.copy_pnl_today ?? 0).toFixed(2)}
            </span>
          </div>
        </div>

        {/* Masters */}
        <div>
          <div className="label mb-1.5">
            Masters ({masters.length})
          </div>
          {!enabled && masters.length === 0 && (
            <div className="text-2xs text-muted font-mono text-center py-3">
              Start EdgeCopy to begin copy trading
            </div>
          )}
          <div className="space-y-1.5">
            {masters.map((m, i) => <MasterRow key={i} master={m} />)}
          </div>
        </div>

        {/* Config summary */}
        <div className="mt-auto pt-2 border-t border-surface-border">
          <div className="label mb-1">Config</div>
          <div className="space-y-0.5">
            {[
              ['Sizing', 'Proportional'],
              ['Max Copy', '$500 / trade'],
              ['Min Win Rate', '45%'],
              ['Poll Interval', '5 s'],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between">
                <span className="text-2xs text-muted">{k}</span>
                <span className="text-2xs font-mono text-slate-400">{v}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
