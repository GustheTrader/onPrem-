"""
edgecopy.signal_processor — Core signal transformation and risk validation.
Transforms raw CopySignals into executable orders after applying:
  1. Master vetting (win rate check).
  2. Sizing logic (fixed, proportional, or Kelly).
  3. RiskGate validation.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Optional

from edgecopy.alerter import Alerter
from shared.features import kelly_size
from shared.risk_gate import RiskGate
from shared.types import CopyConfig, Regime, Signal

logger = logging.getLogger(__name__)


@dataclass
class MasterStats:
    """Historical performance tracker for a master wallet address."""
    wallet: str
    min_win_rate: float = 0.45
    history: list[bool] = field(default_factory=list) # Rolling list of wins/losses
    
    @property
    def win_rate(self) -> Optional[float]:
        if not self.history or len(self.history) < 5:
            return None
        return sum(1 for x in self.history if x) / len(self.history)

    @property
    def should_pause(self) -> bool:
        wr = self.win_rate
        return wr is not None and wr < self.min_win_rate

    def record(self, win: bool) -> None:
        self.history.append(win)
        if len(self.history) > 20:
            self.history.pop(0)


class SignalProcessor:
    """
    Consumer of the watcher signal_queue.
    Decides IF and HOW LARGE to copy a signal.
    """

    def __init__(
        self,
        copy_cfg: CopyConfig,
        risk_gate: RiskGate,
        follower_balance: float,
        input_queue: asyncio.Queue,
        output_queue: asyncio.Queue,
        alerter: Optional[Alerter] = None,
    ) -> None:
        self.copy_cfg = copy_cfg
        self.risk_gate = risk_gate
        self.balance = follower_balance
        self.input_queue = input_queue
        self.output_queue = output_queue
        self.alerter = alerter
        
        self.master_stats: dict[str, MasterStats] = {}
        self._running = False

    def stop(self) -> None:
        self._running = False

    async def run(self) -> None:
        """Infinite processing loop."""
        self._running = True
        logger.info("Signal Processor active — consuming signal queue")
        
        while self._running:
            try:
                # Wait for next copy signal
                copy_sig = await asyncio.wait_for(self.input_queue.get(), timeout=1.0)
                await self._process_one(copy_sig)
                self.input_queue.task_done()
            except asyncio.TimeoutError:
                continue
            except Exception as exc:
                logger.error("Error in signal processor loop: %s", exc)

    async def _process_one(self, copy_sig: Any) -> None:
        """
        Transformation steps:
        1. Vet Master
        2. Calculate Size
        3. Consult RiskGate
        4. Emit to Engine
        """
        # 1. Master Check
        wallet = copy_sig.master.wallet_address
        stats = self.master_stats.setdefault(wallet, MasterStats(wallet))
        if stats.should_pause:
            logger.info("Discarding signal from %s (Win Rate < %s)", wallet, stats.min_win_rate)
            return

        # 2. Sizing logic
        size = self._compute_size(copy_sig)
        
        # 3. Risk Gate
        # Re-construct a Signal object for the Gate
        signal_obj = Signal(
            timestamp=copy_sig.detected_at,
            asset=copy_sig.asset,
            model=None, # it's a copy
            direction=copy_sig.direction,
            strength=2.0, # assume strong if master is trading
            regime=copy_sig.regime,
            features=None
        )
        
        gate = self.risk_gate.check(signal_obj, size)
        
        if not gate.allowed:
            logger.warning("Signal blocked by RiskGate: %s", gate.reason)
            if self.alerter:
                await self.alerter.warning(f"Copy Blocked: {gate.reason}")
            return

        # 4. Final approval
        logger.info("Signal Approved: %s %s | Size: $%.2f", copy_sig.asset, copy_sig.direction, gate.adjusted_size)
        
        # Inject metadata for the engine
        copy_sig.adjusted_size = gate.adjusted_size
        copy_sig.is_copy = True
        
        await self.output_queue.put(copy_sig)

    def _compute_size(self, copy_sig: Any) -> float:
        """Logic for determining USD size of the trade."""
        mode = self.copy_cfg.sizing_mode
        
        if mode == "fixed":
            base_size = self.copy_cfg.fixed_size_usd
        elif mode == "proportional":
            # Just follow master's size if it's within our comfort zone
            base_size = copy_sig.master_size_usd
        elif mode == "kelly":
            # Use quarter-Kelly for the asset
            # (In production, we'd fetch win_rate/avg_win for this asset)
            base_size = kelly_size(
                win_rate=0.55, avg_win=1.0, avg_loss=1.0,
                fraction=self.copy_cfg.kelly_fraction,
                account_balance=self.balance,
                max_size=self.copy_cfg.max_size_usd
            )
        else:
            base_size = 10.0 # safety default

        # Apply high-vol reduction if enabled
        if self.copy_cfg.regime_reduce_high_vol and copy_sig.regime == Regime.HIGH:
            base_size *= 0.5
            
        return min(base_size, self.copy_cfg.max_size_usd)
