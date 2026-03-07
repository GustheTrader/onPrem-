import { useEffect, useRef, useState, useMemo } from 'react'
import {
  createChart, ColorType, CrosshairMode, LineStyle,
  CandlestickSeries, LineSeries,
} from 'lightweight-charts'
import { useStore } from '../store'
import type { Asset, Bar } from '../types'

// ── Chart timeframe type ───────────────────────────────────────────────────
type TF = 'tick' | 1 | 5 | 15 | 60 | 240

const TF_OPTIONS: { value: TF; label: string; desc: string }[] = [
  { value: 'tick', label: 'Tick', desc: 'Raw ticks' },
  { value: 1, label: '1m', desc: 'High res' },
  { value: 5, label: '5m', desc: 'Standard' },
  { value: 15, label: '15m', desc: '15m bars' },
  { value: 60, label: '1h', desc: 'Hourly' },
  { value: 240, label: '4h', desc: '4h bars' },
]

// No-op - unused vars removed.

interface Props { asset: Asset }

// ── Keltner Channel (EMA-based) ───────────────────────────────────────────────
function emaArr(values: number[], period: number): number[] {
  if (values.length === 0) return []
  const k = 2 / (period + 1)
  const out: number[] = [values[0]]
  for (let i = 1; i < values.length; i++) {
    out.push(values[i] * k + out[i - 1] * (1 - k))
  }
  return out
}

function calcKC(bars: Bar[], period = 20, mult = 2.5) {
  if (bars.length < 2) return null
  const closes = bars.map(b => b.close)
  const midLine = emaArr(closes, period)
  const tr = bars.map((b, i) =>
    i === 0
      ? b.high - b.low
      : Math.max(
        b.high - b.low,
        Math.abs(b.high - bars[i - 1].close),
        Math.abs(b.low - bars[i - 1].close),
      ),
  )
  const atrLine = emaArr(tr, period)
  return bars.map((b, i) => ({
    time: Math.floor(b.timestamp / 1000) as any,
    upper: midLine[i] + mult * atrLine[i],
    mid: midLine[i],
    lower: midLine[i] - mult * atrLine[i],
  }))
}

// ── Countdown helper ──────────────────────────────────────────────────────────
function fmtCountdown(expiryMs: number): string {
  const secs = Math.max(0, Math.floor((expiryMs - Date.now()) / 1000))
  if (secs <= 0) return 'exp'
  if (secs < 3600) {
    const m = Math.floor(secs / 60)
    const s = secs % 60
    return `${m}:${s.toString().padStart(2, '0')}`
  }
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  return `${h}h ${m}m`
}

// ── Deduplicate + sort bars before handing to lightweight-charts ─────────────
function prepBars(bars: Bar[]) {
  const map = new Map<number, any>()
  for (const b of bars) {
    const t = Math.floor(b.timestamp / 1000)
    map.set(t, { time: t as any, open: b.open, high: b.high, low: b.low, close: b.close })
  }
  return Array.from(map.values()).sort((a, b) => a.time - b.time)
}

// ── Component ────────────────────────────────────────────────────────────────
export function Chart({ asset }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<any>(null)
  const candleRef = useRef<any>(null)
  const upperRef = useRef<any>(null)
  const midRef = useRef<any>(null)
  const lowerRef = useRef<any>(null)
  const tickRef = useRef<any>(null)

  // Live 1-min bars + ticks from WS store
  const liveBars = useStore(s => s.bars[asset])
  const liveTicks = useStore(s => s.ticks[asset])
  const activeMarketKey = useStore(s => s.activeMarketKey)
  const markets = useStore(s => s.markets)
  const connected = useStore(s => s.connected)

  const [tf, setTf] = useState<TF>(1)
  const [histBars, setHistBars] = useState<Bar[]>([])
  const [loadingHist, setLoading] = useState(false)
  const [, tick] = useState(0)   // countdown re-render

  // ── Auto-set timeframe when active market changes ─────────────────────────
  useEffect(() => {
    if (!activeMarketKey) return
    // Snap to 1m when market selection changes
    setTf(1)
  }, [activeMarketKey])

  // ── Fetch historical bars from backend when TF changes (for non-1m/tick) ───
  useEffect(() => {
    if (tf === 1 || tf === 'tick') {
      setHistBars([])   // use live store bars/ticks for 1m/tick
      return
    }
    setLoading(true)
    fetch(`/api/bars/${asset}?interval=${tf}`)
      .then(r => r.json())
      .then(data => {
        if (data.bars?.length) setHistBars(data.bars)
      })
      .catch(() => { })
      .finally(() => setLoading(false))
  }, [asset, tf])

  // When asset changes and we're on a non-1m/tick TF, re-fetch
  useEffect(() => {
    if (tf === 1 || tf === 'tick') return
    fetch(`/api/bars/${asset}?interval=${tf}`)
      .then(r => r.json())
      .then(data => { if (data.bars?.length) setHistBars(data.bars) })
      .catch(() => { })
  }, [asset])   // intentionally excludes tf

  // ── Countdown ticker ─────────────────────────────────────────────────────
  useEffect(() => {
    const id = setInterval(() => tick(n => n + 1), 1000)
    return () => clearInterval(id)
  }, [])

  // ── Derived market info ───────────────────────────────────────────────────
  const activeMarket = useMemo(
    () => markets.find(m => m.key === activeMarketKey && m.asset === asset) ?? null,
    [markets, activeMarketKey, asset],
  )
  const nextMarket = useMemo(() => {
    const now = Date.now()
    return markets
      .filter(m => m.asset === asset && m.expiry_ts > now && m.key !== activeMarketKey)
      .sort((a, b) => a.expiry_ts - b.expiry_ts)[0] ?? null
  }, [markets, asset, activeMarketKey])

  // ── Choose which bars to display ─────────────────────────────────────────
  const displayBars: Bar[] = tf === 1 ? liveBars : histBars

  const kcData = useMemo(() => calcKC(displayBars), [displayBars])

  // ── Init chart once ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return
    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: '#0f1629' },
        textColor: '#94a3b8',
      },
      grid: {
        vertLines: { color: '#1e2d4e', style: LineStyle.Dotted },
        horzLines: { color: '#1e2d4e', style: LineStyle.Dotted },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: '#1e2d4e', scaleMargins: { top: 0.05, bottom: 0.05 } },
      timeScale: { borderColor: '#1e2d4e', timeVisible: true },
      autoSize: true,
    })
    chartRef.current = chart

    const candle = chart.addSeries(CandlestickSeries, {
      upColor: '#00d4a4', downColor: '#ff4757',
      borderUpColor: '#00d4a4', borderDownColor: '#ff4757',
      wickUpColor: '#00d4a4', wickDownColor: '#ff4757',
    })
    candleRef.current = candle

    const tickSeries = chart.addSeries(LineSeries, {
      color: '#f97316',
      lineWidth: 2,
      crosshairMarkerVisible: true,
      lastValueVisible: true,
      priceLineVisible: false,
    })
    tickRef.current = tickSeries

    const upper = chart.addSeries(LineSeries, { color: '#3b82f680', lineWidth: 1, priceLineVisible: false, lastValueVisible: false })
    const mid = chart.addSeries(LineSeries, { color: '#60a5fa80', lineWidth: 1, lineStyle: LineStyle.Dashed, priceLineVisible: false, lastValueVisible: false })
    const lower = chart.addSeries(LineSeries, { color: '#3b82f680', lineWidth: 1, priceLineVisible: false, lastValueVisible: false })
    upperRef.current = upper
    midRef.current = mid
    lowerRef.current = lower

    return () => { chart.remove() }
  }, [])

  // ── Update candles + KC bands + Ticks atomically ─────────────────────────
  useEffect(() => {
    if (!candleRef.current || !tickRef.current) return
    const ts = tickRef.current

    if (tf === 'tick') {
      candleRef.current.applyOptions({ visible: false })
      upperRef.current.applyOptions({ visible: false })
      midRef.current.applyOptions({ visible: false })
      lowerRef.current.applyOptions({ visible: false })
      ts.applyOptions({ visible: true })

      if (liveTicks.length > 0) {
        ts.setData(liveTicks.map(t => ({
          time: Math.floor(t.timestamp / 1000) as any,
          value: t.price,
        })))
      }
      return
    }

    // Candle mode (1m, 5m etc)
    candleRef.current.applyOptions({ visible: true })
    upperRef.current.applyOptions({ visible: true })
    midRef.current.applyOptions({ visible: true })
    lowerRef.current.applyOptions({ visible: true })
    ts.applyOptions({ visible: false })

    if (displayBars.length === 0) return

    try {
      candleRef.current.setData(prepBars(displayBars))

      // ── Settlement Line ───────────────────────────────────────────────────
      if (activeMarket?.resolution_price && chartRef.current) {
        if (!chartRef.current._settleLine) {
          chartRef.current._settleLine = candleRef.current.createPriceLine({
            price: activeMarket.resolution_price,
            color: '#22d3ee',
            lineWidth: 2,
            lineStyle: LineStyle.Dashed,
            axisLabelVisible: true,
            title: 'SETTLE',
          })
        } else {
          chartRef.current._settleLine.applyOptions({
            price: activeMarket.resolution_price,
          })
        }
      } else if (chartRef.current?._settleLine) {
        candleRef.current.removePriceLine(chartRef.current._settleLine)
        delete chartRef.current._settleLine
      }

      if (kcData && upperRef.current) {
        const seenKC = new Map<number, any>()
        for (const d of kcData) {
          const t = d.time as number
          seenKC.set(t, d)
        }
        const dedup = Array.from(seenKC.values()).sort((a, b) => a.time - b.time)
        upperRef.current.setData(dedup.map(d => ({ time: d.time, value: d.upper })))
        midRef.current.setData(dedup.map(d => ({ time: d.time, value: d.mid })))
        lowerRef.current.setData(dedup.map(d => ({ time: d.time, value: d.lower })))
      }
    } catch (err) {
      console.warn('[Chart] setData skipped:', err)
    }
  }, [displayBars, kcData, liveTicks, tf])

  // ── Derived live freshness ───────────────────────────────────────────────
  const lastBarTs = liveBars.length > 0 ? liveBars[liveBars.length - 1].timestamp : 0
  const lastTickTs = liveTicks.length > 0 ? liveTicks[liveTicks.length - 1].timestamp : 0
  const lastActivityTs = Math.max(lastBarTs, lastTickTs)
  // Consider live if connected AND data arrived within last 8 seconds
  const isLive = connected && (Date.now() - lastActivityTs < 8000)

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full">
      <div className="panel-header">
        {/* Left: asset + TF buttons */}
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs font-semibold text-slate-300 shrink-0">{asset}</span>

          {/* Live indicator */}
          <span className={`live-badge${isLive ? '' : ' stale'}`}>
            <span className={`live-dot${isLive ? '' : ' stale'}`} />
            {isLive ? 'Live' : connected ? 'Stale' : 'Off'}
          </span>

          {/* Timeframe toggle */}
          <div className="flex gap-0.5 shrink-0">
            {TF_OPTIONS.map(({ value, label, desc }) => (
              <button
                key={value}
                onClick={() => setTf(value)}
                title={`${label} bars — ${desc} of history`}
                className={`px-1.5 py-0.5 rounded text-2xs font-mono font-semibold transition-colors ${tf === value
                  ? 'bg-accent/20 text-accent border border-accent/40'
                  : 'text-muted hover:text-slate-400 hover:bg-surface-hover'
                  }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Loading indicator when fetching historical bars */}
          {loadingHist && (
            <span className="text-2xs text-muted font-mono animate-pulse">loading…</span>
          )}

          {/* Active market question (truncated) */}
          {activeMarket && !loadingHist && (
            <span
              className="text-2xs font-mono text-slate-500 truncate hidden sm:block"
              title={activeMarket.question}
            >
              {activeMarket.question.length > 48
                ? activeMarket.question.slice(0, 48) + '…'
                : activeMarket.question}
            </span>
          )}
        </div>

        {/* Right: KC label + session countdowns */}
        <div className="flex items-center gap-2 shrink-0">
          {/* Active market countdown */}
          {activeMarket && (
            <div className="flex items-center gap-1">
              <span className="text-2xs text-muted font-mono">⏱</span>
              <span className={`text-2xs font-mono font-semibold ${activeMarket.expiry_ts - Date.now() < 60_000
                ? 'text-down'
                : activeMarket.expiry_ts - Date.now() < 300_000
                  ? 'text-warn'
                  : 'text-slate-400'
                }`}>
                {fmtCountdown(activeMarket.expiry_ts)}
              </span>
            </div>
          )}

          {/* "Next session on deck" */}
          {nextMarket && (
            <div className="flex items-center gap-1 border-l border-surface-border pl-2">
              <span className="text-2xs text-muted font-mono">Next</span>
              <span className="text-2xs font-mono text-slate-500">
                {nextMarket.timeframe}
              </span>
              <span className="text-2xs font-mono text-slate-600">
                {fmtCountdown(nextMarket.expiry_ts)}
              </span>
            </div>
          )}

          <span className="label">KC 20 / 2.5×ATR</span>
        </div>
      </div>
      <div ref={containerRef} className="flex-1" />
    </div>
  )
}
