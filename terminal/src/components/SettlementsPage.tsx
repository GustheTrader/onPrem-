import { useEffect } from 'react'
import { useStore } from '../store'
import type { Settlement } from '../types'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleString('en-US', {
    month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  })
}

function fmtVolume(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`
  if (v >= 1_000)     return `$${(v / 1_000).toFixed(0)}K`
  return `$${v.toFixed(0)}`
}

const TF_COLORS: Record<string, string> = {
  '5min':  '#38bdf8',
  '15min': '#818cf8',
  '1h':    '#fb923c',
  '4h':    '#a78bfa',
}

const ASSET_ICONS: Record<string, string> = {
  BTC: '₿', ETH: 'Ξ', SOL: '◎', XRP: '✕',
}

// ── Summary stats strip ───────────────────────────────────────────────────────

function StatsStrip({ settlements }: { settlements: Settlement[] }) {
  const live  = settlements.filter(s => s.live).length
  const total = settlements.length
  const upWins = settlements.filter(s => s.outcome === 'UP').length
  const downWins = total - upWins
  const livePct  = total > 0 ? (live / total * 100).toFixed(0) : '—'
  const upPct    = total > 0 ? (upWins / total * 100).toFixed(0) : '—'

  const stats = [
    { label: 'Total Settled',  value: total.toString(),       color: 'text-slate-300' },
    { label: 'Live Markets',   value: `${live} (${livePct}%)`, color: 'text-accent' },
    { label: 'UP Resolutions', value: `${upWins} (${upPct}%)`, color: 'text-up' },
    { label: 'DOWN Resolutions', value: `${downWins}`,          color: 'text-down' },
  ]

  return (
    <div className="flex gap-4 px-4 py-2.5 border-b border-surface-border bg-surface-panel shrink-0">
      {stats.map(s => (
        <div key={s.label} className="flex flex-col">
          <span className="text-2xs text-muted font-mono uppercase tracking-wider">{s.label}</span>
          <span className={`text-sm font-mono font-bold ${s.color}`}>{s.value}</span>
        </div>
      ))}
      <div className="ml-auto flex items-center gap-2">
        <div className="w-1.5 h-1.5 rounded-full bg-up animate-pulse" />
        <span className="text-2xs font-mono text-muted">Auto-updates on rotation</span>
      </div>
    </div>
  )
}

// ── Row ───────────────────────────────────────────────────────────────────────

function SettlementRow({ s, index }: { s: Settlement; index: number }) {
  const isUp   = s.outcome === 'UP'
  const tfColor = TF_COLORS[s.timeframe] ?? '#94a3b8'

  return (
    <tr className={`border-b border-surface-border/40 ${index % 2 === 0 ? 'bg-surface' : 'bg-surface-panel'} hover:bg-surface-hover transition-colors`}>
      {/* Time */}
      <td className="px-3 py-1.5 text-2xs font-mono text-muted whitespace-nowrap">
        {fmtTime(s.settled_at)}
      </td>

      {/* Asset + TF */}
      <td className="px-3 py-1.5 whitespace-nowrap">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-bold text-slate-300">{ASSET_ICONS[s.asset] ?? s.asset}</span>
          <span className="text-xs font-semibold text-slate-200">{s.asset}</span>
          <span
            className="text-2xs px-1 py-0.5 rounded font-mono font-semibold"
            style={{ color: tfColor, background: `${tfColor}22` }}
          >
            {s.timeframe}
          </span>
          {s.live ? (
            <span className="text-2xs px-0.5 rounded bg-up/15 text-up font-mono">LIVE</span>
          ) : (
            <span className="text-2xs px-0.5 rounded bg-surface text-muted font-mono">SYN</span>
          )}
        </div>
      </td>

      {/* Question — truncated */}
      <td className="px-3 py-1.5 max-w-xs">
        <span className="text-2xs font-mono text-slate-400 leading-tight line-clamp-2" title={s.question}>
          {s.question}
        </span>
      </td>

      {/* Final probabilities */}
      <td className="px-3 py-1.5 text-right whitespace-nowrap">
        <div className="flex items-center justify-end gap-2">
          <span className="text-2xs font-mono text-up">{s.final_up_pct.toFixed(1)}%</span>
          <span className="text-2xs text-muted">/</span>
          <span className="text-2xs font-mono text-down">{s.final_down_pct.toFixed(1)}%</span>
        </div>
      </td>

      {/* Probability bar */}
      <td className="px-3 py-1.5 w-24">
        <div className="relative h-1.5 rounded-full bg-surface-border overflow-hidden w-20">
          <div
            className="absolute left-0 top-0 h-full rounded-full bg-up"
            style={{ width: `${s.final_up_pct}%` }}
          />
          <div
            className="absolute right-0 top-0 h-full rounded-full bg-down"
            style={{ width: `${s.final_down_pct}%` }}
          />
        </div>
      </td>

      {/* Outcome badge */}
      <td className="px-3 py-1.5 whitespace-nowrap">
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-2xs font-mono font-bold ${
          isUp
            ? 'bg-up/20 text-up border border-up/30'
            : 'bg-down/20 text-down border border-down/30'
        }`}>
          {isUp ? '▲ UP' : '▼ DOWN'}
        </span>
      </td>

      {/* Volume */}
      <td className="px-3 py-1.5 text-right whitespace-nowrap">
        <span className="text-2xs font-mono text-muted">{fmtVolume(s.volume)}</span>
      </td>
    </tr>
  )
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center px-8">
      <span className="text-4xl">⏳</span>
      <div>
        <p className="text-sm font-semibold text-slate-300 mb-1">No settlements yet</p>
        <p className="text-xs text-muted font-mono max-w-sm">
          Markets are recorded here when they expire and rotate.
          5-min markets rotate every 5 minutes; records accumulate automatically.
        </p>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function SettlementsPage() {
  const settlements  = useStore(s => s.settlements)
  const setSettlements = useStore(s => s.setSettlements)

  // Fetch on mount in case the WS snapshot is stale or missing
  useEffect(() => {
    fetch('/api/settlements?limit=200')
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data.settlements) && data.settlements.length > 0) {
          setSettlements(data.settlements)
        }
      })
      .catch(() => {/* silently ignore */})
  }, [setSettlements])

  return (
    <div className="flex flex-col h-full bg-surface overflow-hidden">
      {/* Header */}
      <div className="px-4 py-2 border-b border-surface-border bg-surface-panel shrink-0 flex items-center justify-between">
        <div>
          <h2 className="text-xs font-bold text-slate-200 tracking-widest uppercase">
            Settlement History
          </h2>
          <p className="text-2xs text-muted font-mono mt-0.5">
            All expired markets with final probabilities and resolution outcomes
          </p>
        </div>
        <span className="text-2xs font-mono text-muted bg-surface px-2 py-1 rounded border border-surface-border">
          {settlements.length} records
        </span>
      </div>

      {/* Stats strip */}
      <StatsStrip settlements={settlements} />

      {/* Table or empty state */}
      {settlements.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="flex-1 min-h-0 overflow-auto">
          <table className="w-full border-collapse text-left">
            <thead className="sticky top-0 z-10 bg-surface-panel border-b border-surface-border">
              <tr>
                {[
                  { label: 'Settled At', cls: 'w-36' },
                  { label: 'Market',     cls: 'w-36' },
                  { label: 'Question',   cls: '' },
                  { label: 'Final UP / DOWN', cls: 'w-32 text-right' },
                  { label: 'Bar',        cls: 'w-24' },
                  { label: 'Outcome',    cls: 'w-20' },
                  { label: 'Volume',     cls: 'w-20 text-right' },
                ].map(h => (
                  <th
                    key={h.label}
                    className={`px-3 py-1.5 text-2xs font-semibold text-muted uppercase tracking-wider whitespace-nowrap ${h.cls}`}
                  >
                    {h.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {settlements.map((s, i) => (
                <SettlementRow key={`${s.key}-${s.settled_at}`} s={s} index={i} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
