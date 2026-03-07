import { useEffect, useRef } from 'react'
import { useStore } from '../store'
import type { Asset, WsMsg } from '../types'

const WS_BASE = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`

export function useWebSocket(asset: Asset) {
  const wsRef = useRef<WebSocket | null>(null)
  const retryRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const { pushBar, setBands, setBook, pushTick, setZscore,
          pushSignal, setPositions, setMetrics, setCopyStatus,
          setMarkets, loadSnapshot, setConnected, setSettlements,
          setPolyBook } = useStore.getState()

  useEffect(() => {
    let alive = true

    function connect() {
      if (!alive) return
      const ws = new WebSocket(`${WS_BASE}/${asset}`)
      wsRef.current = ws

      ws.onopen = () => {
        setConnected(true)
      }

      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data)

          if (msg.type === 'snapshot') {
            loadSnapshot(msg.asset as Asset, msg)
            // Snapshot also carries recent settlements
            if (Array.isArray(msg.settlements) && msg.settlements.length > 0) {
              setSettlements(msg.settlements)
            }
            return
          }

          const m = msg as WsMsg
          switch (m.type) {
            case 'bar':         pushBar(m.asset, m.data); break
            case 'bands':       setBands(m.asset, m.data); break
            case 'book':        setBook(m.asset, m.data); break
            case 'tick':        pushTick(m.asset, m.data); break
            case 'zscore':      setZscore(m.asset, m.value, m.regime); break
            case 'signal':      pushSignal(m.data); break
            case 'position':    setPositions(m.data); break
            case 'metrics':     setMetrics(m.data); break
            case 'copy_status':  setCopyStatus(m.data); break
            case 'markets':      setMarkets(m.data); break
            case 'settlements':  setSettlements(m.data); break
            case 'poly_book':    setPolyBook(m.market_key, m.data); break
          }
        } catch {}
      }

      ws.onclose = () => {
        setConnected(false)
        if (alive) {
          retryRef.current = setTimeout(connect, 2000)
        }
      }

      ws.onerror = () => ws.close()
    }

    connect()

    return () => {
      alive = false
      clearTimeout(retryRef.current)
      wsRef.current?.close()
    }
  }, [asset])
}
