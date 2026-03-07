import { useState, useEffect } from 'react'
import type { Trade } from '../types'
import { MODEL_LABELS } from '../types'

const API = '/api'

export function TradeJournal() {
  const [trades, setTrades] = useState<Trade[]>([])
  const [filter, setFilter] = useState<{ asset: string; type: string }>({ asset: 'ALL', type: 'ALL' })

  useEffect(() => {
    const load = async () => {
      try {
        const r = await fetch(`${API}/journal?limit=200`)
        const d = await r.json()
        setTrades(d.trades ?? [])
      } catch {}
    }
    load()
    const t = setInterval(load, 5000)
    return () => clearInterval(t)
  }, [])

  const filtered = trades.filter(t => {
    if (filter.asset !== 'ALL' && t.asset !== filter.asset) return false
    if (filter.type === 'COPY' && !t.is_copy) return false
    if (filter.type === 'MANUAL' && t.is_copy) return false
    return true
  })

  const wins  = filtered.filter(t => t.win).length
  const total = filtered.length
  const pnl   = filtered.reduce((s, t) => s + t.net_pnl, 0)
  const wr    = total ? (wins / total * 100).toFixed(1) : '—'

  return (
    <div className="flex flex-col h-full">
      <div className="panel-header flex-wrap gap-2">
        <span className="text-xs font-semibold text-slate-300">Trade Journal</span>
        <div className="flex items-center gap-3 ml-auto">
          {/* Summary pills */}
          <span className="label">{total} trades</span>
          <span className="label">{wr}% WR</span>
          <span className={`text-xs font-mono font-semibold ${pnl >= 0 ? 'text-up' : 'text-down'}`}>
            {pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}
          </span>

          {/* Filters */}
          <select
            value={filter.asset}
            onChange={e => setFilter(f => ({ ...f, asset: e.target.value }))}
            className="input-field w-20 py-0.5"
          >
            {['ALL', 'BTC', 'ETH', 'SOL', 'XRP'].map(a => <option key={a}>{a}</option>)}
          </select>
          <select
            value={filter.type}
            onChange={e => setFilter(f => ({ ...f, type: e.target.value }))}
            className="input-field w-24 py-0.5"
          >
            {['ALL', 'COPY', 'MANUAL'].map(t => <option key={t}>{t}</option>)}
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {filtered.length === 0 ? (
          <div className="flex items-center justify-center h-full text-muted text-xs font-mono">
            No trades yet — place your first order
          </div>
        ) : (
          <table className="w-full text-left border-collapse">
            <thead className="sticky top-0 bg-surface-panel z-10">
              <tr>
                {['Time', 'Asset', 'Dir', 'Model', 'Entry', 'Exit', 'Size', 'Net P&L', 'Fees', 'W/L'].map(h => (
                  <th key={h} className="th">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((t, i) => (
                <tr key={i} className="table-row">
                  <td className="td">{new Date(t.entry_time).toLocaleTimeString()}</td>
                  <td className="td font-semibold">{t.asset}</td>
                  <td className="td">
                    <span className={`tag ${t.direction === 'UP' ? 'tag-up' : 'tag-down'}`}>{t.direction}</span>
                  </td>
                  <td className="td text-muted">{t.model ? MODEL_LABELS[t.model].split(' ').slice(0, 2).join(' ') : '—'}</td>
                  <td className="td">{t.entry_price.toFixed(4)}</td>
                  <td className="td">{t.exit_price.toFixed(4)}</td>
                  <td className="td">${t.size.toFixed(0)}</td>
                  <td className={`td font-semibold ${t.net_pnl >= 0 ? 'text-up' : 'text-down'}`}>
                    {t.net_pnl >= 0 ? '+' : ''}${t.net_pnl.toFixed(2)}
                  </td>
                  <td className="td text-muted">${t.fees.toFixed(2)}</td>
                  <td className="td">
                    <span className={`tag ${t.win ? 'tag-up' : 'tag-down'}`}>{t.win ? 'W' : 'L'}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
