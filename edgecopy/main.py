"""
edgecopy.main — Entry point for the EdgeCopy bot.
Orchestrates the discovery of master traders, polling for new signals,
risk validation, and automated execution.
"""

from __future__ import annotations

import asyncio
import logging
import signal
import sys
from datetime import datetime, timezone

from edgecopy.alerter import Alerter
from edgecopy.config import load_config, get_polymarket_creds
from edgecopy.order_engine import OrderEngine
from edgecopy.reconciler import Reconciler
from edgecopy.signal_processor import SignalProcessor
from edgecopy.watcher import WatcherManager
from shared.journal import Journal
from shared.polymarket_client import PolymarketClient
from shared.risk_gate import RiskGate

# Load config globally for immediate access
cfg = load_config()

logger = logging.getLogger("EdgeCopy")


class EdgeCopyBot:
    """
    Main orchestrator for the automated copy trading bot.
    Manages the lifecycle of specialized workers:
      - Watchers (poll masters for new trades)
      - Processor (validates signals through RiskGate)
      - Engine (handles actual order execution and position tracking)
      - Reconciler (compares performance)
    """

    def __init__(self) -> None:
        self.stop_event = asyncio.Event()
        self.alerter = Alerter(log_level=cfg.logging.level)
        
        # 1. Initialize core infrastructure
        creds = get_polymarket_creds()
        self.client = PolymarketClient(
            **creds,
            dry_run=cfg.dry_run,
            chain_id=cfg.chain_id,
            slippage_guard_bps=cfg.risk.slippage_guard_bps
        )
        
        self.risk_gate = RiskGate(cfg.risk)
        self.journal = Journal(cfg.db_path)
        
        # 2. Setup communication queues
        # Watchers -> Processor
        self.signal_queue: asyncio.Queue = asyncio.Queue()
        # Processor -> Engine
        self.order_queue: asyncio.Queue = asyncio.Queue()

        # 3. Workers
        self.watcher_mgr = WatcherManager(
            client=self.client,
            output_queue=self.signal_queue,
            poll_interval_secs=cfg._raw.get("copy_trading", {}).get("master_poll_secs", 5)
        )
        
        self.processor = SignalProcessor(
            copy_cfg=cfg.copy,
            risk_gate=self.risk_gate,
            follower_balance=cfg.risk.initial_capital,
            input_queue=self.signal_queue,
            output_queue=self.order_queue,
            alerter=self.alerter
        )
        
        self.engine = OrderEngine(
            client=self.client,
            risk_gate=self.risk_gate,
            journal=self.journal,
            input_queue=self.order_queue,
            pe_cfg=cfg.partial_exit,
            alerter=self.alerter
        )

        self.reconciler = Reconciler(self.journal, self.alerter)

    async def start(self) -> None:
        """Launch all concurrent tasks."""
        await self.alerter.info(
            f"Starting EdgeCopy Bot | Mode: {'DRY_RUN' if cfg.dry_run else 'LIVE'} | Root: {sys.path[0]}"
        )
        
        await self.client.connect()
        
        # Run periodic tasks and queue consumers
        tasks = [
            asyncio.create_task(self.watcher_mgr.run()),
            asyncio.create_task(self.processor.run()),
            asyncio.create_task(self.engine.run()),
            asyncio.create_task(self.reconciler.run_periodic()),
            asyncio.create_task(self._monitor_health())
        ]
        
        try:
            # Wait for stop event (from signal handler)
            await self.stop_event.wait()
        finally:
            await self.shutdown(tasks)

    async def shutdown(self, tasks: list[asyncio.Task]) -> None:
        """Graceful shutdown of all workers."""
        await self.alerter.warning("Shutting down EdgeCopy bot...")
        
        self.watcher_mgr.stop()
        self.processor.stop()
        self.engine.stop()
        
        # Wait for consumers to finish processing queues (with timeout)
        try:
            await asyncio.wait_for(asyncio.gather(*tasks, return_exceptions=True), timeout=10)
        except asyncio.TimeoutError:
            logger.warning("Shutdown timed out, forcing exit.")
            
        await self.client.close()
        await self.alerter.info("Shutdown complete.")

    async def _monitor_health(self) -> None:
        """Periodic heartbeat and health check."""
        while not self.stop_event.is_set():
            # Check queue backpressure
            if self.signal_queue.qsize() > 50:
                await self.alerter.warning(f"Heavy signal backlog: {self.signal_queue.qsize()} pending")
            
            # Summarize metrics every hour
            if datetime.now(tz=timezone.utc).minute == 0 and datetime.now(tz=timezone.utc).second < 30:
                summary = self.risk_gate.summary()
                await self.alerter.info("Hourly Health Check", data=summary)
                
            await asyncio.sleep(30)


# ---------------------------------------------------------------------------
# Signal Handling
# ---------------------------------------------------------------------------

def _handle_signal(bot: EdgeCopyBot):
    logger.info("Interrupt received, triggering stop...")
    bot.stop_event.set()


async def main():
    bot = EdgeCopyBot()
    
    # Handle Ctrl+C
    loop = asyncio.get_running_loop()
    for s in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(s, lambda: _handle_signal(bot))
        except NotImplementedError:
            # Windows fallback
            pass

    try:
        await bot.start()
    except Exception as exc:
        logger.exception("Fatal error in bot main loop: %s", exc)
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
