import { create } from 'zustand'
import type {
  Asset, Bar, KeltnerBands, OrderBook, TradeTick, Signal,
  Position, Trade, DailyMetrics, CopyStatus, Regime,
  MarketInfo, ProbPoint, Settlement, PolyBook,
} from '../types'

interface TerminalState {
  // Asset selection
  activeAsset: Asset
  setActiveAsset: (a: Asset) => void

  // Market data
  bars: Record<Asset, Bar[]>
  bands: Record<Asset, KeltnerBands | null>
  orderBook: Record<Asset, OrderBook | null>
  ticks: Record<Asset, TradeTick[]>
  zscore: Record<Asset, number>
  regime: Record<Asset, Regime>

  // Signals
  signals: Record<Asset, Signal[]>

  // Positions & journal
  positions: Position[]
  trades: Trade[]

  // Metrics
  metrics: DailyMetrics | null

  // EdgeCopy
  copyStatus: CopyStatus | null

  // ── Polymarket live markets ──────────────────────────────────────────────
  markets: MarketInfo[]
  probHistory: Record<string, ProbPoint[]>   // key = "BTC_15min"
  activeMarketKey: string | null             // currently selected market card
  usingLiveData: boolean

  // ── Polymarket order books (WS-pushed every 3 s by _book_poller) ─────────
  polyBooks: Record<string, PolyBook>        // market_key → latest book

  // ── Settlement history ────────────────────────────────────────────────────
  settlements: Settlement[]                  // most-recent-first

  // Connection
  connected: boolean
  setConnected: (v: boolean) => void

  // ── Auto-rotation ────────────────────────────────────────────────────────
  autoRotate: boolean
  setAutoRotate: (v: boolean) => void

  // Updaters
  pushBar: (asset: Asset, bar: Bar) => void
  setBands: (asset: Asset, b: KeltnerBands) => void
  setBook: (asset: Asset, b: OrderBook) => void
  pushTick: (asset: Asset, t: TradeTick) => void
  setZscore: (asset: Asset, z: number, r: Regime) => void
  pushSignal: (s: Signal) => void
  setPositions: (p: Position[]) => void
  setMetrics: (m: DailyMetrics) => void
  setCopyStatus: (c: CopyStatus) => void
  loadSnapshot: (asset: Asset, data: any) => void

  // Market updaters
  setMarkets: (markets: MarketInfo[], live?: boolean) => void
  /** Select a market card — also syncs activeAsset to the market's asset. */
  setActiveMarketKey: (k: string | null) => void
  /** Merge externally-fetched probability history points (e.g. from /api/poly/prices-history). */
  mergeProbHistory: (key: string, points: ProbPoint[]) => void

  // PolyBook updater (WS push from _book_poller)
  setPolyBook: (key: string, book: PolyBook) => void

  // Settlement updaters
  /** Replace the full settlement list (from snapshot or API fetch). */
  setSettlements: (s: Settlement[]) => void
}

const ASSETS: Asset[] = ['BTC', 'ETH', 'SOL', 'XRP']
const initRecord = <T>(v: T) => Object.fromEntries(ASSETS.map(a => [a, v])) as Record<Asset, T>

export const useStore = create<TerminalState>((set, get) => ({
  activeAsset: 'BTC',
  setActiveAsset: (a) => set({ activeAsset: a, activeMarketKey: `${a}_5min` }),

  bars: initRecord<Bar[]>([]),
  bands: initRecord<KeltnerBands | null>(null),
  orderBook: initRecord<OrderBook | null>(null),
  ticks: initRecord<TradeTick[]>([]),
  zscore: initRecord<number>(0),
  regime: initRecord<Regime>('medium'),
  signals: initRecord<Signal[]>([]),

  positions: [],
  trades: [],
  metrics: null,
  copyStatus: null,
  connected: false,
  autoRotate: false,
  setAutoRotate: (v) => set({ autoRotate: v }),

  // Live market state
  markets: [],
  probHistory: {},
  activeMarketKey: 'BTC_5min',   // default: show BTC 5-min prob chart immediately
  usingLiveData: false,

  // Polymarket order books
  polyBooks: {},

  // Settlement history
  settlements: [],

  setConnected: (v) => set({ connected: v }),

  // Keep last 4 500 bars ≈ 3 days of 1-min history
  pushBar: (asset, bar) => set(s => {
    const prev = s.bars[asset]
    if (prev.length > 0 && prev[prev.length - 1].timestamp === bar.timestamp) {
      const updated = [...prev]
      updated[updated.length - 1] = bar
      return { bars: { ...s.bars, [asset]: updated } }
    }
    return { bars: { ...s.bars, [asset]: [...prev.slice(-4499), bar] } }
  }),

  setBands: (asset, b) => set(s => ({
    bands: { ...s.bands, [asset]: b }
  })),

  setBook: (asset, b) => set(s => ({
    orderBook: { ...s.orderBook, [asset]: b }
  })),

  pushTick: (asset, t) => set(s => ({
    ticks: { ...s.ticks, [asset]: [...s.ticks[asset].slice(-49), t] }
  })),

  setZscore: (asset, z, r) => set(s => ({
    zscore: { ...s.zscore, [asset]: z },
    regime: { ...s.regime, [asset]: r },
  })),

  pushSignal: (sig) => set(s => {
    const prev = s.signals[sig.asset as Asset] ?? []
    const filtered = prev.filter(x => x.model !== sig.model)
    return { signals: { ...s.signals, [sig.asset]: [...filtered, sig].slice(-8) } }
  }),

  setPositions: (p) => set({ positions: p }),
  setMetrics: (m) => set({ metrics: m }),
  setCopyStatus: (c) => set({ copyStatus: c }),

  // Merge incoming market array into local store, also update probHistory
  setMarkets: (incoming, live = false) => set(s => {
    const newProbHistory = { ...s.probHistory }
    const updatedMarkets: MarketInfo[] = incoming.map(m => {
      // Merge incoming prob_history into local store (keep last 4 320 pts ≈ 3 days at 1-min)
      if (m.prob_history && m.prob_history.length > 0) {
        const existing = s.probHistory[m.key] ?? []
        const merged = [...existing, ...m.prob_history]
          .filter((v, i, arr) => arr.findIndex(x => x.ts === v.ts) === i)
          .sort((a, b) => a.ts - b.ts)
          .slice(-4320)
        newProbHistory[m.key] = merged
      }
      const { prob_history: _ph, ...rest } = m
      return rest
    })
    const hasLive = live || incoming.some(m => m.live) || s.usingLiveData
    return {
      markets: updatedMarkets,
      probHistory: newProbHistory,
      usingLiveData: hasLive,
    }
  }),

  /**
   * Select a market card by key.
   * Also updates activeAsset so the main OHLCV chart auto-switches to
   * the selected market's underlying asset.
   */
  setActiveMarketKey: (k) => set(s => {
    if (!k) return { activeMarketKey: null }
    const market = s.markets.find(m => m.key === k)
    return {
      activeMarketKey: k,
      ...(market ? { activeAsset: market.asset as Asset } : {}),
    }
  }),

  setPolyBook: (key, book) => set(s => ({
    polyBooks: { ...s.polyBooks, [key]: book }
  })),

  setSettlements: (s) => set({ settlements: s }),

  /** Merge externally-fetched prob history (from /api/poly/prices-history backfill). */
  mergeProbHistory: (key, points) => set(s => {
    const existing = s.probHistory[key] ?? []
    const merged = [...points, ...existing]
      .filter((v, i, arr) => arr.findIndex(x => x.ts === v.ts) === i)
      .sort((a, b) => a.ts - b.ts)
      .slice(-4320)
    return { probHistory: { ...s.probHistory, [key]: merged } }
  }),

  loadSnapshot: (asset, data) => {
    const s = get()
    const newState: Partial<TerminalState> = {
      bars: { ...s.bars, [asset]: data.bars ?? [] },
      bands: { ...s.bands, [asset]: data.bands ?? null },
      zscore: { ...s.zscore, [asset]: data.zscore ?? 0 },
      regime: { ...s.regime, [asset]: data.regime ?? 'medium' },
      signals: { ...s.signals, [asset]: data.signals ?? [] },
      positions: data.positions ?? [],
      metrics: data.metrics ?? null,
      copyStatus: data.copy_status ?? null,
      polyBooks: { ...s.polyBooks, ...(data.poly_books ?? {}) },
    }
    if (data.markets) {
      // Inline setMarkets logic for snapshot
      const newProbHistory = { ...s.probHistory }
      const updatedMarkets: MarketInfo[] = (data.markets as MarketInfo[]).map(m => {
        if (m.prob_history && m.prob_history.length > 0) {
          const existing = s.probHistory[m.key] ?? []
          const merged = [...existing, ...m.prob_history]
            .filter((v, i, arr) => arr.findIndex(x => x.ts === v.ts) === i)
            .sort((a, b) => a.ts - b.ts)
            .slice(-4320)
          newProbHistory[m.key] = merged
        }
        const { prob_history: _ph, ...rest } = m as any
        current Markets: updatedMarkets,
        return rest
      })
      newState.markets = updatedMarkets
      newState.probHistory = newProbHistory
      if ((data.markets as MarketInfo[]).some(m => m.live)) {
        newState.usingLiveData = true
      }
    }
    set(newState as any)
  },
}))
