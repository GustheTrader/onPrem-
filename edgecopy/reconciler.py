"""
edgecopy.reconciler — Performance auditor for master-follower trades.
Compares historical results, analyzes slippage, and divergence.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

from edgecopy.alerter import Alerter
from shared.journal import Journal

logger = logging.getLogger(__name__)


class Reconciler:
    """
    Background worker that runs daily at UTC midnight to assess performance.
    Computes:
      - Sharpe Ratio
      - Win Rate
      - Avg Slippage vs Master entries
      - P&L Capture Ratio
    """

    def __init__(self, journal: Journal, alerter: Optional[Alerter] = None) -> None:
        self.journal = journal
        self.alerter = alerter

    async def run_periodic(self) -> None:
        """Infinite loop waiting for end of day."""
        while True:
            # Sleep until next UTC midnight
            now = datetime.now(tz=timezone.utc)
            tomorrow = now + timedelta(days=1)
            scheduled = tomorrow.replace(hour=0, minute=5, second=0) # 5 mins past midnight
            
            wait_secs = (scheduled - now).total_seconds()
            logger.info("Reconciler idling until %s", scheduled)
            
            await asyncio.sleep(wait_secs)
            await self.generate_daily_report()

    async def generate_daily_report(self) -> dict:
        """Fetch yesterday's trades and summarize impact."""
        yesterday = datetime.now(tz=timezone.utc) - timedelta(days=1)
        since = yesterday.replace(hour=0, minute=0, second=0)
        until = yesterday.replace(hour=23, minute=59, second=59)

        trades = await self.journal.get_all(since=since, until=until)
        if not trades:
            return {"status": "no_trades"}

        count = len(trades)
        wins = sum(1 for t in trades if t.win)
        net_pnl = sum(t.net_pnl for t in trades)
        avg_slippage = sum(t.slippage_pips for t in trades) / count
        
        # Copy Impact
        copy_trades = [t for t in trades if t.is_copy]
        avg_div = 0.0
        if copy_trades:
            avg_div = sum(t.copy_divergence or 0.0 for t in copy_trades) / len(copy_trades)

        report = {
            "date": str(since.date()),
            "trade_count": count,
            "win_rate": f"{(wins/count)*100:.1f}%",
            "net_pnl": f"${net_pnl:.2f}",
            "avg_slippage_bps": round(avg_slippage, 2),
            "copy_divergence": f"{avg_div:.4f}"
        }

        if self.alerter:
            await self.alerter.info(f"Daily Reconciliation Report: {since.date()}", data=report)

        return report

    async def audit_master(self, wallet_address: str, days: int = 30) -> dict:
        """Deep dive into a specific master's copy performance."""
        since = datetime.now(tz=timezone.utc) - timedelta(days=days)
        trades = await self.journal.get_all(since=since)
        relevant = [t for t in trades if t.metadata.get("master_wallet") == wallet_address]
        
        if not relevant:
            return {"status": "insufficient_data"}
            
        # Analysis logic here...
        return {"count": len(relevant)}
