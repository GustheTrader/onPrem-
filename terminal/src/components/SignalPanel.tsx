import { useStore } from '../store'
import type { Asset, ModelName, Signal } from '../types'
import { MODEL_LABELS, MODEL_COLORS } from '../types'

interface Props { asset: Asset }

const MODEL_ORDER: ModelName[] = ['kc_reversion', 'flow_toxicity', 'low_vol_accum', 'high_vol_momentum']

function StrengthBar({ strength, color }: { strength: number; color: string }) {
  const pct = (strength / 3) * 100
  return (
    <div className="strength-bar w-full mt-0.5">
      <div className="strength-fill" style={{ width: `${pct}%`, backgroundColor: color }} />
    </div>
  )
}

function ModelRow({ model, signal }: { model: ModelName; signal?: Signal }) {
  const color = MODEL_COLORS[model]
  const label = MODEL_LABELS[model]
  const active = !!signal

  return (
    <div className={`px-2 py-1.5 rounded transition-colors ${
      active ? 'bg-surface-card border border-surface-border/80' : 'opacity-40'
    }`}>
      <div className="flex items-center justify-between mb-0.5">
        <div className="flex items-center gap-1.5">
          <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }} />
          <span className="text-2xs font-mono text-slate-400">{label}</span>
        </div>
        {signal && (
          <div className="flex items-center gap-1">
            <span className={`tag ${signal.direction === 'UP' ? 'tag-up' : 'tag-down'}`}>
              {signal.direction}
            </span>
            <span className="text-2xs font-mono text-muted">{signal.strength.toFixed(1)}</span>
          </div>
        )}
      </div>
      <StrengthBar strength={signal?.strength ?? 0} color={active ? color : '#2d3748'} />
    </div>
  )
}

export function SignalPanel({ asset }: Props) {
  const signals = useStore(s => s.signals[asset])
  const zscore  = useStore(s => s.zscore[asset])
  const regime  = useStore(s => s.regime[asset])

  const sigMap = Object.fromEntries(signals.map(s => [s.model, s]))
  const hasSignal = signals.length > 0

  return (
    <div className="flex flex-col h-full">
      <div className="panel-header">
        <span className="text-xs font-semibold text-slate-300">Signals</span>
        <div className="flex items-center gap-2">
          <span className={`tag tag-${regime}`}>
            {regime.toUpperCase()}
          </span>
        </div>
      </div>

      {/* Z-score gauge */}
      <div className="px-2 py-2 border-b border-surface-border">
        <div className="flex justify-between mb-1">
          <span className="label">Z-Score</span>
          <span className={`font-mono text-xs ${zscore > 1.5 ? 'text-down' : zscore < -1.5 ? 'text-up' : 'text-slate-300'}`}>
            {zscore.toFixed(2)}
          </span>
        </div>
        <div className="relative h-2 bg-surface-card rounded-full overflow-hidden">
          {/* center line */}
          <div className="absolute left-1/2 top-0 bottom-0 w-px bg-surface-border" />
          {/* z-score fill */}
          <div
            className={`absolute top-0 h-full rounded-full transition-all duration-500 ${
              zscore >= 0 ? 'bg-down/70' : 'bg-up/70'
            }`}
            style={{
              left: zscore >= 0 ? '50%' : `${50 + (zscore / 3) * 50}%`,
              width: `${Math.min(Math.abs(zscore) / 3 * 50, 50)}%`,
            }}
          />
        </div>
        <div className="flex justify-between mt-0.5">
          <span className="text-2xs text-muted">-3</span>
          <span className="text-2xs text-muted">0</span>
          <span className="text-2xs text-muted">+3</span>
        </div>
      </div>

      {/* Model rows */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
        {MODEL_ORDER.map(m => (
          <ModelRow key={m} model={m} signal={sigMap[m]} />
        ))}
      </div>

      {/* Active signal summary */}
      {hasSignal && (
        <div className="border-t border-surface-border p-2">
          <div className="label mb-1">Active Signals</div>
          <div className="flex flex-wrap gap-1">
            {signals.map((s, i) => (
              <span key={i} className={`tag ${s.direction === 'UP' ? 'tag-up' : 'tag-down'}`}>
                {s.asset} {MODEL_LABELS[s.model].split(' ')[0]}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
