/**
 * ProbChart — 100 ms streaming YES / NO probability canvas chart.
 *
 * Seeds the buffer with `market.prob_history` so historical data is visible
 * immediately.  Then continues sampling `polyBooks[activeMarketKey]` every
 * 100 ms for real-time streaming.  The time window spans the full market
 * period (e.g. 5 min) so you see the complete probability arc.
 *
 * Pure <canvas> — no SVG / Recharts overhead.
 */

import { useRef, useEffect, useCallback, useState } from 'react'
import { useStore } from '../store'

// ── Constants ────────────────────────────────────────────────────────────────
const MAX_POINTS = 8000       // enough for a 4 h market sampled every 100 ms (realistically limited by history density)
const SAMPLE_MS = 100        // live sample interval
const GRID = [0, 25, 50, 75, 100]

const YES_COL = '#00d4a4'
const NO_COL = '#ff4757'
const GRID_COL = 'rgba(30,45,78,0.5)'
const GRID_COL_50 = 'rgba(74,85,104,0.7)'
const LABEL_COL = '#4a5568'
const FONT = 'JetBrains Mono, monospace'

// Market timeframe durations in ms
const TF_MS: Record<string, number> = {
  '5min': 5 * 60_000,
  '15min': 15 * 60_000,
  '1h': 60 * 60_000,
  '4h': 4 * 60 * 60_000,
}

interface Pt { t: number; y: number; n: number }

// ── Component ────────────────────────────────────────────────────────────────
export function ProbChart() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const bufRef = useRef<Pt[]>([])
  const rafRef = useRef(0)
  const sampRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const keyRef = useRef<string | null>(null)
  const seededRef = useRef(false)
  const lastSampleTsRef = useRef(0)   // tracks sampler freshness for LIVE badge

  // Drives LIVE badge re-render every second
  const [, setTick] = useState(0)

  // Reactive header data
  const activeMarketKey = useStore(s => s.activeMarketKey)
  const markets = useStore(s => s.markets)
  const polyBooks = useStore(s => s.polyBooks)
  const market = markets.find(m => m.key === activeMarketKey)
  const book = activeMarketKey ? polyBooks[activeMarketKey] ?? null : null

  // ── Seed buffer from prob_history on market switch ─────────────────────────
  useEffect(() => {
    if (activeMarketKey !== keyRef.current) {
      keyRef.current = activeMarketKey
      seededRef.current = false
      bufRef.current = []

      // Find the market object and seed from its prob_history
      const s = useStore.getState()
      const mk = s.markets.find(m => m.key === activeMarketKey)
      if (mk?.prob_history && mk.prob_history.length > 0) {
        const hist = mk.prob_history
        bufRef.current = hist.map(p => ({
          t: p.ts,
          y: p.up_pct,
          n: Math.max(0, 100 - p.up_pct),
        }))
        seededRef.current = true
      }
    }
  }, [activeMarketKey])

  // Also re-seed when markets data updates (prob_history gets extended)
  useEffect(() => {
    if (!activeMarketKey) return
    if (seededRef.current) return  // already seeded, live samples take over

    const mk = markets.find(m => m.key === activeMarketKey)
    if (mk?.prob_history && mk.prob_history.length > 0 && bufRef.current.length === 0) {
      bufRef.current = mk.prob_history.map(p => ({
        t: p.ts,
        y: p.up_pct,
        n: Math.max(0, 100 - p.up_pct),
      }))
      seededRef.current = true
    }
  }, [markets, activeMarketKey])

  // ── 100 ms live sampler ───────────────────────────────────────────────────
  useEffect(() => {
    sampRef.current = setInterval(() => {
      const s = useStore.getState()
      const k = s.activeMarketKey
      if (!k) return
      const b = s.polyBooks[k]
      const m = s.markets.find(x => x.key === k)
      if (!b && !m) return

      const now = Date.now()
      const buf = bufRef.current

      // Avoid duplicate timestamps (prob_history has coarser points)
      const last = buf.length > 0 ? buf[buf.length - 1] : null
      if (last && (now - last.t) < 80) return  // skip if <80ms since last

      const y = b ? b.up_pct : (m ? m.up_pct : 50)
      const n = b ? b.down_pct : (m ? m.down_pct : 50)

      buf.push({ t: now, y, n })
      if (buf.length > MAX_POINTS) buf.splice(0, buf.length - MAX_POINTS)
      lastSampleTsRef.current = now   // update freshness tracker
    }, SAMPLE_MS)

    // Tick the badge re-render every second
    const tickId = setInterval(() => setTick(n => n + 1), 1000)

    return () => {
      if (sampRef.current) clearInterval(sampRef.current)
      clearInterval(tickId)
    }
  }, [])

  // ── rAF draw loop ─────────────────────────────────────────────────────────
  const draw = useCallback(() => {
    const cvs = canvasRef.current
    if (!cvs) { rafRef.current = requestAnimationFrame(draw); return }
    const ctx = cvs.getContext('2d')
    if (!ctx) { rafRef.current = requestAnimationFrame(draw); return }

    // ── DPR-aware resize ───────────────────────────────
    const dpr = window.devicePixelRatio || 1
    const rect = cvs.getBoundingClientRect()
    const W = rect.width
    const H = rect.height
    const cw = Math.round(W * dpr)
    const ch = Math.round(H * dpr)
    if (cvs.width !== cw || cvs.height !== ch) {
      cvs.width = cw
      cvs.height = ch
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, W, H)

    // ── Padding ────────────────────────────────────────
    const PT = 6, PB = 18, PL = 6, PR = 42
    const pW = W - PL - PR
    const pH = H - PT - PB

    // ── Grid + Y labels ────────────────────────────────
    for (const v of GRID) {
      const gy = PT + pH * (1 - v / 100)
      ctx.beginPath()
      ctx.moveTo(PL, gy)
      ctx.lineTo(PL + pW, gy)
      if (v === 50) {
        ctx.setLineDash([5, 3])
        ctx.strokeStyle = GRID_COL_50
        ctx.lineWidth = 1
      } else {
        ctx.setLineDash([2, 5])
        ctx.strokeStyle = GRID_COL
        ctx.lineWidth = 0.5
      }
      ctx.stroke()
      ctx.setLineDash([])

      ctx.fillStyle = LABEL_COL
      ctx.font = `9px ${FONT}`
      ctx.textAlign = 'left'
      ctx.fillText(`${v}%`, PL + pW + 4, gy + 3)
    }

    // ── Buffer check ───────────────────────────────────
    const buf = bufRef.current
    if (buf.length < 2) {
      ctx.fillStyle = LABEL_COL
      ctx.font = `11px ${FONT}`
      ctx.textAlign = 'center'
      ctx.fillText('Awaiting probability data…', W / 2, H / 2)
      rafRef.current = requestAnimationFrame(draw)
      return
    }

    // ── Time window: full market period ─────────────────
    // Read market info for the time span
    const s = useStore.getState()
    const mk = s.markets.find(m => m.key === s.activeMarketKey)
    const now = Date.now()

    let tMin: number
    let tMax: number

    if (mk) {
      const dur = TF_MS[mk.timeframe] ?? 5 * 60_000
      const periodStart = mk.expiry_ts - dur
      tMin = periodStart
      tMax = Math.max(now, mk.expiry_ts)
    } else {
      // Fallback: span from first data point to now
      tMin = buf[0].t
      tMax = now
    }

    // Ensure some minimal span
    if (tMax - tMin < 10_000) tMax = tMin + 10_000

    const xOf = (t: number) => PL + ((t - tMin) / (tMax - tMin)) * pW
    const yOf = (v: number) => PT + pH * (1 - Math.max(0, Math.min(100, v)) / 100)

    // Filter visible points
    const vis = buf.filter(p => p.t >= tMin && p.t <= tMax)
    if (vis.length < 1) {
      ctx.fillStyle = LABEL_COL
      ctx.font = `10px ${FONT}`
      ctx.textAlign = 'center'
      ctx.fillText('Waiting for period data…', W / 2, H / 2)
      rafRef.current = requestAnimationFrame(draw)
      return
    }

    // ── Draw helper ────────────────────────────────────
    function drawSeries(
      data: Pt[],
      key: 'y' | 'n',
      col: string,
      fillAlpha: number,
    ) {
      if (data.length < 2) return

      // ── Area fill ────────────────────────────────
      ctx!.beginPath()
      ctx!.moveTo(xOf(data[0].t), yOf(data[0][key]))
      for (let i = 1; i < data.length; i++) {
        ctx!.lineTo(xOf(data[i].t), yOf(data[i][key]))
      }
      ctx!.lineTo(xOf(data[data.length - 1].t), PT + pH)
      ctx!.lineTo(xOf(data[0].t), PT + pH)
      ctx!.closePath()
      ctx!.globalAlpha = fillAlpha
      ctx!.fillStyle = col
      ctx!.fill()
      ctx!.globalAlpha = 1

      // ── Line ─────────────────────────────────────
      ctx!.beginPath()
      ctx!.moveTo(xOf(data[0].t), yOf(data[0][key]))
      for (let i = 1; i < data.length; i++) {
        ctx!.lineTo(xOf(data[i].t), yOf(data[i][key]))
      }
      ctx!.strokeStyle = col
      ctx!.lineWidth = 2
      ctx!.lineJoin = 'round'
      ctx!.lineCap = 'round'
      ctx!.stroke()

      // ── Current dot + glow ───────────────────────
      const last = data[data.length - 1]
      const lx = xOf(last.t)
      const ly = yOf(last[key])

      // glow
      ctx!.beginPath()
      ctx!.arc(lx, ly, 7, 0, Math.PI * 2)
      ctx!.fillStyle = col
      ctx!.globalAlpha = 0.25
      ctx!.fill()
      ctx!.globalAlpha = 1

      // dot
      ctx!.beginPath()
      ctx!.arc(lx, ly, 3.5, 0, Math.PI * 2)
      ctx!.fillStyle = col
      ctx!.fill()

      // value label — positioned to avoid overlap
      const val = last[key]
      ctx!.fillStyle = col
      ctx!.font = `bold 10px ${FONT}`
      ctx!.textAlign = 'right'
      const labelY = key === 'y' ? ly - 8 : ly + 14
      ctx!.fillText(`${val.toFixed(1)}%`, lx - 2, labelY)
    }

    // Draw NO first (below), then YES on top
    drawSeries(vis, 'n', NO_COL, 0.06)
    drawSeries(vis, 'y', YES_COL, 0.10)

    // ── "Now" cursor line ────────────────────────────────
    if (now >= tMin && now <= tMax) {
      const nx = xOf(now)
      ctx.beginPath()
      ctx.moveTo(nx, PT)
      ctx.lineTo(nx, PT + pH)
      ctx.setLineDash([2, 3])
      ctx.strokeStyle = 'rgba(255,255,255,0.12)'
      ctx.lineWidth = 1
      ctx.stroke()
      ctx.setLineDash([])
    }

    // ── Expiry marker ────────────────────────────────────
    if (mk && mk.expiry_ts >= tMin && mk.expiry_ts <= tMax) {
      const ex = xOf(mk.expiry_ts)
      ctx.beginPath()
      ctx.moveTo(ex, PT)
      ctx.lineTo(ex, PT + pH)
      ctx.setLineDash([4, 3])
      ctx.strokeStyle = 'rgba(255,71,87,0.3)'
      ctx.lineWidth = 1
      ctx.stroke()
      ctx.setLineDash([])

      ctx.fillStyle = 'rgba(255,71,87,0.5)'
      ctx.font = `bold 7px ${FONT}`
      ctx.textAlign = 'center'
      ctx.fillText('EXP', ex, PT + 8)
    }

    // ── X-axis time labels ─────────────────────────────
    ctx.fillStyle = LABEL_COL
    ctx.font = `8px ${FONT}`
    ctx.textAlign = 'center'
    const spanMs = tMax - tMin
    const showDate = spanMs > 3600_000  // show HH:MM:SS for short, HH:MM for long
    const nLabels = Math.min(8, Math.max(4, Math.floor(pW / 80)))
    for (let i = 0; i < nLabels; i++) {
      const t = tMin + (i / (nLabels - 1)) * (tMax - tMin)
      const x = xOf(t)
      const d = new Date(t)
      const s = showDate
        ? d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' })
        : d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
      ctx.fillText(s, x, H - 3)
    }

    // ── 50% crosshair label ──────────────────────────────
    const y50 = yOf(50)
    ctx.fillStyle = GRID_COL_50
    ctx.font = `bold 8px ${FONT}`
    ctx.textAlign = 'right'
    ctx.fillText('50%', PL + pW + 38, y50 + 3)

    rafRef.current = requestAnimationFrame(draw)
  }, [])

  // Start / stop rAF
  useEffect(() => {
    rafRef.current = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(rafRef.current)
  }, [draw])

  // ── Compute header info ────────────────────────────────────────────────────────────────
  const lastPt = bufRef.current.length > 0 ? bufRef.current[bufRef.current.length - 1] : null
  const yesNow = book?.up_pct ?? market?.up_pct ?? lastPt?.y ?? null
  const noNow = book?.down_pct ?? market?.down_pct ?? lastPt?.n ?? null
  const tfLabel = market?.timeframe ? TF_MS[market.timeframe]
    ? `${(TF_MS[market.timeframe] / 60_000).toFixed(0)}m window`
    : market.timeframe
    : ''
  // LIVE: sampler received a point in the last 3 seconds
  const isLive = (Date.now() - lastSampleTsRef.current) < 3000 && lastSampleTsRef.current > 0

  // ── No market selected ──────────────────────────────────────────────────────
  if (!activeMarketKey) {
    return (
      <div className="flex flex-col h-full">
        <div className="panel-header">
          <span className="text-xs font-semibold text-slate-300">YES / NO Probability Stream</span>
        </div>
        <div className="flex-1 flex items-center justify-center text-xs text-muted font-mono">
          Select a market from the Markets tab
        </div>
      </div>
    )
  }

  // ── Main render ─────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full">

      {/* Header */}
      <div className="panel-header shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-slate-300">
            {market?.asset ?? '—'} {market?.timeframe ?? ''}
          </span>
          {/* Pulsing LIVE badge */}
          <span className={`live-badge${isLive ? '' : ' stale'}`}>
            <span className={`live-dot${isLive ? '' : ' stale'}`} />
            {isLive ? 'Live' : 'Waiting'}
          </span>
          <span className="text-2xs px-1 rounded bg-surface text-muted font-mono tracking-wider">
            {bufRef.current.length > 0 ? `${bufRef.current.length} pts` : '…'}
          </span>
          {tfLabel && (
            <span className="text-2xs text-slate-500 font-mono">{tfLabel}</span>
          )}
        </div>

        <div className="flex items-center gap-3">
          {yesNow != null && noNow != null && (
            <>
              {/* YES legend */}
              <div className="flex items-center gap-1">
                <span className="w-3 h-[2px] rounded-full inline-block" style={{ background: YES_COL }} />
                <span className="text-xs font-mono font-bold" style={{ color: YES_COL }}>
                  {yesNow.toFixed(1)}%
                </span>
              </div>
              {/* NO legend */}
              <div className="flex items-center gap-1">
                <span className="w-3 h-[2px] rounded-full inline-block" style={{ background: NO_COL }} />
                <span className="text-xs font-mono font-bold" style={{ color: NO_COL }}>
                  {noNow.toFixed(1)}%
                </span>
              </div>
            </>
          )}
          <span className="text-2xs px-1 rounded bg-accent/10 text-accent border border-accent/20 font-mono font-bold">
            100ms
          </span>
        </div>
      </div>

      {/* Canvas */}
      <div className="flex-1 min-h-0 relative bg-[#080d19]">
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full"
        />
      </div>
    </div>
  )
}
