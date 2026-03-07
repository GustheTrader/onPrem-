import { useEffect, useState } from 'react'
import { useStore } from '../store'
import type { Asset, TimeFrame, MarketInfo, StagedMarket } from '../types'
import { TIMEFRAME_LABELS } from '../types'

const ASSETS: Asset[] = ['BTC', 'ETH', 'SOL', 'XRP']
const TIMEFRAMES: TimeFrame[] = ['5min', '15min', '1h', '4h']

const ASSET_ICONS: Record<Asset, string> = {
  BTC: '₿', ETH: 'Ξ', SOL: '◎', XRP: '✕',
}

// ── Health polling ────────────────────────────────────────────────────────────

interface HealthState {
  clob_connected: boolean
  clob_age_s: number | null
  live_active: number
  total_active: number
  kraken_age_s: number | null
  ok: boolean
}

function useHealthPoll(intervalMs = 10_000): HealthState {
  const [health, setHealth] = useState<HealthState>({
    clob_connected: false, clob_age_s: null,
    live_active: 0, total_active: 0, kraken_age_s: null, ok: false,
  })

  useEffect(() => {
    let cancelled = false
    const poll = async () => {
      try {
        const r = await fetch('/api/health')
        if (!r.ok || cancelled) return
        const d = await r.json()
        if (cancelled) return
        setHealth({
          clob_connected: d.clob_ws?.connected ?? false,
          clob_age_s: d.clob_ws?.last_msg_age_s ?? null,
          live_active: d.markets?.active_live ?? 0,
          total_active: (d.markets?.active_live ?? 0) + (d.markets?.active_synth ?? 0),
          kraken_age_s: d.kraken_ws?.last_msg_age_s ?? null,
          ok: d.status === 'ok',
        })
      } catch { /* silently ignore */ }
    }
    poll()
    const t = setInterval(poll, intervalMs)
    return () => { cancelled = true; clearInterval(t) }
  }, [intervalMs])

  return health
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatCountdown(expiryMs: number): string {
  const secs = Math.max(0, Math.floor((expiryMs - Date.now()) / 1000))
  if (secs <= 0) return 'Expired'
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  const s = secs % 60
  if (h > 0) return `${h}h ${m.toString().padStart(2, '0')}m`
  return `${m}:${s.toString().padStart(2, '0')}`
}

function formatVolume(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`
  if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}K`
  return `$${v.toFixed(0)}`
}

/** "3s" / "12s" / "1m 4s" / "stale" age label */
function formatAge(lastUpdateMs: number | undefined): { label: string; stale: boolean } {
  if (!lastUpdateMs) return { label: '—', stale: false }
  const secs = Math.round((Date.now() - lastUpdateMs) / 1000)
  if (secs < 0) return { label: '0s', stale: false }
  if (secs < 60) return { label: `${secs}s`, stale: secs > 45 }
  const m = Math.floor(secs / 60), s = secs % 60
  return { label: `${m}m ${s}s`, stale: secs > 120 }
}

// ── Sub-components ────────────────────────────────────────────────────────────

/** Compact card for the next-up staged market */
function StagedCard({ staged, activeExpiry }: { staged: StagedMarket; activeExpiry: number }) {
  const [, forceRender] = useState(0)
  useEffect(() => {
    const t = setInterval(() => forceRender(n => n + 1), 1000)
    return () => clearInterval(t)
  }, [])

  const startsIn = formatCountdown(activeExpiry)
  const upHigh = staged.up_pct > staged.down_pct

  return (
    <div className="mt-0.5 w-full text-left px-2 py-1 rounded border border-dashed border-accent/25 bg-accent/5 opacity-70">
      <div className="flex items-center justify-between mb-0.5">
        <span className="text-2xs font-bold tracking-widest text-accent/70 uppercase">
          ⏩ Next
        </span>
        {staged.live && (
          <span className="text-2xs px-0.5 rounded bg-up/10 text-up/60 font-mono">LIVE</span>
        )}
      </div>
      <div className="flex items-center justify-between gap-1">
        <span className={`text-2xs font-mono font-semibold ${upHigh ? 'text-up/70' : 'text-up/40'}`}>
          ▲ {staged.up_pct.toFixed(1)}%
        </span>
        <span className={`text-2xs font-mono font-semibold ${!upHigh ? 'text-down/70' : 'text-down/40'}`}>
          ▼ {staged.down_pct.toFixed(1)}%
        </span>
      </div>
      <div className="flex items-center justify-end mt-0.5">
        <span className="text-2xs font-mono text-muted">starts in {startsIn}</span>
      </div>
    </div>
  )
}

function MarketCard({ market }: { market: MarketInfo }) {
  const activeKey = useStore(s => s.activeMarketKey)
  const setActiveMarketKey = useStore(s => s.setActiveMarketKey)
  const [, forceRender] = useState(0)
  const isActive = activeKey === market.key

  // Re-render every second for countdown + age
  useEffect(() => {
    const t = setInterval(() => forceRender(n => n + 1), 1000)
    return () => clearInterval(t)
  }, [])

  const countdown = formatCountdown(market.expiry_ts)
  const isExpired = countdown === 'Expired'
  const isUrgent = !isExpired && (market.expiry_ts - Date.now()) < 60_000
  const upHigh = market.up_pct > market.down_pct
  const age = formatAge(market.last_update_ms)

  return (
    <div className="space-y-0.5">
      <button
        onClick={() => setActiveMarketKey(isActive ? null : market.key)}
        className={`w-full text-left px-2 py-1.5 rounded transition-all border ${isActive
          ? 'border-accent/60 bg-accent/10'
          : 'border-surface-border/50 hover:border-surface-border hover:bg-surface-hover'
          } ${isExpired ? 'opacity-40' : ''}`}
      >
        {/* Row 1: Asset icon + probs */}
        <div className="flex items-center justify-between gap-1">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-bold text-slate-300 w-4">{ASSET_ICONS[market.asset]}</span>
            <span className="text-xs font-semibold text-slate-200">{market.asset}</span>
            {market.live ? (
              <span className="text-2xs px-0.5 rounded bg-up/15 text-up font-mono">LIVE</span>
            ) : (
              <span className="text-2xs px-0.5 rounded bg-surface text-muted font-mono">SYN</span>
            )}
          </div>
          <div className="flex items-center gap-1">
            <span className={`text-2xs font-mono font-bold px-1 py-0.5 rounded ${upHigh ? 'bg-up/20 text-up' : 'bg-surface text-up/70'
              }`}>
              ▲ {market.up_pct.toFixed(1)}%
            </span>
            <span className={`text-2xs font-mono font-bold px-1 py-0.5 rounded ${!upHigh ? 'bg-down/20 text-down' : 'bg-surface text-down/70'
              }`}>
              ▼ {market.down_pct.toFixed(1)}%
            </span>
          </div>
        </div>

        {/* Row 2: Volume + countdown */}
        <div className="flex items-center justify-between mt-0.5">
          <span className="text-2xs text-muted font-mono">{formatVolume(market.volume)}</span>
          <span className={`text-2xs font-mono ${isExpired ? 'text-muted' : isUrgent ? 'text-warn blink' : 'text-muted'
            }`}>
            ⏱ {countdown}
          </span>
        </div>

        {/* Row 3: Last update age — only for live markets */}
        {market.live && (
          <div className="flex items-center justify-end mt-0.5">
            <span className={`text-2xs font-mono ${age.stale ? 'text-warn' : 'text-muted/70'
              }`}>
              upd {age.label}{age.stale ? ' ⚠' : ''}
            </span>
          </div>
        )}
      </button>

      {market.staged_market && (
        <StagedCard staged={market.staged_market} activeExpiry={market.expiry_ts} />
      )}
    </div>
  )
}

// ── Status header ─────────────────────────────────────────────────────────────

function DataSourceHeader({ health, usingLiveData }: {
  health: HealthState
  usingLiveData: boolean
}) {
  const [, tick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => tick(n => n + 1), 1000)
    return () => clearInterval(t)
  }, [])

  if (!usingLiveData) {
    return (
      <div className="px-2 pt-1.5 pb-1 flex items-center gap-1.5">
        <div className="w-1.5 h-1.5 rounded-full bg-warn animate-pulse" />
        <span className="text-2xs font-mono text-warn">Synthetic Data</span>
      </div>
    )
  }

  const clobOk = health.clob_connected && (health.clob_age_s === null || health.clob_age_s < 60)
  const krakenOk = health.kraken_age_s !== null && health.kraken_age_s < 30
  const allOk = clobOk && krakenOk && health.live_active > 0

  // Dot color: green = fully live, yellow = partial, red = no data
  const dotClass = allOk
    ? 'bg-up animate-pulse'
    : health.live_active > 0
      ? 'bg-warn animate-pulse'
      : 'bg-down'

  const clobLabel = clobOk
    ? `WS ${health.clob_age_s !== null ? `${Math.round(health.clob_age_s)}s` : '—'}`
    : 'WS off'

  return (
    <div className="px-2 pt-1.5 pb-1 flex flex-col gap-0.5">
      {/* Main status row */}
      <div className="flex items-center gap-1.5">
        <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dotClass}`} />
        <span className="text-2xs font-mono text-muted">
          Polymarket Live
        </span>
        <span className={`ml-auto text-2xs font-mono font-semibold ${health.live_active === health.total_active ? 'text-up' : 'text-warn'
          }`}>
          {health.live_active}/{health.total_active}
        </span>
      </div>
      {/* WS telemetry row */}
      <div className="flex items-center gap-2 pl-3">
        <span className={`text-2xs font-mono ${clobOk ? 'text-muted/60' : 'text-warn'}`}>
          CLOB {clobLabel}
        </span>
        {health.kraken_age_s !== null && (
          <span className={`text-2xs font-mono ${krakenOk ? 'text-muted/60' : 'text-warn'}`}>
            KRK {Math.round(health.kraken_age_s)}s
          </span>
        )}
      </div>
    </div>
  )
}

// ── Main export ───────────────────────────────────────────────────────────────

export function MarketNav() {
  const markets = useStore(s => s.markets)
  const usingLiveData = useStore(s => s.usingLiveData)
  const health = useHealthPoll(10_000)

  const byTimeframe: Record<TimeFrame, MarketInfo[]> = {
    '5min': [], '15min': [], '1h': [], '4h': [],
  }

  for (const m of markets) {
    if (m.timeframe in byTimeframe) {
      byTimeframe[m.timeframe as TimeFrame].push(m)
    }
  }

  for (const tf of TIMEFRAMES) {
    byTimeframe[tf].sort((a, b) =>
      ASSETS.indexOf(a.asset as Asset) - ASSETS.indexOf(b.asset as Asset)
    )
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <DataSourceHeader health={health} usingLiveData={usingLiveData} />

      {TIMEFRAMES.map(tf => {
        const group = byTimeframe[tf]
        return (
          <div key={tf} className="border-t border-surface-border/50">
            <div className="px-2 py-1 flex items-center gap-2">
              <span className="text-2xs font-semibold text-muted uppercase tracking-wider">
                {TIMEFRAME_LABELS[tf]}
              </span>
              <div className="flex-1 h-px bg-surface-border/30" />
            </div>
            <div className="px-1.5 pb-1.5 space-y-1.5">
              {group.length === 0 ? (
                <div className="text-2xs text-muted font-mono px-1 py-2 text-center">
                  Fetching…
                </div>
              ) : (
                group.map(m => (
                  <MarketCard key={m.key} market={m} />
                ))
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
