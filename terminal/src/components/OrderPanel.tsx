import { useState } from 'react'
import toast from 'react-hot-toast'
import { useStore } from '../store'
import type { Asset } from '../types'

interface Props { asset: Asset }

const API = '/api'

export function OrderPanel({ asset }: Props) {
  const [direction, setDirection] = useState<'UP' | 'DOWN'>('UP')
  const [size, setSize] = useState('100')
  const [partialExit, setPartialExit] = useState(true)
  const [placing, setPlacing] = useState(false)

  const book    = useStore(s => s.orderBook[asset])
  const metrics = useStore(s => s.metrics)

  const price = direction === 'UP' ? book?.best_ask : book?.best_bid
  const priceDisplay = price?.toFixed(4) ?? '—'

  const blocked = metrics?.at_trade_limit || metrics?.at_loss_limit || (metrics?.concurrent_positions ?? 0) >= 3

  async function placeOrder() {
    if (!price || blocked) return
    setPlacing(true)
    try {
      const resp = await fetch(`${API}/order`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          asset,
          direction,
          size: parseFloat(size) || 100,
          price,
          partial_exit: partialExit,
        }),
      })
      const data = await resp.json()
      if (resp.ok) {
        toast.success(`Order placed: ${asset} ${direction} $${size}`, {
          style: { background: '#0f1629', color: '#e2e8f0', border: '1px solid #1e2d4e' },
          iconTheme: { primary: '#00d4a4', secondary: '#0f1629' },
        })
      } else {
        toast.error(data.error ?? 'Order failed', {
          style: { background: '#0f1629', color: '#ff4757', border: '1px solid #ff4757' },
        })
      }
    } catch {
      toast.error('Network error', { style: { background: '#0f1629', color: '#ff4757', border: '1px solid #ff4757' } })
    } finally {
      setPlacing(false)
    }
  }

  async function cancelAll() {
    const positions = useStore.getState().positions.filter(p => p.asset === asset)
    await Promise.all(
      positions.map(p =>
        fetch(`${API}/order/${p.position_id}`, { method: 'DELETE' })
      )
    )
    toast('All orders cancelled', { style: { background: '#0f1629', color: '#e2e8f0', border: '1px solid #1e2d4e' } })
  }

  return (
    <div className="flex flex-col h-full">
      <div className="panel-header">
        <span className="text-xs font-semibold text-slate-300">Order Panel</span>
        <span className="label">{asset}</span>
      </div>

      <div className="p-3 flex flex-col gap-3 flex-1">
        {/* Direction */}
        <div>
          <div className="label mb-1.5">Direction</div>
          <div className="grid grid-cols-2 gap-2">
            <button
              className={`btn py-2 text-sm font-bold ${direction === 'UP' ? 'btn-up ring-1 ring-up/60' : 'btn-neutral'}`}
              onClick={() => setDirection('UP')}
            >
              ▲ UP
            </button>
            <button
              className={`btn py-2 text-sm font-bold ${direction === 'DOWN' ? 'btn-down ring-1 ring-down/60' : 'btn-neutral'}`}
              onClick={() => setDirection('DOWN')}
            >
              ▼ DOWN
            </button>
          </div>
        </div>

        {/* Size */}
        <div>
          <div className="label mb-1.5">Size (USD)</div>
          <input
            type="number"
            className="input-field"
            value={size}
            onChange={e => setSize(e.target.value)}
            min="10" max="500" step="10"
            placeholder="100"
          />
          <div className="flex gap-1 mt-1.5">
            {['50', '100', '250', '500'].map(s => (
              <button key={s} onClick={() => setSize(s)}
                className="flex-1 text-2xs btn btn-neutral py-1">
                ${s}
              </button>
            ))}
          </div>
        </div>

        {/* Entry price display */}
        <div className="bg-surface-card rounded p-2 border border-surface-border">
          <div className="label mb-1">Entry Price</div>
          <span className="val text-lg">{priceDisplay}</span>
          {book && (
            <div className="mt-1 text-2xs text-muted font-mono">
              Spread: {book.spread_bps?.toFixed(1)} bps
            </div>
          )}
        </div>

        {/* Partial exit toggle */}
        <label className="flex items-center justify-between cursor-pointer">
          <div>
            <div className="text-xs text-slate-300 font-medium">Partial Exit</div>
            <div className="text-2xs text-muted">Sell 50% at 2× entry</div>
          </div>
          <div
            onClick={() => setPartialExit(!partialExit)}
            className={`w-10 h-5 rounded-full transition-colors relative ${
              partialExit ? 'bg-up/80' : 'bg-surface-card border border-surface-border'
            }`}
          >
            <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
              partialExit ? 'translate-x-5' : 'translate-x-0.5'
            }`} />
          </div>
        </label>

        {/* Risk warning */}
        {blocked && (
          <div className="bg-down/10 border border-down/30 rounded p-2 text-2xs text-down font-mono">
            {metrics?.at_trade_limit && '⛔ Daily trade limit reached'}
            {metrics?.at_loss_limit && '⛔ Daily loss limit hit'}
            {!metrics?.at_trade_limit && !metrics?.at_loss_limit && '⛔ Max positions open'}
          </div>
        )}

        {/* Place order */}
        <button
          className={`btn py-2.5 text-sm font-bold mt-auto ${
            direction === 'UP' ? 'btn-up' : 'btn-down'
          }`}
          onClick={placeOrder}
          disabled={placing || blocked || !price}
        >
          {placing ? 'Placing...' : `Place ${direction} Order`}
        </button>

        <button className="btn-danger btn text-xs" onClick={cancelAll}>
          Cancel All {asset} Orders
        </button>
      </div>
    </div>
  )
}
