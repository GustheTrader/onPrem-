import toast from 'react-hot-toast'
import { useStore } from '../store'
import type { Position } from '../types'

const API = '/api'

function Countdown({ secs }: { secs: number }) {
  const m = Math.floor(secs / 60)
  const s = Math.floor(secs % 60)
  const urgent = secs < 120

  return (
    <span className={`font-mono text-2xs ${urgent ? 'text-warn blink' : 'text-muted'}`}>
      {m}:{s.toString().padStart(2, '0')}
    </span>
  )
}

function PositionRow({ pos }: { pos: Position }) {
  const pnlPos = pos.unrealized_pnl >= 0

  async function close() {
    await fetch(`${API}/order/${pos.position_id}`, { method: 'DELETE' })
    toast('Position closed', { style: { background: '#0f1629', color: '#e2e8f0', border: '1px solid #1e2d4e' } })
  }

  return (
    <div className="flex items-center gap-2 px-2 py-1.5 border-b border-surface-border/50 hover:bg-surface-hover transition-colors">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-semibold text-slate-200">{pos.asset}</span>
          <span className={`tag ${pos.direction === 'UP' ? 'tag-up' : 'tag-down'}`}>
            {pos.direction}
          </span>
          {pos.is_copy && <span className="tag bg-accent/15 text-accent">COPY</span>}
          {pos.partial_exit_done && <span className="tag bg-purple-500/15 text-purple-400">½ EXIT</span>}
        </div>
        <div className="flex gap-3 mt-0.5">
          <span className="text-2xs font-mono text-muted">entry {pos.entry_price.toFixed(4)}</span>
          <span className="text-2xs font-mono text-muted">now {pos.current_price.toFixed(4)}</span>
          <span className="text-2xs font-mono text-muted">${pos.size.toFixed(0)}</span>
        </div>
      </div>

      <div className="text-right">
        <div className={`text-xs font-mono font-semibold ${pnlPos ? 'text-up' : 'text-down'}`}>
          {pnlPos ? '+' : ''}{pos.unrealized_pnl.toFixed(2)}
        </div>
        <Countdown secs={pos.expiry_secs} />
      </div>

      <button
        onClick={close}
        className="text-2xs btn btn-danger py-0.5 px-1.5 ml-1"
      >
        ✕
      </button>
    </div>
  )
}

export function PositionMonitor() {
  const positions = useStore(s => s.positions)

  if (positions.length === 0) {
    return (
      <div className="flex flex-col h-full">
        <div className="panel-header">
          <span className="text-xs font-semibold text-slate-300">Positions</span>
          <span className="label">0 open</span>
        </div>
        <div className="flex-1 flex items-center justify-center text-muted text-xs font-mono">
          No open positions
        </div>
      </div>
    )
  }

  const totalPnl = positions.reduce((sum, p) => sum + p.unrealized_pnl, 0)

  return (
    <div className="flex flex-col h-full">
      <div className="panel-header">
        <span className="text-xs font-semibold text-slate-300">Positions</span>
        <div className="flex items-center gap-2">
          <span className="label">{positions.length} open</span>
          <span className={`text-xs font-mono font-semibold ${totalPnl >= 0 ? 'text-up' : 'text-down'}`}>
            {totalPnl >= 0 ? '+' : ''}{totalPnl.toFixed(2)}
          </span>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {positions.map(p => <PositionRow key={p.position_id} pos={p} />)}
      </div>
    </div>
  )
}
