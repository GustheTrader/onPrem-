import { useState, useEffect, useRef } from 'react'
import toast from 'react-hot-toast'
import { useStore } from '../store'
import type { PolyBook, PolyBookLevel } from '../types'

const API     = '/api'
const POLL_MS = 4_000

// ── Price row with prominent horizontal gradient volume bar ───────────────────
//
//  Bids  → green gradient bar extends left → right
//  Asks  → red   gradient bar extends left → right
//  Both YES and NO columns use the same green=bid / red=ask convention.

interface BookRowProps {
  level: PolyBookLevel
  maxSz: number
  type:  'bid' | 'ask'
  side:  'yes' | 'no'
}

function BookRow({ level, maxSz, type, side }: BookRowProps) {
  const priceCents = Math.round(level.price * 100)
  const sz         = level.size >= 1000
    ? `${(level.size / 1000).toFixed(1)}k`
    : level.size.toFixed(0)

  const pct = Math.min((level.size / maxSz) * 100, 100)

  // Horizontal gradient bar — bids=green, asks=red, always from left
  const barGrad = type === 'bid'
    ? 'from-emerald-500/35 via-emerald-500/15 to-transparent'
    : 'from-red-500/35 via-red-500/15 to-transparent'

  // Price text: YES bids=green/asks=red; NO bids=red/asks=green (complementary)
  const priceColor = side === 'yes'
    ? (type === 'bid' ? 'text-emerald-400' : 'text-red-400')
    : (type === 'bid' ? 'text-red-400'     : 'text-emerald-400')

  return (
    <div className="relative flex justify-between items-center px-1.5 py-[3px] hover:bg-white/[0.03] transition-colors">
      {/* Horizontal volume bar */}
      <div
        className={`absolute inset-y-0 left-0 bg-gradient-to-r ${barGrad} transition-all duration-300`}
        style={{ width: `${pct}%` }}
      />
      <span className={`text-[9px] font-mono z-10 tabular-nums font-semibold ${priceColor}`}>
        {priceCents}¢
      </span>
      <span className="text-[9px] font-mono text-slate-500 z-10 tabular-nums">{sz}</span>
    </div>
  )
}

// ── Mid-price divider row ─────────────────────────────────────────────────────

function MidRow({ cents, side }: { cents: number | null; side: 'yes' | 'no' }) {
  const borderColor = side === 'yes' ? 'border-emerald-800/50' : 'border-red-800/50'
  const bgColor     = side === 'yes' ? 'bg-emerald-950/40'     : 'bg-red-950/40'
  return (
    <div className={`flex items-center justify-between px-1.5 py-0.5 border-y ${borderColor} ${bgColor}`}>
      <span className="text-[9px] font-mono font-bold text-slate-200 tabular-nums">
        {cents != null ? `${cents}¢` : '—'}
      </span>
      <span className="text-[8px] text-slate-500 font-mono">mid</span>
    </div>
  )
}

// ── Column direction button (pinned below each book) ─────────────────────────

interface DirBtnProps {
  side:      'yes' | 'no'
  active:    boolean
  onClick:   () => void
}

function DirBtn({ side, active, onClick }: DirBtnProps) {
  const label = side === 'yes' ? '▲ BUY YES' : '▼ BUY NO'
  return (
    <button
      onClick={onClick}
      className={`w-full py-1.5 text-[10px] font-bold tracking-wide transition-all border-t ${
        side === 'yes'
          ? active
            ? 'bg-gradient-to-b from-emerald-400 to-emerald-700 text-white border-emerald-600 shadow-md shadow-emerald-900/60'
            : 'bg-emerald-950/30 text-emerald-600 border-emerald-900/40 hover:bg-emerald-900/40 hover:text-emerald-400'
          : active
            ? 'bg-gradient-to-b from-red-500 to-red-800 text-white border-red-700 shadow-md shadow-red-900/60'
            : 'bg-red-950/30 text-red-600 border-red-900/40 hover:bg-red-900/40 hover:text-red-400'
      }`}
    >
      {label}
    </button>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function OrderBook() {
  const activeMarketKey = useStore(s => s.activeMarketKey)
  const markets         = useStore(s => s.markets)
  const polyBooks       = useStore(s => s.polyBooks)
  const market          = markets.find(m => m.key === activeMarketKey)

  const wsBook                     = activeMarketKey ? polyBooks[activeMarketKey] ?? null : null
  const [restBook, setRestBook]    = useState<PolyBook | null>(null)
  const [loading,  setLoading]     = useState(false)
  const [error,    setError]       = useState<string | null>(null)

  const [direction,  setDirection]  = useState<'UP' | 'DOWN'>('UP')
  const [limitPrice, setLimitPrice] = useState('')
  const [size,       setSize]       = useState('100')
  const [placing,    setPlacing]    = useState(false)

  const cancelRef = useRef(false)

  // ── REST fallback poll ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!activeMarketKey || (market && !market.live)) {
      setRestBook(null); setError(null); return
    }
    cancelRef.current = false
    setLoading(true)

    async function fetchBook() {
      try {
        const resp = await fetch(`${API}/poly/book/${activeMarketKey}`)
        if (cancelRef.current) return
        if (!resp.ok) {
          const err = await resp.json().catch(() => ({ detail: resp.statusText }))
          setError(err.detail ?? 'Failed to load book')
          setLoading(false); return
        }
        const data: PolyBook = await resp.json()
        if (!cancelRef.current) { setRestBook(data); setError(null); setLoading(false) }
      } catch {
        if (!cancelRef.current) { setError('Network error'); setLoading(false) }
      }
    }
    fetchBook()
    const id = setInterval(fetchBook, POLL_MS)
    return () => { cancelRef.current = true; clearInterval(id) }
  }, [activeMarketKey, market?.live])

  const book: PolyBook | null = wsBook ?? restBook

  // ── YES ladder ────────────────────────────────────────────────────────────
  const ROWS   = 5
  const yesAsks = (book?.asks ?? []).slice(0, ROWS).reverse()  // lowest ask at bottom
  const yesBids = (book?.bids ?? []).slice(0, ROWS)
  const maxSzY  = Math.max(...yesAsks.map(l => l.size), ...yesBids.map(l => l.size), 1)

  // ── NO ladder — complementary: noAsk ← yesBid inverted, noBid ← yesAsk inverted
  const noAsks = (book?.bids ?? [])
    .slice(0, ROWS)
    .map(b => ({ price: Math.round((1 - b.price) * 100) / 100, size: b.size }))
    .sort((a, b) => a.price - b.price)
    .reverse()

  const noBids = (book?.asks ?? [])
    .slice(0, ROWS)
    .map(a => ({ price: Math.round((1 - a.price) * 100) / 100, size: a.size }))
    .sort((a, b) => b.price - a.price)

  const maxSzN    = Math.max(...noAsks.map(l => l.size), ...noBids.map(l => l.size), 1)
  const yesMidCts = book ? Math.round(book.mid * 100)       : null
  const noMidCts  = book ? Math.round((1 - book.mid) * 100) : null

  const noBestBid = book?.best_ask != null ? Math.round((1 - book.best_ask) * 100) : null
  const noBestAsk = book?.best_bid != null ? Math.round((1 - book.best_bid) * 100) : null

  // ── Price conversion ──────────────────────────────────────────────────────
  //   UP   → user types YES ¢ → stored as YES decimal
  //   DOWN → user types NO ¢  → converted to YES decimal for backend
  const priceCentsInput = parseFloat(limitPrice)
  const effectivePrice  = !isNaN(priceCentsInput) && priceCentsInput > 0
    ? direction === 'UP'
      ? priceCentsInput / 100
      : (100 - priceCentsInput) / 100
    : null

  const displayCents = effectivePrice != null
    ? direction === 'UP'
      ? Math.round(effectivePrice * 100)
      : Math.round((1 - effectivePrice) * 100)
    : null

  // ── Place order ────────────────────────────────────────────────────────────
  async function placeOrder() {
    if (!effectivePrice || !book || placing) return
    setPlacing(true)
    try {
      const resp = await fetch(`${API}/order`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          asset:        market?.asset ?? 'BTC',
          direction,
          size:         parseFloat(size) || 100,
          price:        effectivePrice,
          partial_exit: true,
          token_id:     book.up_token_id,
        }),
      })
      const data = await resp.json()
      if (resp.ok) {
        toast.success(
          `${direction === 'UP' ? 'YES' : 'NO'} @ ${displayCents}¢ · $${size}`,
          { style: { background: '#0f1629', color: '#e2e8f0', border: '1px solid #1e2d4e' },
            iconTheme: { primary: '#00d4a4', secondary: '#0f1629' } },
        )
      } else {
        toast.error(data.error ?? 'Order failed', {
          style: { background: '#0f1629', color: '#ff4757', border: '1px solid #ff4757' },
        })
      }
    } catch {
      toast.error('Network error', {
        style: { background: '#0f1629', color: '#ff4757', border: '1px solid #ff4757' },
      })
    } finally {
      setPlacing(false) }
  }

  function selectDir(dir: 'UP' | 'DOWN') {
    setDirection(dir)
    setLimitPrice('')
  }

  // ── Empty / synthetic states ───────────────────────────────────────────────
  if (!activeMarketKey) {
    return (
      <div className="flex items-center justify-center h-full text-muted text-2xs font-mono px-4 text-center">
        Select a market from the Markets tab
      </div>
    )
  }

  if (market && !market.live) {
    return (
      <div className="flex flex-col h-full">
        <div className="panel-header shrink-0">
          <span className="text-xs font-semibold text-slate-300">
            Poly Book · {market.asset} {market.timeframe}
          </span>
          <span className="label text-yellow-400">SYN</span>
        </div>
        <div className="flex-1 flex items-center justify-center text-muted text-2xs font-mono px-4 text-center">
          Synthetic market — no real Polymarket order book
        </div>
      </div>
    )
  }

  // ── Main render ────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full overflow-y-auto">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="panel-header shrink-0">
        <span className="text-xs font-semibold text-slate-300 truncate max-w-[160px]" title={book?.question}>
          {book?.question ?? activeMarketKey}
        </span>
        <div className="flex items-center gap-1.5 shrink-0">
          {book?.spread_pct != null && (
            <span className="label">{book.spread_pct.toFixed(1)}¢ spd</span>
          )}
          {wsBook
            ? <span className="label text-green-400">WS ●</span>
            : loading && !book
              ? <span className="label text-yellow-400 animate-pulse">LOAD…</span>
              : <span className="label text-green-400">POLY</span>
          }
        </div>
      </div>

      {/* ── YES / NO probability bar ────────────────────────────────────────── */}
      {book && (
        <div className="shrink-0 px-2 py-1 border-b border-surface-border">
          <div className="flex justify-between text-[9px] font-mono mb-0.5">
            <span className="text-emerald-400 font-bold">YES {book.up_pct.toFixed(1)}%</span>
            <span className="text-slate-500">{activeMarketKey}</span>
            <span className="text-red-400 font-bold">NO {book.down_pct.toFixed(1)}%</span>
          </div>
          <div className="h-1.5 rounded-full overflow-hidden flex">
            <div
              className="h-full bg-gradient-to-r from-emerald-600 to-emerald-400 transition-all duration-500"
              style={{ width: `${book.up_pct}%` }}
            />
            <div
              className="h-full bg-gradient-to-r from-red-600 to-red-400 transition-all duration-500"
              style={{ width: `${book.down_pct}%` }}
            />
          </div>
        </div>
      )}

      {/* ── Dual depth ladders: YES (left) | NO (right) ─────────────────────── */}
      <div className="shrink-0 grid grid-cols-2 gap-px bg-surface-border">

        {/* ── YES column ─────────────────────────────────────────────────────── */}
        <div className="bg-surface flex flex-col">

          {/* Column header */}
          <div className="flex items-center justify-center py-0.5 bg-gradient-to-b from-emerald-900/50 to-emerald-950/30 border-b border-emerald-800/30">
            <span className="text-[9px] font-bold tracking-widest text-emerald-400 uppercase">▲ YES</span>
          </div>

          {/* Sub-header */}
          <div className="flex justify-between px-1.5 py-0.5 bg-surface-card border-b border-surface-border">
            <span className="text-[8px] text-slate-500 font-mono">Price</span>
            <span className="text-[8px] text-slate-500 font-mono">Vol</span>
          </div>

          {loading && !book && (
            <div className="py-2 text-center text-[9px] text-slate-500 font-mono animate-pulse">…</div>
          )}
          {error && !book && (
            <div className="py-2 px-1 text-center text-[9px] text-red-400 font-mono">{error}</div>
          )}

          {/* YES asks — red bars, lowest at bottom */}
          {yesAsks.map((a, i) => (
            <BookRow key={i} level={a} maxSz={maxSzY} type="ask" side="yes" />
          ))}

          {/* YES mid */}
          <MidRow cents={yesMidCts} side="yes" />

          {/* YES bids — green bars */}
          {yesBids.map((b, i) => (
            <BookRow key={i} level={b} maxSz={maxSzY} type="bid" side="yes" />
          ))}

          {/* YES best B/A */}
          <div className="px-1.5 py-0.5 border-t border-surface-border bg-surface-card/50 text-[8px] font-mono">
            <div className="text-emerald-500 tabular-nums">
              B {book?.best_bid != null ? `${Math.round(book.best_bid * 100)}¢` : '—'}
            </div>
            <div className="text-red-500 tabular-nums">
              A {book?.best_ask != null ? `${Math.round(book.best_ask * 100)}¢` : '—'}
            </div>
          </div>

          {/* ▲ BUY YES — pinned directly below YES book */}
          <DirBtn side="yes" active={direction === 'UP'} onClick={() => selectDir('UP')} />

        </div>

        {/* ── NO column ──────────────────────────────────────────────────────── */}
        <div className="bg-surface flex flex-col">

          {/* Column header */}
          <div className="flex items-center justify-center py-0.5 bg-gradient-to-b from-red-900/50 to-red-950/30 border-b border-red-800/30">
            <span className="text-[9px] font-bold tracking-widest text-red-400 uppercase">▼ NO</span>
          </div>

          {/* Sub-header */}
          <div className="flex justify-between px-1.5 py-0.5 bg-surface-card border-b border-surface-border">
            <span className="text-[8px] text-slate-500 font-mono">Price</span>
            <span className="text-[8px] text-slate-500 font-mono">Vol</span>
          </div>

          {/* NO asks — red bars, lowest at bottom */}
          {noAsks.map((a, i) => (
            <BookRow key={i} level={a} maxSz={maxSzN} type="ask" side="no" />
          ))}

          {/* NO mid */}
          <MidRow cents={noMidCts} side="no" />

          {/* NO bids — green bars */}
          {noBids.map((b, i) => (
            <BookRow key={i} level={b} maxSz={maxSzN} type="bid" side="no" />
          ))}

          {/* NO best B/A */}
          <div className="px-1.5 py-0.5 border-t border-surface-border bg-surface-card/50 text-[8px] font-mono">
            <div className="text-red-500 tabular-nums">
              B {noBestBid != null ? `${noBestBid}¢` : '—'}
            </div>
            <div className="text-emerald-500 tabular-nums">
              A {noBestAsk != null ? `${noBestAsk}¢` : '—'}
            </div>
          </div>

          {/* ▼ BUY NO — pinned directly below NO book */}
          <DirBtn side="no" active={direction === 'DOWN'} onClick={() => selectDir('DOWN')} />

        </div>
      </div>

      {/* ── Shared order form ─────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-1.5 p-2 border-t-2 border-accent/20 bg-surface-card/20 shrink-0">

        {/* Header: direction + LIMIT badge */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <span className={`text-[9px] font-bold tracking-wider uppercase ${
              direction === 'UP' ? 'text-emerald-400' : 'text-red-400'
            }`}>
              {direction === 'UP' ? '▲ YES' : '▼ NO'}
            </span>
            <span className="text-[8px] font-bold px-1 py-px rounded border tracking-widest uppercase
              bg-accent/10 text-accent border-accent/30">
              LIMIT
            </span>
          </div>
          <span className="text-[8px] text-slate-500 font-mono">Polymarket CLOB</span>
        </div>

        {/* Limit price input + join bid/ask quick-fills */}
        <div>
          <div className="label mb-0.5">
            {direction === 'UP' ? 'YES' : 'NO'} limit price (¢)
          </div>
          <input
            type="number"
            className="input-field"
            value={limitPrice}
            onChange={e => setLimitPrice(e.target.value)}
            min="1" max="99" step="1"
            placeholder={
              direction === 'UP'
                ? (book?.best_bid != null ? String(Math.round(book.best_bid * 100)) : '50')
                : (noBestBid != null ? String(noBestBid) : '50')
            }
          />

          {/* Limit quick-fills: join bid or join ask */}
          {book && (
            <div className="flex gap-1 mt-1">
              {direction === 'UP' ? (
                <>
                  {book.best_bid != null && (
                    <button
                      onClick={() => setLimitPrice(String(Math.round(book.best_bid! * 100)))}
                      className="flex-1 text-[9px] btn py-0.5 bg-emerald-900/30 text-emerald-400 border border-emerald-800/40 hover:bg-emerald-900/50"
                    >
                      Bid {Math.round(book.best_bid * 100)}¢
                    </button>
                  )}
                  {book.best_ask != null && (
                    <button
                      onClick={() => setLimitPrice(String(Math.round(book.best_ask! * 100)))}
                      className="flex-1 text-[9px] btn py-0.5 bg-red-900/30 text-red-400 border border-red-800/40 hover:bg-red-900/50"
                    >
                      Ask {Math.round(book.best_ask * 100)}¢
                    </button>
                  )}
                </>
              ) : (
                <>
                  {noBestBid != null && (
                    <button
                      onClick={() => setLimitPrice(String(noBestBid))}
                      className="flex-1 text-[9px] btn py-0.5 bg-red-900/30 text-red-400 border border-red-800/40 hover:bg-red-900/50"
                    >
                      Bid {noBestBid}¢
                    </button>
                  )}
                  {noBestAsk != null && (
                    <button
                      onClick={() => setLimitPrice(String(noBestAsk))}
                      className="flex-1 text-[9px] btn py-0.5 bg-emerald-900/30 text-emerald-400 border border-emerald-800/40 hover:bg-emerald-900/50"
                    >
                      Ask {noBestAsk}¢
                    </button>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {/* Size + 25 / 50 / 75 / 100% quick-sell presets */}
        <div>
          <div className="flex items-center justify-between mb-0.5">
            <span className="label">Size (USD)</span>
            <span className="text-[8px] text-slate-500 font-mono">quick sell %</span>
          </div>
          <input
            type="number"
            className="input-field mb-1"
            value={size}
            onChange={e => setSize(e.target.value)}
            min="10" max="500" step="5"
          />
          {/* 25 / 50 / 75 / 100% of $500 max */}
          <div className="grid grid-cols-4 gap-1">
            {([
              { label: '25%',  val: '125' },
              { label: '50%',  val: '250' },
              { label: '75%',  val: '375' },
              { label: '100%', val: '500' },
            ] as const).map(({ label, val }) => (
              <button
                key={val}
                onClick={() => setSize(val)}
                className={`text-[9px] rounded py-0.5 font-semibold transition-all border ${
                  size === val
                    ? direction === 'UP'
                      ? 'bg-emerald-800/50 text-emerald-300 border-emerald-700/60'
                      : 'bg-red-800/50 text-red-300 border-red-700/60'
                    : 'bg-surface-hover text-slate-400 border-surface-border hover:text-slate-200'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {/* Dollar hint row */}
          <div className="grid grid-cols-4 gap-1 mt-0.5">
            {['$125', '$250', '$375', '$500'].map(d => (
              <span key={d} className="text-[7px] text-slate-600 font-mono text-center tabular-nums">{d}</span>
            ))}
          </div>
        </div>

        {/* YES limit submit */}
        <button
          onClick={() => { if (direction !== 'UP') selectDir('UP'); else placeOrder() }}
          disabled={direction === 'UP' && (!effectivePrice || placing)}
          className={`w-full rounded py-1.5 text-[10px] font-bold tracking-wide transition-all
            disabled:opacity-40 disabled:cursor-not-allowed
            bg-gradient-to-b from-emerald-400 to-emerald-700 text-white
            shadow-md shadow-emerald-900/50 hover:from-emerald-300 hover:to-emerald-600 ${
            direction !== 'UP' ? 'opacity-50' : ''
          }`}
          title="Place LIMIT YES order"
        >
          {direction === 'UP'
            ? placing
              ? 'Placing…'
              : effectivePrice
                ? `LIMIT ▲ YES @ ${displayCents}¢ · $${size}`
                : 'LIMIT ▲ YES — set price above'
            : `▲ Switch to YES`}
        </button>

        {/* NO limit submit */}
        <button
          onClick={() => { if (direction !== 'DOWN') selectDir('DOWN'); else placeOrder() }}
          disabled={direction === 'DOWN' && (!effectivePrice || placing)}
          className={`w-full rounded py-1.5 text-[10px] font-bold tracking-wide transition-all
            disabled:opacity-40 disabled:cursor-not-allowed
            bg-gradient-to-b from-red-500 to-red-800 text-white
            shadow-md shadow-red-900/50 hover:from-red-400 hover:to-red-700 ${
            direction !== 'DOWN' ? 'opacity-50' : ''
          }`}
          title="Place LIMIT NO order"
        >
          {direction === 'DOWN'
            ? placing
              ? 'Placing…'
              : effectivePrice
                ? `LIMIT ▼ NO  @ ${displayCents}¢ · $${size}`
                : 'LIMIT ▼ NO — set price above'
            : `▼ Switch to NO`}
        </button>

      </div>
    </div>
  )
}
