import { useEffect } from 'react'
import { Toaster } from 'react-hot-toast'
import { Layout } from './components/Layout'
import { ErrorBoundary } from './components/ErrorBoundary'
import { useWebSocket } from './hooks/useWebSocket'
import { useStore } from './store'

const ASSETS = ['BTC', 'ETH', 'SOL', 'XRP'] as const

function AssetConnector() {
  const asset = useStore(s => s.activeAsset)
  useWebSocket(asset)
  return null
}

function MarketRotator() {
  const { autoRotate, activeAsset, setActiveAsset } = useStore()

  useEffect(() => {
    if (!autoRotate) return

    const id = setInterval(() => {
      const idx = ASSETS.indexOf(activeAsset as any)
      const nextIdx = (idx + 1) % ASSETS.length
      setActiveAsset(ASSETS[nextIdx])
    }, 15000) // 15s rotation

    return () => clearInterval(id)
  }, [autoRotate, activeAsset, setActiveAsset])

  return null
}

export default function App() {
  return (
    <ErrorBoundary>
      <AssetConnector />
      <MarketRotator />
      <Layout />
      <Toaster
        position="bottom-right"
        toastOptions={{
          style: {
            background: '#0f1629',
            color: '#e2e8f0',
            border: '1px solid #1e2d4e',
            fontSize: '12px',
            fontFamily: 'JetBrains Mono, monospace',
          },
        }}
      />
    </ErrorBoundary>
  )
}
