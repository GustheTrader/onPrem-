import { useState, useEffect, useRef } from 'react'
import { Chart } from './Chart'
import { OrderBook } from './OrderBook'
import { SignalPanel } from './SignalPanel'
import { OrderPanel } from './OrderPanel'
import { PositionMonitor } from './PositionMonitor'
import { TradeJournal } from './TradeJournal'
import { Analytics } from './Analytics'
import { EdgeCopyPanel } from './EdgeCopyPanel'
import { RiskBar } from './RiskBar'
import { MarketNav } from './MarketNav'
import { ProbChart } from './ProbChart'
import { PolyPriceChart } from './PolyPriceChart'
import { SettlementsPage } from './SettlementsPage'
import { useStore } from '../store'
import type { Asset } from '../types'

const ASSETS: Asset[] = ['BTC', 'ETH', 'SOL', 'XRP']

type LeftTab = 'markets' | 'signals'
type RightTab = 'orders' | 'book' | 'positions' | 'analytics' | 'edgecopy'
type View = 'terminal' | 'journal' | 'settlements'

export function Layout() {
  const activeAsset = useStore(s => s.activeAsset)
  const setActiveAsset = useStore(s => s.setActiveAsset)
  const [leftTab, setLeftTab] = useState<LeftTab>('markets')
  const [rightTab, setRightTab] = useState<RightTab>('book')
  const [view, setView] = useState<View>('terminal')

  // Resizable center dividers — ref-based drag (no re-render on mousedown)
  const [bottomH, setBottomH] = useState(192)
  const [midH, setMidH] = useState(160)
  const dragRef = useRef<{ type: 'bottom' | 'mid'; startY: number; startH: number } | null>(null)

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const d = dragRef.current
      if (!d) return
      if (d.type === 'bottom') {
        const delta = d.startY - e.clientY   // drag up → taller bottom panel
        setBottomH(Math.min(Math.max(d.startH + delta, 100), 620))
      } else {
        const delta = d.startY - e.clientY   // drag up → taller mid chart (same direction as bottom)
        setMidH(Math.min(Math.max(d.startH + delta, 80), 420))
      }
    }
    const onUp = () => {
      dragRef.current = null
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
  }, [])

  const rightTabs: { id: RightTab; label: string }[] = [
    { id: 'book', label: 'Book' },
    { id: 'orders', label: 'Orders' },
    { id: 'positions', label: 'Pos.' },
    { id: 'analytics', label: 'Stats' },
    { id: 'edgecopy', label: 'Copy' },
  ]

  return (
    <div className="flex flex-col h-screen bg-surface text-slate-200 overflow-hidden">
      {/* Top bar */}
      <header className="flex items-center justify-between px-3 py-1.5 bg-surface-panel border-b border-surface-border shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-xs font-bold text-accent tracking-widest uppercase">
            Polymarket Terminal
          </span>
          <div className="h-3 w-px bg-surface-border" />
          {/* View nav */}
          <div className="flex gap-0.5">
            {([
              { id: 'terminal', label: 'Terminal' },
              { id: 'journal', label: 'Journal' },
              { id: 'settlements', label: 'Settlements' },
            ] as { id: View; label: string }[]).map(v => (
              <button
                key={v.id}
                onClick={() => setView(v.id)}
                className={`px-2.5 py-0.5 rounded text-xs font-semibold transition-colors ${view === v.id
                    ? 'bg-accent/20 text-accent border border-accent/40'
                    : 'text-muted hover:text-slate-300 hover:bg-surface-hover'
                  }`}
              >
                {v.label}
              </button>
            ))}
          </div>
          {view === 'terminal' && (
            <>
              <div className="h-3 w-px bg-surface-border" />
              {/* Asset tabs */}
              <div className="flex gap-1 items-center">
                {ASSETS.map(a => (
                  <button
                    key={a}
                    onClick={() => setActiveAsset(a)}
                    className={`px-2.5 py-0.5 rounded text-xs font-mono font-semibold transition-colors ${activeAsset === a
                        ? 'bg-accent/20 text-accent border border-accent/40'
                        : 'text-muted hover:text-slate-300 hover:bg-surface-hover'
                      }`}
                  >
                    {a}
                  </button>
                ))}

                <div className="h-3 w-px bg-surface-border mx-1" />

                <button
                  onClick={() => useStore.getState().setAutoRotate(!useStore.getState().autoRotate)}
                  className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-tighter transition-all border ${useStore(s => s.autoRotate)
                      ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40'
                      : 'bg-surface-hover text-muted border-surface-border'
                    }`}
                  title="Auto-rotate through assets every 15s"
                >
                  Rotate {useStore(s => s.autoRotate) ? 'ON' : 'OFF'}
                </button>
              </div>
            </>
          )}
          {view === 'settlements' && (
            <>
              <div className="h-3 w-px bg-surface-border" />
              <span className="text-2xs font-mono text-muted">Market rotation log</span>
            </>
          )}
        </div>
        <RiskBar />
      </header>

      {/* Journal subpage */}
      {view === 'journal' && (
        <div className="flex-1 min-h-0 overflow-hidden">
          <TradeJournal />
        </div>
      )}

      {/* Settlements subpage */}
      {view === 'settlements' && (
        <div className="flex-1 min-h-0 overflow-hidden">
          <SettlementsPage />
        </div>
      )}

      {/* Main terminal content */}
      <div className={`flex flex-1 min-h-0 gap-0 ${view !== 'terminal' ? 'hidden' : ''}`}>

        {/* LEFT — Tabbed: Markets | Signals */}
        <aside className="w-52 shrink-0 border-r border-surface-border flex flex-col bg-surface-panel overflow-hidden">
          {/* Left tab bar */}
          <div className="flex shrink-0 border-b border-surface-border">
            {(['markets', 'signals'] as LeftTab[]).map(t => (
              <button
                key={t}
                onClick={() => setLeftTab(t)}
                className={`flex-1 py-1 text-2xs font-semibold capitalize transition-colors border-b-2 ${leftTab === t
                    ? 'text-accent border-accent'
                    : 'text-muted border-transparent hover:text-slate-400'
                  }`}
              >
                {t === 'markets' ? 'Markets' : 'Signals'}
              </button>
            ))}
          </div>

          {/* Left tab content */}
          <div className="flex-1 min-h-0 overflow-hidden">
            {leftTab === 'markets' && <MarketNav />}
            {leftTab === 'signals' && (
              <div className="h-full overflow-y-auto">
                <SignalPanel asset={activeAsset} />
              </div>
            )}
          </div>
        </aside>

        {/* CENTER — Chart + PolyPriceChart + drag + tabbed bottom */}
        <main className="flex-1 min-w-0 flex flex-col">
          {/* Top — OHLCV chart fills remaining height */}
          <div className="flex-1 min-h-0">
            <Chart asset={activeAsset} />
          </div>

          {/* ── Drag handle: top chart ↔ poly price chart ────────────── */}
          <div
            onMouseDown={e => {
              e.preventDefault()
              dragRef.current = { type: 'mid', startY: e.clientY, startH: midH }
              document.body.style.cursor = 'row-resize'
              document.body.style.userSelect = 'none'
            }}
            className="group h-2.5 shrink-0 select-none cursor-row-resize flex items-center justify-center bg-surface-border hover:bg-accent/25 active:bg-accent/40 transition-colors"
          >
            <div className="flex gap-1 opacity-50 group-hover:opacity-100 transition-opacity pointer-events-none">
              {[0, 1, 2, 3, 4].map(i => (
                <span key={i} className="block w-1 h-px bg-slate-400 rounded-full" />
              ))}
            </div>
          </div>

          {/* Middle — Polymarket streaming price chart */}
          <div
            style={{ height: midH }}
            className="shrink-0 border-t border-surface-border overflow-hidden"
          >
            <PolyPriceChart />
          </div>

          {/* ── Drag handle: poly price chart ↔ bottom panel ─────────── */}
          <div
            onMouseDown={e => {
              e.preventDefault()
              dragRef.current = { type: 'bottom', startY: e.clientY, startH: bottomH }
              document.body.style.cursor = 'row-resize'
              document.body.style.userSelect = 'none'
            }}
            className="group h-2.5 shrink-0 select-none cursor-row-resize flex items-center justify-center bg-surface-border hover:bg-accent/25 active:bg-accent/40 transition-colors"
          >
            <div className="flex gap-1 opacity-50 group-hover:opacity-100 transition-opacity pointer-events-none">
              {[0, 1, 2, 3, 4].map(i => (
                <span key={i} className="block w-1 h-px bg-slate-400 rounded-full" />
              ))}
            </div>
          </div>

          {/* Bottom center — % Probability chart */}
          <div style={{ height: bottomH }} className="shrink-0 flex flex-col border-t border-surface-border overflow-hidden">
            <ProbChart />
          </div>
        </main>

        {/* RIGHT — Tabbed panel */}
        <aside className="w-72 shrink-0 border-l border-surface-border flex flex-col bg-surface-panel">
          {/* Tab bar */}
          <div className="flex border-b border-surface-border shrink-0">
            {rightTabs.map(t => (
              <button
                key={t.id}
                onClick={() => setRightTab(t.id)}
                className={`flex-1 py-1 text-2xs font-semibold transition-colors border-b-2 ${rightTab === t.id
                    ? 'text-accent border-accent'
                    : 'text-muted border-transparent hover:text-slate-400'
                  }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div className="flex-1 min-h-0 overflow-hidden">
            {rightTab === 'orders' && <OrderPanel asset={activeAsset} />}
            {rightTab === 'book' && <OrderBook />}
            {rightTab === 'positions' && <PositionMonitor />}
            {rightTab === 'analytics' && <Analytics />}
            {rightTab === 'edgecopy' && <EdgeCopyPanel />}
          </div>
        </aside>
      </div>

    </div>
  )
}
