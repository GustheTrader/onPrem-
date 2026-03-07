// types.ts — TypeScript equivalents of shared/types.py

export type Direction = 'UP' | 'DOWN'
export type Regime = 'low' | 'medium' | 'high'
export type ModelName = 'kc_reversion' | 'flow_toxicity' | 'low_vol_accum' | 'high_vol_momentum'
export type OrderStatus = 'pending' | 'open' | 'filled' | 'cancelled' | 'rejected'
export type Asset = 'BTC' | 'ETH' | 'SOL' | 'XRP'
export type TimeFrame = '5min' | '15min' | '1h' | '4h'

export interface Bar {
  timestamp: number   // unix ms
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export interface KeltnerBands {
  upper: number
  mid: number
  lower: number
}

export interface OrderBookLevel { price: number; size: number }
export interface OrderBook {
  market_id: string
  bids: OrderBookLevel[]
  asks: OrderBookLevel[]
  best_bid?: number
  best_ask?: number
  mid?: number
  spread_bps?: number
}

export interface TradeTick {
  timestamp: number
  price: number
  size: number
  side: 'buy' | 'sell'
}

export interface Signal {
  timestamp: number
  asset: Asset
  model: ModelName
  direction: Direction
  strength: number    // 0–3
  regime: Regime
  zscore: number
  ofi: number
  vpin: number
}

export interface Position {
  position_id: string
  asset: Asset
  direction: Direction
  entry_price: number
  size: number
  entry_time: number
  expiry_secs: number   // seconds until expiry
  unrealized_pnl: number
  current_price: number
  partial_exit_done: boolean
  is_copy: boolean
  master_wallet?: string
}

export interface Trade {
  trade_id: string
  asset: Asset
  direction: Direction
  model?: ModelName
  regime: Regime
  entry_time: number
  exit_time: number
  entry_price: number
  exit_price: number
  size: number
  net_pnl: number
  fees: number
  win: boolean
  signal_strength: number
  is_copy: boolean
}

export interface DailyMetrics {
  date: string
  trade_count: number
  win_count: number
  win_rate: number
  net_pnl: number
  sharpe: number
  max_drawdown: number
  trades_remaining: number
  concurrent_positions: number
  at_trade_limit: boolean
  at_loss_limit: boolean
}

export interface ModelStats {
  model: ModelName
  trade_count: number
  win_rate: number
  profit_factor: number
  total_pnl: number
}

export interface MasterInfo {
  wallet_address: string
  alias?: string
  source: 'leaderboard' | 'manual'
  win_rate: number
  sharpe: number
  trade_count: number
  paused: boolean
}

export interface CopyStatus {
  enabled: boolean
  active_masters: MasterInfo[]
  copy_trades_today: number
  copy_pnl_today: number
}

// ── Polymarket market data ───────────────────────────────────────────────────

export interface ProbPoint {
  ts: number       // unix ms
  up_pct: number   // 0–100
}

/** The next-up ("on deck") market for a given slot */
export interface StagedMarket {
  question: string
  expiry_ts: number
  up_pct: number
  down_pct: number
  up_token_id?: string
  condition_id?: string
  live: boolean
}

export interface MarketInfo {
  key: string              // "BTC_15min"
  asset: Asset
  timeframe: TimeFrame
  question: string
  up_pct: number           // 0–100
  down_pct: number         // 0–100
  volume: number           // USD
  expiry_ts: number        // unix ms
  resolution_price?: number
  condition_id?: string
  up_token_id?: string
  live: boolean            // true = real Polymarket data, false = synthetic
  last_update_ms?: number  // unix ms of most recent price update
  prob_history?: ProbPoint[]
  staged_market?: StagedMarket | null   // next market on deck for this slot
}

// ── Polymarket YES/NO order book ─────────────────────────────────────────────

export interface PolyBookLevel {
  price: number   // probability 0.01–0.99 (e.g. 0.52 = 52¢ = 52% chance YES)
  size:  number   // shares (1 share pays $1 if outcome is YES)
}

export interface PolyBook {
  market_key:   string
  question:     string
  up_token_id:  string
  bids:         PolyBookLevel[]   // YES bids, sorted descending (highest first)
  asks:         PolyBookLevel[]   // YES asks, sorted ascending  (lowest first)
  best_bid:     number | null
  best_ask:     number | null
  mid:          number            // midpoint probability (0–1)
  spread_pct:   number | null     // spread in percentage points
  up_pct:       number            // 0–100
  down_pct:     number            // 0–100
  expiry_ts:    number
  live:         boolean
  timestamp_ms: number
}

// ── Settlement history ───────────────────────────────────────────────────────

/** A single settled market record, written when a market expires and rotates. */
export interface Settlement {
  settled_at:     number        // unix ms when recorded
  key:            string        // "BTC_15min"
  asset:          Asset
  timeframe:      TimeFrame
  question:       string
  final_up_pct:   number        // 0–100
  final_down_pct: number        // 0–100
  outcome:        'UP' | 'DOWN' // final resolution direction
  volume:         number        // USD
  expiry_ts:      number        // unix ms
  condition_id:   string
  live:           boolean       // true = real Polymarket data
}

// WebSocket message envelope
export type WsMsg =
  | { type: 'bar';         asset: Asset; data: Bar }
  | { type: 'bands';       asset: Asset; data: KeltnerBands }
  | { type: 'book';        asset: Asset; data: OrderBook }
  | { type: 'tick';        asset: Asset; data: TradeTick }
  | { type: 'signal';      data: Signal }
  | { type: 'position';    data: Position[] }
  | { type: 'metrics';     data: DailyMetrics }
  | { type: 'zscore';      asset: Asset; value: number; regime: Regime }
  | { type: 'copy_status'; data: CopyStatus }
  | { type: 'markets';     data: MarketInfo[] }
  | { type: 'settlements'; data: Settlement[] }
  | { type: 'poly_book';   market_key: string; data: PolyBook }

export const MODEL_LABELS: Record<ModelName, string> = {
  kc_reversion: 'KC Reversion',
  flow_toxicity: 'Flow Toxicity',
  low_vol_accum: 'Low Vol Accum',
  high_vol_momentum: 'HV Momentum',
}

export const MODEL_COLORS: Record<ModelName, string> = {
  kc_reversion: '#3b82f6',
  flow_toxicity: '#a855f7',
  low_vol_accum: '#22c55e',
  high_vol_momentum: '#f59e0b',
}

export const TIMEFRAME_LABELS: Record<TimeFrame, string> = {
  '5min':  '5-Minute',    // markets expiring ≤ 20 min
  '15min': '15-Minute',   // markets expiring ≤ 75 min
  '1h':    '1-Hour',      // markets expiring ≤ 6 h
  '4h':    '4-Hour',      // markets expiring > 6 h
}
