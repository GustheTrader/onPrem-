import { useStore } from '../store'

export function RiskBar() {
  const metrics = useStore(s => s.metrics)
  const connected = useStore(s => s.connected)

  if (!metrics) return (
    <div className="h-9 bg-surface-panel border-b border-surface-border flex items-center px-4 gap-6">
      <span className="label">{connected ? 'Waiting for data...' : 'Connecting...'}</span>
    </div>
  )

  const pnlPos = metrics.net_pnl >= 0
  const usedPct = Math.min(
    ((20 - metrics.trades_remaining) / 20) * 100,
    100,
  )

  return (
    <div className="h-9 bg-surface-panel border-b border-surface-border flex items-center px-4 gap-6 overflow-x-auto">
      {/* Connection dot */}
      <div className={`w-2 h-2 rounded-full flex-shrink-0 ${connected ? 'bg-up' : 'bg-down'}`} />

      <Stat label="P&L" value={`${pnlPos ? '+' : ''}$${metrics.net_pnl.toFixed(2)}`}
        className={pnlPos ? 'text-up' : 'text-down'} />

      <Stat label="Trades" value={`${20 - metrics.trades_remaining}/20`}
        className={metrics.at_trade_limit ? 'text-down' : 'text-slate-200'} />

      <Stat label="Positions" value={`${metrics.concurrent_positions}/3`}
        className={metrics.concurrent_positions >= 3 ? 'text-warn' : 'text-slate-200'} />

      <Stat label="Sharpe" value={metrics.sharpe.toFixed(2)} className="text-slate-200" />

      <Stat label="MaxDD"
        value={`${(metrics.max_drawdown * 100).toFixed(1)}%`}
        className={metrics.max_drawdown > 0.02 ? 'text-warn' : 'text-slate-200'} />

      {/* Trade usage bar */}
      <div className="flex items-center gap-2 flex-shrink-0">
        <span className="label">Daily</span>
        <div className="w-24 h-1.5 bg-surface-border rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${
              metrics.at_trade_limit ? 'bg-down' : usedPct > 70 ? 'bg-warn' : 'bg-up'
            }`}
            style={{ width: `${usedPct}%` }}
          />
        </div>
      </div>

      {metrics.at_loss_limit && (
        <span className="tag bg-down/20 text-down border border-down/40 flex-shrink-0">
          ⛔ LOSS LIMIT
        </span>
      )}
      {metrics.at_trade_limit && (
        <span className="tag bg-warn/20 text-warn border border-warn/40 flex-shrink-0">
          ⚑ TRADE LIMIT
        </span>
      )}
    </div>
  )
}

function Stat({ label, value, className }: { label: string; value: string; className: string }) {
  return (
    <div className="flex items-baseline gap-1.5 flex-shrink-0">
      <span className="label">{label}</span>
      <span className={`font-mono text-xs font-semibold ${className}`}>{value}</span>
    </div>
  )
}
