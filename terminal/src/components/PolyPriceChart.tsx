/**
 * PolyPriceChart — High-frequency canvas-based price chart.
 * 
 * Samples the terminal price every 100ms to provide a super-smooth,
 * zero-latency price curve (similar to terminal Chart 3).
 * Aligned to the current Polymarket period.
 */

import { useRef, useEffect, useCallback, useMemo, useState } from 'react'
import { useStore } from '../store'

// ── Constants ────────────────────────────────────────────────────────────────
const MAX_POINTS = 8000
const SAMPLE_MS = 100
const GRID_COL = 'rgba(30,45,78,0.5)'
const SETTLE_COL = '#22d3ee'
const PRICE_COL = '#f97316'
const LABEL_COL = '#4a5568'
const FONT = 'JetBrains Mono, monospace'

const MARKET_DURATIONS: Record<string, number> = {
  '5min': 5 * 60 * 1000,
  '15min': 15 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  '4h': 4 * 60 * 60 * 1000,
}

interface Pt { t: number; y: number }

export function PolyPriceChart() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const bufRef = useRef<Pt[]>([])
  const rafRef = useRef(0)
  const sampRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const assetRef = useRef<string | null>(null)
  const lastSampleTsRef = useRef(0)   // tracks freshness for LIVE badge

  // Drives LIVE badge re-render every second
  const [, setTick] = useState(0)

  const activeAsset = useStore(s => s.activeAsset)
  const activeMarketKey = useStore(s => s.activeMarketKey)
  const markets = useStore(s => s.markets)
  const bars = useStore(s => s.bars[activeAsset])

  // ── Derived Market Info ────────────────────────────────────────────────────
  const activeMarket = useMemo(
    () => markets.find(m => m.key === activeMarketKey && m.asset === activeAsset)
      ?? markets.find(m => m.asset === activeAsset),
    [markets, activeMarketKey, activeAsset],
  )

  const settlementPrice = useMemo(() => {
    if (!activeMarket) return null
    // Prioritize real Polymarket resolution price from the question
    if (activeMarket.resolution_price) return activeMarket.resolution_price
    
    // Fallback to start-of-period price if no resolution price detected
    if (!bars.length) return null
    const dur = MARKET_DURATIONS[activeMarket.timeframe] ?? 5 * 60_000
    const startTs = activeMarket.expiry_ts - dur
    const b = bars.find(b => b.timestamp >= startTs) ?? bars[0]
    return b.open
  }, [activeMarket, bars])

  // ── Seed / Reset on Asset change ───────────────────────────────────────────
  useEffect(() => {
    if (activeAsset !== assetRef.current) {
      assetRef.current = activeAsset
      // Seed buffer from existing bars to have history immediately
      if (bars.length > 0) {
        bufRef.current = bars.slice(-200).map(b => ({ t: b.timestamp, y: b.close }))
      } else {
        bufRef.current = []
      }
    }
  }, [activeAsset, bars])

  // ── 100 ms Live Sampler ───────────────────────────────────────────────────
  useEffect(() => {
    sampRef.current = setInterval(() => {
      const s = useStore.getState()
      const asset = s.activeAsset
      
      // Prefer high-frequency ticks for the smoother curve
      const ticks = s.ticks[asset]
      const lastTick = ticks && ticks.length > 0 ? ticks[ticks.length - 1] : null
      const currentBars = s.bars[asset]
      const lastBar = currentBars && currentBars.length > 0 ? currentBars[currentBars.length - 1] : null
      
      const price = lastTick ? lastTick.price : (lastBar ? lastBar.close : 0)
      if (price === 0) return

      const now = Date.now()
      const buf = bufRef.current

      // Avoid duplicate timestamps
      const last = buf.length > 0 ? buf[buf.length - 1] : null
      if (last && (now - last.t) < 80) return

      buf.push({ t: now, y: price })
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

  // ── Draw Loop ─────────────────────────────────────────────────────────────
  const draw = useCallback(() => {
    const cvs = canvasRef.current
    if (!cvs) { rafRef.current = requestAnimationFrame(draw); return }
    const ctx = cvs.getContext('2d')
    if (!ctx) { rafRef.current = requestAnimationFrame(draw); return }

    const dpr = window.devicePixelRatio || 1
    const rect = cvs.getBoundingClientRect()
    const W = rect.width
    const H = rect.height
    if (cvs.width !== Math.round(W * dpr) || cvs.height !== Math.round(H * dpr)) {
      cvs.width = Math.round(W * dpr); cvs.height = Math.round(H * dpr)
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, W, H)

    const PT = 24, PB = 18, PL = 6, PR = 58
    const pW = W - PL - PR
    const pH = H - PT - PB

    const buf = bufRef.current
    if (buf.length < 2) {
      rafRef.current = requestAnimationFrame(draw); return
    }

    // ── Time window: full market period ─────────────────────────────────────
    const dur = activeMarket ? (MARKET_DURATIONS[activeMarket.timeframe] ?? 5 * 60_000) : 5 * 60_000
    const now = Date.now()
    const tMax = activeMarket ? Math.max(now, activeMarket.expiry_ts) : now
    const tMin = activeMarket ? (activeMarket.expiry_ts - dur) : (now - dur)

    const vis = buf.filter(p => p.t >= (tMin - 60000) && p.t <= tMax)
    if (vis.length < 1) {
      rafRef.current = requestAnimationFrame(draw); return
    }

    // ── Dynamic Y-axis: always centered on live price ────────────────────────
    // Pull the freshest price directly from the store on every frame.
    // This avoids any React-closure stale-value issue.
    const state = useStore.getState()
    const asset = state.activeAsset
    const barsList = state.bars[asset]
    const latestBar = barsList[barsList.length - 1]
    const curP = latestBar ? latestBar.close
                           : (vis.length > 0 ? vis[vis.length - 1].y : 0)
    if (!curP) { rafRef.current = requestAnimationFrame(draw); return }

    // The Y-range is driven ONLY by curP and settlementPrice.
    // We deliberately exclude old history from the scale calculation so that
    // the chart never "locks on" to a stale price level.
    const anchor1 = curP
    const anchor2 = settlementPrice ?? curP
    const anchor3 = activeMarket?.resolution_price ?? curP

    const lo = Math.min(anchor1, anchor2, anchor3)
    const hi = Math.max(anchor1, anchor2, anchor3)
    const spread = hi - lo

    // Minimum half-span: 0.1% of the price (e.g. $68 for BTC at $68K)
    const minHalf = curP * 0.001
    const half = Math.max(spread / 2 + spread * 0.3, minHalf)
    const mid = (hi + lo) / 2

    const yMin = mid - half
    const yMax = mid + half

    const xOf = (t: number) => PL + ((t - tMin) / (tMax - tMin)) * pW
    const yOf = (v: number) => PT + pH * (1 - (v - yMin) / (yMax - yMin))

    // ── Y-axis grid labels ──────────────────────────────────────────────────
    const decimals = (asset === 'SOL' || asset === 'XRP') ? 3 : 2
    ctx.setLineDash([2, 5])
    ctx.strokeStyle = GRID_COL
    ctx.lineWidth = 0.5
    const steps = 6
    for (let i = 0; i <= steps; i++) {
      const v = yMin + (yMax - yMin) * (i / steps)
      const gy = yOf(v)
      ctx.beginPath(); ctx.moveTo(PL, gy); ctx.lineTo(PL + pW, gy); ctx.stroke()
      ctx.fillStyle = LABEL_COL
      ctx.font = `9px ${FONT}`
      ctx.textAlign = 'left'
      ctx.fillText(
        '$' + v.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals }),
        PL + pW + 4, gy + 3
      )
    }
    ctx.setLineDash([])

    // ── Settle Line ─────────────────────────────────────────────────────────
    if (settlementPrice) {
      const sy = yOf(settlementPrice)
      ctx.setLineDash([6, 3])
      ctx.strokeStyle = SETTLE_COL
      ctx.lineWidth = 1.5
      ctx.globalAlpha = 0.6
      ctx.beginPath(); ctx.moveTo(PL, sy); ctx.lineTo(PL + pW, sy); ctx.stroke()
      ctx.globalAlpha = 1
      ctx.setLineDash([])

      ctx.fillStyle = SETTLE_COL
      ctx.font = `bold 8px ${FONT}`
      ctx.textAlign = 'left'
      ctx.fillText('SETTLE', PL + 4, sy - 4)
    }

    // ── Price Area Path ─────────────────────────────────────────────────────
    ctx.beginPath()
    ctx.moveTo(xOf(vis[0].t), yOf(vis[0].y))
    for (let i = 1; i < vis.length; i++) {
      ctx.lineTo(xOf(vis[i].t), yOf(vis[i].y))
    }

    // Fill
    const fillGrad = ctx.createLinearGradient(0, PT, 0, PT + pH)
    fillGrad.addColorStop(0, 'rgba(249, 115, 22, 0.3)')
    fillGrad.addColorStop(1, 'rgba(249, 115, 22, 0.0)')
    // const fillPath = new Path2D(ctx.getTransform().toString()) // placeholder

    // Manual fill closure
    ctx.save()
    ctx.lineTo(xOf(vis[vis.length - 1].t), PT + pH)
    ctx.lineTo(xOf(vis[0].t), PT + pH)
    ctx.closePath()
    ctx.fillStyle = fillGrad
    ctx.fill()
    ctx.restore()

    // Stroke
    ctx.beginPath()
    ctx.moveTo(xOf(vis[0].t), yOf(vis[0].y))
    for (let i = 1; i < vis.length; i++) {
      ctx.lineTo(xOf(vis[i].t), yOf(vis[i].y))
    }
    ctx.strokeStyle = PRICE_COL
    ctx.lineWidth = 2
    ctx.lineJoin = 'round'
    ctx.stroke()

    // ── Current Price Marker ────────────────────────────────────────────────
    const last = vis[vis.length - 1]
    const curY = yOf(last.y)
    const isUp = settlementPrice ? last.y >= settlementPrice : true
    const tagCol = isUp ? '#00d4a4' : '#ff4757'

    ctx.fillStyle = tagCol
    ctx.beginPath()
    ctx.roundRect(PL + pW + 2, curY - 9, 54, 18, 3)
    ctx.fill()

    ctx.fillStyle = isUp ? '#0a0e1a' : '#ffffff'
    ctx.font = `bold 9px ${FONT}`
    ctx.textAlign = 'center'
    ctx.fillText('$' + last.y.toLocaleString(undefined, { minimumFractionDigits: 1 }), PL + pW + 29, curY + 4)

    rafRef.current = requestAnimationFrame(draw)
  }, [activeAsset, activeMarket, settlementPrice, bars])

  useEffect(() => {
    rafRef.current = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(rafRef.current)
  }, [draw])

  // ── Header Overlay ────────────────────────────────────────────────────────────────
  const lastY = bufRef.current.length > 0 ? bufRef.current[bufRef.current.length - 1].y : 0
  const baseP = settlementPrice ?? (bufRef.current[0]?.y || lastY)
  const pctChange = baseP === 0 ? 0 : ((lastY - baseP) / baseP) * 100
  // LIVE: sampler received a point in the last 3 seconds
  const isLive = (Date.now() - lastSampleTsRef.current) < 3000 && lastSampleTsRef.current > 0

  return (
    <div className="relative h-full flex flex-col bg-surface select-none overflow-hidden">
      <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-3 pt-1 z-10 pointer-events-none">
        <div className="flex items-center gap-2">
          <span
            className="text-2xs font-mono font-semibold text-slate-300"
            style={{ borderBottom: `1px dashed ${activeMarket?.resolution_price ? '#ff4757' : '#22d3ee'}`, paddingBottom: 1 }}
          >
            {activeMarket?.resolution_price
              ? `$${activeMarket.resolution_price.toLocaleString()} or above`
              : settlementPrice
                ? `SETTLE $${settlementPrice.toLocaleString()}`
                : `${activeAsset} · Live Price`}
          </span>

          {/* LIVE badge */}
          <span className={`live-badge${isLive ? '' : ' stale'}`}>
            <span className={`live-dot${isLive ? '' : ' stale'}`} />
            {isLive ? '100ms' : 'Paused'}
          </span>
        </div>

        <span
          className="text-2xs font-mono font-semibold px-1.5 py-0.5 rounded"
          style={{
            background: pctChange >= 0 ? 'rgba(0,212,164,0.15)' : 'rgba(255,71,87,0.2)',
            color: pctChange >= 0 ? '#00d4a4' : '#ff4757',
          }}
        >
          {pctChange >= 0 ? '+' : ''}{pctChange.toFixed(4)}%
        </span>
      </div>

      <canvas ref={canvasRef} className="flex-1 w-full" />
    </div>
  )
}
