"""
edgecopy.watcher — Polling mechanisms for master discovery and signal detection.
Includes:
  1. MasterWatcher (watches a single wallet for new trades).
  2. WatcherManager (orchestrates multiple watchers and leaderboard refreshes).
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional

from shared.polymarket_client import PolymarketClient
from shared.types import Direction, MasterTrader, Regime

logger = logging.getLogger(__name__)


@dataclass
class CopySignal:
    """Internal signal event detected from a master."""
    detected_at:        datetime
    master:             MasterTrader
    master_trade_id:    str
    market_id:          str
    asset:              str
    direction:          Direction
    entry_price:        float
    master_size_usd:    float
    regime:             Regime
    # Filled later by processor
    adjusted_size:      float = 0.0
    is_copy:            bool = False


class MasterWatcher:
    """polls a single master wallet for new activity."""

    def __init__(
        self,
        master: MasterTrader,
        client: PolymarketClient,
        output_queue: asyncio.Queue,
        poll_interval: int = 5,
    ) -> None:
        self.master = master
        self.client = client
        self.queue = output_queue
        self.poll_interval = poll_interval
        
        self.last_trade_id: Optional[str] = None
        self._running = False

    async def run(self) -> None:
        self._running = True
        logger.info("Watching master: %s (%s)", self.master.alias or "Unnamed", self.master.wallet_address[:8])
        
        while self._running:
            try:
                trades = await self.client.get_wallet_trades(self.master.wallet_address, limit=1)
                if not trades:
                    await asyncio.sleep(self.poll_interval)
                    continue
                
                newest = trades[0]
                trade_id = newest.get("id")
                
                # If it's a new trade and it's an entry...
                if trade_id != self.last_trade_id:
                    self.last_trade_id = trade_id
                    await self._emit_signal(newest)

            except Exception as exc:
                logger.error("Watcher error for %s: %s", self.master.wallet_address, exc)
                
            await asyncio.sleep(self.poll_interval)

    async def _emit_signal(self, trade: dict) -> None:
        """Convert raw trade dict to internal CopySignal."""
        # Note: direction mapping depends on outcome index in real Polymarket data
        direction = Direction.UP if trade.get("side") == "buy" else Direction.DOWN # simplified
        
        sig = CopySignal(
            detected_at=datetime.now(tz=timezone.utc),
            master=self.master,
            master_trade_id=trade.get("id", ""),
            market_id=trade.get("market", ""),
            asset="BTC", # Inferred from market mapping in real use
            direction=direction,
            entry_price=float(trade.get("price", 0)),
            master_size_usd=float(trade.get("size", 0)) * float(trade.get("price", 0)),
            regime=Regime.MEDIUM # Default, will be recalculated if features available
        )
        
        logger.info("Detected new trade from master %s: %s %s", 
                    self.master.wallet_address[:8], sig.direction.value, sig.asset)
        
        await self.queue.put(sig)


class WatcherManager:
    """Orchestrates multiple MasterWatchers and discovers new masters from leaderboard."""

    def __init__(
        self,
        client: PolymarketClient,
        output_queue: asyncio.Queue,
        poll_interval_secs: int = 5,
    ) -> None:
        self.client = client
        self.queue = output_queue
        self.poll_interval = poll_interval_secs
        self.watchers: dict[str, MasterWatcher] = {}
        self._running = False

    def stop(self) -> None:
        self._running = False
        for w in self.watchers.values():
            w._running = False

    async def run(self) -> None:
        self._running = True
        logger.info("Watcher Manager active")
        
        # Periodic leaderboard refresh
        refresh_task = asyncio.create_task(self._leaderboard_loop())
        
        try:
            while self._running:
                await asyncio.sleep(1)
        finally:
            refresh_task.cancel()

    async def _leaderboard_loop(self) -> None:
        """Periodically discovery top performers."""
        while self._running:
            try:
                # 1. Fetch top traders
                top_traders = await self.client.get_leaderboard(window_days=30, min_trades=20)
                
                # 2. Sync watchers
                for t in top_traders[:5]: # Take top 5
                    addr = t["wallet_address"]
                    if addr not in self.watchers:
                        master = MasterTrader(
                            wallet_address=addr,
                            alias=t.get("alias"),
                            source="leaderboard"
                        )
                        w = MasterWatcher(master, self.client, self.queue, self.poll_interval)
                        self.watchers[addr] = w
                        asyncio.create_task(w.run())
                        
            except Exception as exc:
                logger.error("Leaderboard refresh failed: %s", exc)
                
            await asyncio.sleep(3600)  # Refresh leaderboard every hour
